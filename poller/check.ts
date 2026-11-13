/// <reference types="node" />
// Cloud poller: checks Mangrove Bay's tee sheet once and pushes new openings to ntfy.
// Runs on Node 24+ directly (built-in TypeScript stripping), no dependencies:
//   node poller/check.ts
// Env:
//   NTFY_TOPIC   ntfy topic to publish to (omit = dry run, prints only)
//   NTFY_SERVER  default https://ntfy.sh
//   STATE_FILE   default poller/.state/seen.json
//   WATCH_FILE   default poller/watch.json
//   LOOP_MINUTES keep checking for this long (0/unset = check once and exit)
//   INTERVAL_SEC seconds between checks in loop mode (default 60)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { COURSE, fetchTeeTimes, type TeeTime } from '../src/foreup.ts';
import { type Criteria, diffOpenings, formatSlot, matchesCriteria } from '../src/match.ts';

const TZ = 'America/New_York'; // course time; GitHub runners are UTC
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type WatchFile = {
  days: string[] | 'all'; // e.g. ["Sat","Sun"]
  earliest: string; // "07:00"
  latest: string; // "11:00"
  players: number;
  activeHours?: [string, string]; // loop mode only checks inside this ET window
};

const watchFile = process.env.WATCH_FILE ?? 'poller/watch.json';
const stateFile = process.env.STATE_FILE ?? 'poller/.state/seen.json';
const topic = process.env.NTFY_TOPIC?.trim();
const server = (process.env.NTFY_SERVER ?? 'https://ntfy.sh').replace(/\/$/, '');

const hhmm = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};

/** Current date/time parts in course time. */
function courseNow(): { date: Date; key: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  return {
    date: new Date(Number(p.year), Number(p.month) - 1, Number(p.day)),
    key: `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`,
  };
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function watchedDates(w: WatchFile, today: Date): string[] {
  const out: string[] = [];
  for (let i = 0; i < COURSE.bookingWindowDays; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    if (w.days === 'all' || w.days.includes(DOW[d.getDay()])) out.push(iso(d));
  }
  return out;
}

type State = { criteria: string; seen: string[] };

function loadState(criteriaKey: string): string[] | null {
  try {
    const s: State = JSON.parse(readFileSync(stateFile, 'utf8'));
    // Edited watch.json → start a fresh baseline instead of alerting on everything.
    return s.criteria === criteriaKey ? s.seen : null;
  } catch {
    return null;
  }
}

function saveState(criteriaKey: string, seen: string[]): void {
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify({ criteria: criteriaKey, seen } satisfies State));
}

async function notify(slots: TeeTime[]): Promise<void> {
  const first = formatSlot(slots[0]);
  const lines = slots.slice(0, 6).map((t) => {
    const f = formatSlot(t);
    return `${f.day} ${f.time} · ${t.spots} spot${t.spots === 1 ? '' : 's'}`;
  });
  if (slots.length > 6) lines.push(`+${slots.length - 6} more`);
  const msg = {
    topic,
    title: slots.length === 1 ? `Tee time opened: ${first.day} ${first.time}` : `${slots.length} tee times opened at Mangrove Bay`,
    message: lines.join('\n'),
    click: COURSE.bookingUrl,
    tags: ['golf'],
    priority: 4,
    actions: [{ action: 'view', label: 'Book', url: COURSE.bookingUrl, clear: true }],
  };
  if (!topic) {
    console.log('[dry run] would notify:', JSON.stringify(msg, null, 2));
    return;
  }
  const res = await fetch(server, { method: 'POST', body: JSON.stringify(msg), headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error(`ntfy returned ${res.status}: ${await res.text()}`);
}

const readWatch = (): WatchFile => JSON.parse(readFileSync(watchFile, 'utf8'));

async function checkOnce() {
  const w = readWatch();
  const criteria: Criteria = { earliest: hhmm(w.earliest), latest: hhmm(w.latest), players: w.players };
  // Only what's matched on; editing activeHours shouldn't reset the baseline.
  const criteriaKey = JSON.stringify([w.days, w.earliest, w.latest, w.players]);
  const now = courseNow();
  const dates = watchedDates(w, now.date);

  let matches: TeeTime[] = [];
  for (const date of dates) {
    const times = await fetchTeeTimes(date);
    matches.push(...times.filter((t) => matchesCriteria(t, criteria)));
  }
  matches = matches.filter((t) => t.time > now.key);

  const prev = loadState(criteriaKey);
  const newKeys = diffOpenings(prev, matches);
  const fresh = matches.filter((t) => newKeys.includes(t.time));

  console.log(
    `${now.key} ET · watching ${dates.join(', ') || '(no dates in window)'} · ` +
      `${matches.length} open · ${prev === null ? 'baseline set' : `${fresh.length} new`}`,
  );

  // Notify before saving: if ntfy fails, the next run retries the same openings.
  if (fresh.length > 0) await notify(fresh);
  saveState(criteriaKey, matches.map((t) => t.time));
}

/** Never throws: a foreUP/ntfy hiccup shouldn't fail the workflow (and email you).
 *  State is untouched on failure, so the next check simply retries. */
async function safeCheck(): Promise<boolean> {
  try {
    await checkOnce();
    return true;
  } catch (e) {
    console.log(`::warning::check failed: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

function withinActiveHours(): boolean {
  const hours = readWatch().activeHours;
  if (!hours) return true;
  const now = courseNow().key.slice(11); // "HH:MM" ET
  const mins = hhmm(now);
  return mins >= hhmm(hours[0]) && mins < hhmm(hours[1]);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MAX_BACKOFF_MS = 10 * 60_000;

async function run() {
  const loopMinutes = Number(process.env.LOOP_MINUTES ?? 0);
  if (!loopMinutes) {
    await safeCheck(); // single check (manual runs, local testing)
    return;
  }

  // Loop mode: one GitHub job checks every INTERVAL_SEC for LOOP_MINUTES, then the
  // next scheduled job takes over. GitHub's own cron can't go below 5 minutes.
  const intervalMs = Number(process.env.INTERVAL_SEC ?? 60) * 1000;
  const end = Date.now() + loopMinutes * 60_000;
  let delay = intervalMs;
  while (Date.now() < end) {
    if (!withinActiveHours()) {
      console.log(`${courseNow().key} ET · outside active hours, stopping`);
      return;
    }
    const started = Date.now();
    const ok = await safeCheck();
    // Back off on errors (rate limits, outages) so we never hammer foreUP; reset on success.
    delay = ok ? intervalMs : Math.min(delay * 2, MAX_BACKOFF_MS);
    const wait = Math.max(delay - (Date.now() - started), 5_000);
    if (Date.now() + wait >= end) return;
    await sleep(wait);
  }
}

run();

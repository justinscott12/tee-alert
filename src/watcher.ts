import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { COURSE, TeeTime, fetchMockTeeTimes, fetchTeeTimes } from './foreup';
import { diffOpenings, formatSlot, matchesCriteria } from './match';

export { formatSlot };

export type Watch = {
  enabled: boolean;
  dates: string[]; // ISO "YYYY-MM-DD"
  earliest: number; // minutes after midnight
  latest: number;
  players: 2 | 3 | 4;
};

export type CheckResult = {
  checkedAt: number;
  matches: TeeTime[]; // every slot currently matching the watch
  newKeys: string[]; // slots that weren't open on the previous check
  /** slot -> when it opened; kept for NEW_BADGE_MS so the badge survives later polls */
  newSince: Record<string, number>;
  error?: string;
};

const NEW_BADGE_MS = 15 * 60_000;

const WATCH_KEY = 'watch.v1';
const SEEN_KEY = 'seen.v1';
const LAST_KEY = 'last.v1';

export const USE_MOCK = Platform.OS === 'web';

// ---------- dates ----------

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Today plus the rest of foreUP's public booking window. */
export function bookableDates(now = new Date()): string[] {
  return Array.from({ length: COURSE.bookingWindowDays }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    return isoDate(d);
  });
}

// ---------- persistence ----------

export const DEFAULT_WATCH: Watch = {
  enabled: false,
  dates: bookableDates().slice(1, 4),
  earliest: 7 * 60,
  latest: 11 * 60,
  players: 2,
};

export async function loadWatch(): Promise<Watch> {
  const raw = await AsyncStorage.getItem(WATCH_KEY);
  const w: Watch = raw ? { ...DEFAULT_WATCH, ...JSON.parse(raw) } : DEFAULT_WATCH;
  // Drop dates that have rolled into the past.
  const valid = new Set(bookableDates());
  return { ...w, dates: w.dates.filter((d) => valid.has(d)) };
}

export async function saveWatch(w: Watch): Promise<void> {
  await AsyncStorage.setItem(WATCH_KEY, JSON.stringify(w));
}

/** Changing what you're watching resets the baseline so you aren't spammed. */
export async function resetSeen(): Promise<void> {
  await AsyncStorage.multiRemove([SEEN_KEY, LAST_KEY]);
}

export async function loadLastResult(): Promise<CheckResult | null> {
  const raw = await AsyncStorage.getItem(LAST_KEY);
  return raw ? JSON.parse(raw) : null;
}

// ---------- matching ----------

export function matchesWatch(t: TeeTime, w: Watch): boolean {
  return matchesCriteria(t, w);
}

// ---------- the check ----------

let inFlight: Promise<CheckResult> | null = null;

/** Fetch every watched date, diff against last time, notify on new openings. */
export function runCheck(): Promise<CheckResult> {
  // Foreground timer and background task can overlap; share one request.
  inFlight ??= doCheck().finally(() => (inFlight = null));
  return inFlight;
}

async function doCheck(): Promise<CheckResult> {
  const watch = await loadWatch();
  const fetcher = USE_MOCK ? fetchMockTeeTimes : fetchTeeTimes;

  let matches: TeeTime[] = [];
  let error: string | undefined;
  try {
    // Sequential on purpose: a few small requests, gentle on the course's server.
    for (const date of [...watch.dates].sort()) {
      const times = await fetcher(date);
      matches.push(...times.filter((t) => matchesWatch(t, watch)));
    }
    // Hide slots that already teed off today.
    const nowKey = `${isoDate(new Date())} ${new Date().toTimeString().slice(0, 5)}`;
    matches = matches.filter((t) => t.time > nowKey);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const seenRaw = await AsyncStorage.getItem(SEEN_KEY);
  const prevSeen: string[] | null = seenRaw ? JSON.parse(seenRaw) : null;
  const prev = await loadLastResult();
  const now = Date.now();

  if (error) {
    // Keep the old baseline so a flaky network doesn't trigger a flood later.
    const result: CheckResult = {
      checkedAt: now,
      matches: prev?.matches ?? [],
      newKeys: [],
      newSince: prev?.newSince ?? {},
      error,
    };
    await AsyncStorage.setItem(LAST_KEY, JSON.stringify(result));
    return result;
  }

  const newKeys = diffOpenings(prevSeen, matches);
  // Baseline = what's open right now. A slot that gets booked and later freed
  // up again (a cancellation) counts as a fresh opening — that's the point.
  await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(matches.map((t) => t.time)));

  const open = new Set(matches.map((t) => t.time));
  const newSince: Record<string, number> = {};
  for (const [k, at] of Object.entries(prev?.newSince ?? {})) {
    if (open.has(k) && now - at < NEW_BADGE_MS) newSince[k] = at;
  }
  for (const k of newKeys) newSince[k] = now;

  const result: CheckResult = { checkedAt: now, matches, newKeys, newSince };
  await AsyncStorage.setItem(LAST_KEY, JSON.stringify(result));

  if (watch.enabled && newKeys.length > 0 && !USE_MOCK) {
    // A failed notification must never lose the check result.
    await notifyOpenings(matches.filter((t) => newKeys.includes(t.time))).catch(() => {});
  }
  return result;
}

// ---------- formatting + notifications ----------

export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
}

async function notifyOpenings(slots: TeeTime[]): Promise<void> {
  const first = slots[0];
  const { day, time } = formatSlot(first);
  const spots = `${first.spots} spot${first.spots === 1 ? '' : 's'}`;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: slots.length === 1 ? '⛳ Tee time opened at Mangrove Bay' : `⛳ ${slots.length} tee times opened at Mangrove Bay`,
      body:
        slots.length === 1
          ? `${day} at ${time} · ${spots}. Tap to book.`
          : `Earliest: ${day} at ${time} · ${spots}. Tap to book.`,
      data: { url: COURSE.bookingUrl },
      sound: true,
    },
    trigger: null,
  });
}

export async function sendTestNotification(): Promise<void> {
  await notifyOpenings([{ time: `${bookableDates()[1]} 08:15`, spots: 4, greenFee: 37.5, cartFee: 9.5 }]);
}

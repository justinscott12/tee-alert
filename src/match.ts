// Pure matching logic shared by the iOS app and the cloud poller (poller/check.ts).
// No React Native imports here: Node runs this file directly.
import type { TeeTime } from './foreup.ts';

export type Criteria = {
  earliest: number; // minutes after midnight
  latest: number;
  players: number;
};

export function minutesOf(slotTime: string): number {
  const [h, m] = slotTime.slice(11, 16).split(':').map(Number);
  return h * 60 + m;
}

export function matchesCriteria(t: TeeTime, c: Criteria): boolean {
  const min = minutesOf(t.time);
  return t.spots >= c.players && min >= c.earliest && min <= c.latest;
}

/** Which matching slots are new since the last check? First check (null) = baseline, no alerts. */
export function diffOpenings(prevSeen: string[] | null, matches: TeeTime[]): string[] {
  if (prevSeen === null) return [];
  const before = new Set(prevSeen);
  return matches.map((t) => t.time).filter((k) => !before.has(k));
}

/** "2026-11-15 08:15" -> { day: "Sun, Nov 15", time: "8:15 AM" } */
export function formatSlot(t: TeeTime): { day: string; time: string } {
  const [date, hm] = t.time.split(' ');
  const [y, mo, d] = date.split('-').map(Number);
  const [h, m] = hm.split(':').map(Number);
  const dt = new Date(y, mo - 1, d, h, m);
  return {
    day: dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
    time: dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
  };
}

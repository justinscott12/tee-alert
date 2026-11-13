// Mangrove Bay books through foreUP's public booking page. These IDs come from
// https://foreupsoftware.com/index.php/booking/19671/2149 (City of St. Pete golf).
export const COURSE = {
  name: 'Mangrove Bay',
  courseId: 19671,
  scheduleId: 2149,
  bookingClass: 12239, // "Public"
  bookingWindowDays: 8,
  bookingUrl: 'https://foreupsoftware.com/index.php/booking/19671/2149#/teetimes',
};

export type TeeTime = {
  /** "2026-11-15 08:15", course-local (Eastern) */
  time: string;
  spots: number;
  greenFee: number | null;
  cartFee: number | null;
};

type RawTeeTime = {
  time: string;
  available_spots: number;
  green_fee?: number | false;
  cart_fee_18_hole?: number | false;
};

/** "2026-11-15" -> "11-15-2026" (foreUP's format) */
function toForeUpDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${m}-${d}-${y}`;
}

export async function fetchTeeTimes(isoDate: string, signal?: AbortSignal): Promise<TeeTime[]> {
  const params = new URLSearchParams({
    time: 'all',
    date: toForeUpDate(isoDate),
    holes: 'all',
    players: '0',
    booking_class: String(COURSE.bookingClass),
    schedule_id: String(COURSE.scheduleId),
    'schedule_ids[]': String(COURSE.scheduleId),
    specials_only: '0',
    api_key: 'no_limits',
  });
  const res = await fetch(`https://foreupsoftware.com/index.php/api/booking/times?${params}`, {
    headers: { 'Api-Key': 'no_limits', 'X-Requested-With': 'XMLHttpRequest' },
    signal,
  });
  if (!res.ok) throw new Error(`foreUP returned ${res.status}`);
  const body: unknown = await res.json();
  // foreUP returns `false` or an error object for days outside the window.
  if (!Array.isArray(body)) return [];
  return (body as RawTeeTime[]).map((t) => ({
    time: t.time,
    spots: t.available_spots,
    greenFee: typeof t.green_fee === 'number' ? t.green_fee : null,
    cartFee: typeof t.cart_fee_18_hole === 'number' ? t.cart_fee_18_hole : null,
  }));
}

/** Deterministic fake data for the web preview (foreUP blocks browser CORS). */
export async function fetchMockTeeTimes(isoDate: string): Promise<TeeTime[]> {
  const seed = Number(isoDate.replace(/-/g, '')) + Math.floor(Date.now() / 120_000);
  const out: TeeTime[] = [];
  for (let min = 7 * 60; min <= 16 * 60; min += 37) {
    if ((seed + min) % 5 !== 0) continue;
    const h = String(Math.floor(min / 60)).padStart(2, '0');
    const m = String(min % 60).padStart(2, '0');
    out.push({ time: `${isoDate} ${h}:${m}`, spots: ((seed + min) % 3) + 2, greenFee: 37.5, cartFee: 9.5 });
  }
  return out;
}

// Dates without a time (date of loss, instruction date, policy period) are stored as DATE and handled as
// "YYYY-MM-DD" strings; Prisma gives them back as UTC-midnight Date objects. "Today" is Lagos time (UTC+1, no DST).

const LAGOS_OFFSET_MS = 60 * 60_000;

/** Today in Lagos as YYYY-MM-DD. */
export function todayLagos(now = new Date()): string {
  return new Date(now.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

/** A DATE column value -> "YYYY-MM-DD". */
export function dateOut(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** "YYYY-MM-DD" -> Date at UTC midnight (how Prisma stores a DATE). */
export function dateIn(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/** The Lagos calendar date of a timestamp, as a UTC-midnight Date. */
export function lagosDay(ts: Date): Date {
  return dateIn(todayLagos(ts));
}

/** Whole calendar days from a to b (both reduced to Lagos dates). */
export function calendarDaysBetween(a: Date, b: Date): number {
  return Math.round((lagosDay(b).getTime() - lagosDay(a).getTime()) / 86_400_000);
}

/** Working days (Mon-Fri) after a up to and including b. Public holidays are not excluded. */
export function businessDaysBetween(a: Date, b: Date): number {
  const start = lagosDay(a);
  const end = lagosDay(b);
  if (end <= start) return 0;
  let days = 0;
  for (let t = start.getTime() + 86_400_000; t <= end.getTime(); t += 86_400_000) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) days += 1;
  }
  return days;
}

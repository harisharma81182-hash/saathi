import { DateTime } from 'luxon';

// Dates are stored in UTC. "Today", "this week" and "overdue" depend on where the user is,
// so every day boundary is computed in the user's own timezone.

export function dayRange(timezone, at = new Date()) {
  const local = DateTime.fromJSDate(at, { zone: timezone });
  return {
    start: local.startOf('day').toJSDate(),
    end: local.endOf('day').toJSDate(),
  };
}

export function lastNDays(timezone, n, at = new Date()) {
  const today = DateTime.fromJSDate(at, { zone: timezone }).startOf('day');
  return Array.from({ length: n }, (_, i) => {
    const d = today.minus({ days: n - 1 - i });
    return { key: d.toISODate(), start: d.toJSDate(), end: d.endOf('day').toJSDate() };
  });
}

export function localDateKey(date, timezone) {
  return DateTime.fromJSDate(date, { zone: timezone }).toISODate();
}

// Whole days from today to the target day, in the user's timezone (0 = today, 1 = tomorrow).
export function daysUntil(target, timezone, at = new Date()) {
  const a = DateTime.fromJSDate(at, { zone: timezone }).startOf('day');
  const b = DateTime.fromJSDate(target, { zone: timezone }).startOf('day');
  return Math.round(b.diff(a, 'days').days);
}

// Part of day, used for greetings: morning / afternoon / evening / night.
export function partOfDay(timezone, at = new Date()) {
  const h = DateTime.fromJSDate(at, { zone: timezone }).hour;
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

export function formatLocal(date, timezone) {
  return DateTime.fromJSDate(date, { zone: timezone }).toFormat("ccc d LLL yyyy, h:mm a");
}

// "2026-10-18T21:30:00+05:30": the user's local time with its offset. This is the format the
// agent reads and writes, so "9 baje" always means 9 o'clock where the user is.
export function toLocalIso(date, timezone) {
  return DateTime.fromJSDate(date, { zone: timezone }).toISO({ suppressMilliseconds: true });
}

// The moment it is "HH:mm" on the given local date ("2026-10-19") in the user's timezone.
export function atLocalTime(dateKey, hhmm, timezone) {
  const [hour, minute] = hhmm.split(':').map(Number);
  return DateTime.fromISO(dateKey, { zone: timezone }).set({ hour, minute, second: 0, millisecond: 0 }).toJSDate();
}

// "Sunday 18 Oct 2026, 9:30 PM": for the agent's context, so it knows today's weekday.
export function describeLocalNow(timezone, at = new Date()) {
  return DateTime.fromJSDate(at, { zone: timezone }).toFormat('cccc d LLL yyyy, h:mm a');
}

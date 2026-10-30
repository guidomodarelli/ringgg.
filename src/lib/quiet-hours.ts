import { DOORBELL, QUIET_HOURS_PATTERN } from '@/constants/doorbell';

export interface QuietHours { quiet_start: string | null; quiet_end: string | null }

function minutes(value: string) {
  const [hours, mins] = value.split(':').map(Number);
  return hours * 60 + mins;
}

/** Minutes since local midnight in the home's time zone, independent of the server's zone. */
export function localMinutes(now: Date, timeZone = DOORBELL.timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return value('hour') * 60 + value('minute');
}

/** A window that ends before it starts wraps past midnight (for example 22:00 → 08:00). */
export function isQuietTime(hours: QuietHours, now = new Date()) {
  const { quiet_start: start, quiet_end: end } = hours;
  if (!start || !end || !QUIET_HOURS_PATTERN.test(start) || !QUIET_HOURS_PATTERN.test(end) || start === end) return false;
  const current = localMinutes(now);
  const from = minutes(start);
  const to = minutes(end);
  return from < to ? current >= from && current < to : current >= from || current < to;
}

const SECOND_MS = 1000;
const MINUTE_SECONDS = 60;
const HOUR_MINUTES = 60;
const DAY_HOURS = 24;

/** Unit conversions, so durations read as their units instead of bare multipliers. */
export const TIME = {
  secondMs: SECOND_MS,
  minuteSeconds: MINUTE_SECONDS,
  hourMinutes: HOUR_MINUTES,
  dayMs: DAY_HOURS * HOUR_MINUTES * MINUTE_SECONDS * SECOND_MS,
};

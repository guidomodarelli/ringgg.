import { DOORBELL } from '@/constants/doorbell';
import { TIME } from '@/constants/time';

export interface PauseState { enabled: boolean; paused_until: string | null }

/** Paused until someone resumes it (`enabled = false`) or until a moment that has not arrived yet. */
export function isPaused(home: PauseState, now = new Date()) {
  return !home.enabled || (home.paused_until !== null && new Date(home.paused_until).getTime() > now.getTime());
}

/** The end of a pause that resumes on its own, or `null` when nobody scheduled one. */
export function pauseEnd(home: PauseState, now = new Date()) {
  return home.enabled && isPaused(home, now) ? home.paused_until : null;
}

function localDay(value: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: DOORBELL.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
}

/** "hasta las 15:30", "hasta mañana a las 08:00" or "hasta el 3 nov. a las 08:00", in the home's time zone. */
export function pauseEndLabel(value: string, now = new Date()) {
  const end = new Date(value);
  const time = new Intl.DateTimeFormat('es-AR', { timeZone: DOORBELL.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(end);
  if (localDay(end) === localDay(now)) return `hasta las ${time}`;
  const tomorrow = new Date(now.getTime() + TIME.dayMs);
  if (localDay(end) === localDay(tomorrow)) return `hasta mañana a las ${time}`;
  const day = new Intl.DateTimeFormat('es-AR', { timeZone: DOORBELL.timeZone, day: 'numeric', month: 'short' }).format(end);
  return `hasta el ${day} a las ${time}`;
}

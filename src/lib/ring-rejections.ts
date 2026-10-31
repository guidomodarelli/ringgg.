import type { RingRejection, RingRejectionCode } from '@/types/doorbell';

/** Why rings did not sound, worded to follow «timbrazo» or a count: «2 desde lejos de la puerta». */
export const RING_REJECTION_REASONS: Record<RingRejectionCode, string> = {
  PAUSED: 'con el timbre en pausa',
  QUIET_HOURS: 'en horario de descanso',
  LOCATION_REQUIRED: 'sin la ubicación de la visita',
  LOCATION_IMPRECISE: 'con ubicación imprecisa',
  TOO_FAR: 'desde lejos de la puerta',
  COOLDOWN: 'de alguien que acababa de tocar',
  RATE_LIMITED: 'de alguien que insistió muchas veces',
  BUSY: 'con el timbre saturado de avisos',
};

/** «a», «a y b», «a, b y c». */
function joinReasons(parts: string[]) {
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts.at(-1)}` : parts.join('');
}

/**
 * One line for «Timbrazos» with today's rings that did not sound and why, or `null` when every ring went
 * through. It counts rings, not visitors: someone who tried twice from far away counts twice. A reason this
 * version does not know (written by a newer deployment) is left out.
 */
export function rejectedRingsSummary(rejections: RingRejection[]): string | null {
  const known = rejections.filter((rejection) => Object.hasOwn(RING_REJECTION_REASONS, rejection.code) && rejection.count > 0);
  const total = known.reduce((sum, rejection) => sum + rejection.count, 0);
  if (total === 0) return null;
  const lead = total === 1 ? 'Hoy no sonó 1 timbrazo' : `Hoy no sonaron ${total} timbrazos`;
  if (known.length === 1) return `${lead} ${RING_REJECTION_REASONS[known[0].code]}.`;
  return `${lead}: ${joinReasons(known.map((rejection) => `${rejection.count} ${RING_REJECTION_REASONS[rejection.code]}`))}.`;
}

import type { Device } from '@/types/doorbell';
import { visitTime } from './visit-format';

export type DeviceHealthTone = 'ok' | 'warning' | 'idle';

function time(value: string | null) {
  return value ? new Date(value).getTime() : 0;
}

/**
 * What the panel can say about a device's notifications, from the latest event: the device confirmed
 * a push, the provider accepted one (no confirmation yet), the provider rejected the last one, or none.
 */
export function deviceHealth(device: Pick<Device, 'last_success_at' | 'last_failure_at' | 'last_failure_status' | 'last_received_at'>): { tone: DeviceHealthTone; text: string } {
  const { last_failure_at: failedAt, last_success_at: succeededAt, last_received_at: receivedAt } = device;
  const failure = time(failedAt);
  const success = time(succeededAt);
  const received = time(receivedAt);
  if (failedAt && failure > success && failure > received) {
    const status = device.last_failure_status ? ` (código ${device.last_failure_status})` : '';
    return { tone: 'warning', text: `No pudimos enviarle el último aviso${status} · ${visitTime(failedAt)}. Volvé a activar las notificaciones en ese celular.` };
  }
  if (receivedAt && received >= success) return { tone: 'ok', text: `Recibió el último aviso · ${visitTime(receivedAt)}` };
  if (succeededAt) return { tone: 'ok', text: `Último aviso enviado · ${visitTime(succeededAt)}` };
  return { tone: 'idle', text: 'Todavía no recibió avisos. Enviale una prueba.' };
}

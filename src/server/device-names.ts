import { DEVICES } from '../constants/devices';
import { isGenericDeviceName } from '../lib/device-name';
import { nameKey, uniqueName } from '../lib/names';
import type { Database } from './database';

/** Names already used by the devices of a home, optionally ignoring one device. */
export async function takenDeviceNames(database: Database, homeId: number, exceptDeviceId: string | null = null) {
  const result = await database.query<{ name: string }>('SELECT name FROM device_homes WHERE home_id = $1 AND device_id IS DISTINCT FROM $2', [homeId, exceptDeviceId]);
  return result.rows.map((row) => row.name);
}

/** The first word of a resident's name: "Guido" from "Guido (hijo)". */
export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? '';
}

/**
 * When a resident chooses their name, their devices of that home that still carry a default name
 * ("Mi celular", "Mi celular 2") become "Celular de <nombre>", unique in the home. Names someone chose stay.
 */
export async function renameDefaultDevices(database: Database, homeId: number, email: string, residentName: string) {
  const devices = await database.query<{ device_id: string; name: string }>(
    'SELECT dh.device_id, dh.name FROM device_homes dh JOIN devices d ON d.id = dh.device_id WHERE dh.home_id = $1 AND d.resident_email = $2 ORDER BY dh.created_at',
    [homeId, email],
  );
  for (const device of devices.rows.filter((row) => isGenericDeviceName(row.name))) {
    const name = uniqueName(`${DEVICES.defaultName} de ${firstName(residentName)}`, await takenDeviceNames(database, homeId, device.device_id), DEVICES.nameMaxLength);
    await database.query('UPDATE device_homes SET name = $3, name_key = $4 WHERE device_id = $1 AND home_id = $2', [device.device_id, homeId, name, nameKey(name)]);
  }
}

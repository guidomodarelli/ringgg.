import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { initialize } from '../src/server/database';
import { addResident, listResidentHomes, listResidents, removeResident, renameResident, resolveHomeAccess, residentSettings, suggestedResidentName } from '../src/server/residents';
import { findOwnDevice, saveDevice } from '../src/server/push';
import { snapshot } from '../src/server/doorbell';
import { createHome } from '../src/server/homes';
import { HOMES, RESIDENT_NAMES } from '../src/constants/homes';
import { ZodError } from 'zod';
import { testDatabase } from './support/test-database';
import { pushSubscription } from './support/push-subscription';
import { legacyAccess } from './support/legacy-access';

const postgres = new PGlite();
const database = testDatabase(postgres);
const HOME = HOMES.originalId;
const owner = { id: 'owner-identity', email: 'owner@example.com', name: 'Guido', emailVerified: true };
const member = { id: 'member-identity', email: 'member@example.com', emailVerified: true };
const outsider = { id: 'outsider-identity', email: 'outsider@example.com', emailVerified: true };
const settings = { bootstrapEmails: [owner.email] };

beforeAll(async () => { await initialize(database); });
beforeEach(async () => {
  for (const table of ['home_members', 'home_revocations', 'residents', 'resident_revocations', 'devices', 'visits']) await database.query(`DELETE FROM ${table}`);
  await database.query('DELETE FROM homes WHERE id <> $1', [HOME]);
});
afterAll(async () => { await postgres.close(); });

describe('residentes de una casa', () => {
  test('los dos correos de arranque dan el mismo acceso compartido', () => {
    expect(residentSettings({ RESIDENT_ADMIN_EMAILS: ' Owner@Example.com ', RESIDENT_EMAILS: 'owner@example.com, member@example.com' })).toEqual({ bootstrapEmails: ['owner@example.com', 'member@example.com'] });
  });

  test('el residente de arranque accede a la casa original solo después de verificar su correo', async () => {
    await expect(resolveHomeAccess(database, owner, HOME, settings)).resolves.toMatchObject({ email: owner.email, homeId: HOME, displayName: null });
    await expect(resolveHomeAccess(database, { ...owner, emailVerified: false }, HOME, settings)).rejects.toMatchObject({ code: 'EMAIL_UNVERIFIED' });
    expect(await listResidentHomes(database, { ...owner, emailVerified: false }, settings)).toEqual([]);
  });

  test('autorizar es idempotente, normaliza el correo y permite entrar sin reiniciar el servidor', async () => {
    await expect(resolveHomeAccess(database, member, HOME, settings)).rejects.toMatchObject({ code: 'RESIDENT_NOT_INVITED' });
    await addResident(database, owner, { homeId: HOME, email: ' MEMBER@EXAMPLE.COM ' }, settings);
    await addResident(database, owner, { homeId: HOME, email: member.email }, settings);
    await expect(resolveHomeAccess(database, member, HOME, settings)).resolves.toMatchObject({ email: member.email });
    const roster = await listResidents(database, HOME, settings);
    expect(roster.filter((entry) => entry.email === member.email)).toEqual([{ email: member.email, name: null, source: 'invitation', canRemove: true }]);
    await expect(resolveHomeAccess(database, { ...member, emailVerified: false }, HOME, settings)).rejects.toMatchObject({ code: 'EMAIL_UNVERIFIED' });
  });

  test('una identidad sin autorización no puede agregar, quitar ni renombrar residentes', async () => {
    await expect(addResident(database, member, { homeId: HOME, email: 'other@example.com' }, settings)).rejects.toMatchObject({ code: 'RESIDENT_NOT_INVITED' });
    await expect(removeResident(database, member, { homeId: HOME, email: owner.email }, settings)).rejects.toMatchObject({ code: 'RESIDENT_NOT_INVITED' });
    await expect(renameResident(database, member, { homeId: HOME, email: owner.email, name: 'Otro' }, settings)).rejects.toMatchObject({ code: 'RESIDENT_NOT_INVITED' });
    expect(await listResidents(database, HOME, settings)).toEqual([{ email: owner.email, name: null, source: 'environment', canRemove: false }]);
  });

  test('cualquier residente autorizado y verificado puede gestionar a los demás', async () => {
    await addResident(database, owner, { homeId: HOME, email: member.email }, settings);
    await addResident(database, member, { homeId: HOME, email: 'new@example.com' }, settings);
    expect((await listResidents(database, HOME, settings)).some((entry) => entry.email === 'new@example.com')).toBe(true);
    await removeResident(database, member, { homeId: HOME, email: 'new@example.com' }, settings);
    expect((await listResidents(database, HOME, settings)).some((entry) => entry.email === 'new@example.com')).toBe(false);
  });

  test('no se puede quitar al último residente y dejar la vivienda sin acceso', async () => {
    await expect(removeResident(database, owner, { homeId: HOME, email: owner.email }, settings)).rejects.toMatchObject({ code: 'LAST_RESIDENT' });
    await expect(resolveHomeAccess(database, owner, HOME, settings)).resolves.toMatchObject({ email: owner.email });
  });

  test('otro residente puede quitar y volver a autorizar al residente inicial', async () => {
    await addResident(database, owner, { homeId: HOME, email: member.email }, settings);
    await removeResident(database, member, { homeId: HOME, email: owner.email }, settings);
    await expect(resolveHomeAccess(database, owner, HOME, settings)).rejects.toMatchObject({ code: 'RESIDENT_NOT_INVITED' });
    expect(await listResidentHomes(database, owner, settings)).toEqual([]);
    await expect(removeResident(database, member, { homeId: HOME, email: member.email }, settings)).rejects.toMatchObject({ code: 'LAST_RESIDENT' });
    await addResident(database, member, { homeId: HOME, email: owner.email }, settings);
    await expect(resolveHomeAccess(database, owner, HOME, settings)).resolves.toMatchObject({ email: owner.email });
  });

  test('quitar un residente revoca su acceso y sus avisos, y no le deja volver a registrar un celular', async () => {
    await addResident(database, owner, { homeId: HOME, email: member.email }, settings);
    const subscription = pushSubscription('member-test');
    await saveDevice(database, { homeId: HOME, name: 'Teléfono del residente', subscription }, member, settings);
    const memberAccess = await resolveHomeAccess(database, member, HOME, settings);
    await expect(findOwnDevice(database, subscription.endpoint, memberAccess)).resolves.toMatchObject({ active: true });
    await expect(findOwnDevice(database, subscription.endpoint, await resolveHomeAccess(database, owner, HOME, settings))).resolves.toEqual({ active: false, deviceId: null });
    await removeResident(database, owner, { homeId: HOME, email: member.email }, settings);
    await removeResident(database, owner, { homeId: HOME, email: member.email }, settings);
    expect((await database.query('SELECT id FROM devices')).rows).toHaveLength(0);
    await expect(findOwnDevice(database, subscription.endpoint, memberAccess)).resolves.toEqual({ active: false, deviceId: null });
    await expect(resolveHomeAccess(database, member, HOME, settings)).rejects.toMatchObject({ code: 'RESIDENT_NOT_INVITED' });
    await expect(saveDevice(database, { homeId: HOME, name: 'Otro intento', subscription }, member, settings)).rejects.toMatchObject({ code: 'RESIDENT_NOT_INVITED' });
  });

  test('una solicitud anterior a la revocación no puede restaurar el acceso ni revocar a otros', async () => {
    await addResident(database, owner, { homeId: HOME, email: member.email }, settings);
    const staleAccess = await resolveHomeAccess(database, member, HOME, settings);
    await removeResident(database, owner, { homeId: HOME, email: member.email }, settings);
    await expect(addResident(database, staleAccess, { homeId: HOME, email: member.email }, settings)).rejects.toMatchObject({ code: 'RESIDENT_NOT_INVITED' });
    await expect(removeResident(database, staleAccess, { homeId: HOME, email: 'other@example.com' }, settings)).rejects.toMatchObject({ code: 'RESIDENT_NOT_INVITED' });
    expect((await database.query('SELECT email FROM home_members')).rows).toHaveLength(0);
  });

  test('rechaza correos inválidos sin crear invitaciones', async () => {
    await expect(addResident(database, owner, { homeId: HOME, email: 'esto-no-es-un-correo' }, settings)).rejects.toThrow(ZodError);
    expect((await database.query('SELECT email FROM home_members')).rows).toHaveLength(0);
  });
});

describe('rollback a la versión de una sola casa', () => {
  test('quitar a alguien de la casa original lo revoca también para la versión anterior, y volver a autorizarlo lo invita de nuevo', async () => {
    await addResident(database, owner, { homeId: HOME, email: member.email }, settings);
    expect(await legacyAccess(database)).toEqual({ invited: [member.email], revoked: [] });
    await removeResident(database, owner, { homeId: HOME, email: member.email }, settings);
    expect(await legacyAccess(database)).toEqual({ invited: [], revoked: [member.email] });
    await addResident(database, owner, { homeId: HOME, email: member.email }, settings);
    expect(await legacyAccess(database)).toEqual({ invited: [member.email], revoked: [] });
  });

  test('un correo de arranque quitado de la casa original queda revocado para la versión anterior, que lo acepta por configuración', async () => {
    await addResident(database, owner, { homeId: HOME, email: member.email }, settings);
    await removeResident(database, member, { homeId: HOME, email: owner.email }, settings);
    expect(await legacyAccess(database)).toEqual({ invited: [member.email], revoked: [owner.email] });
  });

  test('las altas y bajas de otra casa no cambian el acceso de la versión anterior', async () => {
    await addResident(database, owner, { homeId: HOME, email: member.email }, settings);
    const before = await legacyAccess(database);
    const { id: other } = await createHome(database, owner, 'Casa de mamá', settings);
    await addResident(database, owner, { homeId: other, email: member.email }, settings);
    await addResident(database, owner, { homeId: other, email: outsider.email }, settings);
    await removeResident(database, owner, { homeId: other, email: member.email }, settings);
    expect(await legacyAccess(database)).toEqual(before);
  });
});

describe('nombres de residentes', () => {
  test('el nombre es obligatorio, sin espacios sobrantes y de hasta 40 caracteres', async () => {
    for (const name of ['', '   ', 'x'.repeat(RESIDENT_NAMES.maxLength + 1)]) {
      await expect(renameResident(database, owner, { homeId: HOME, email: owner.email, name }, settings)).rejects.toThrow(ZodError);
    }
    await renameResident(database, owner, { homeId: HOME, email: owner.email, name: '  Guido   Modarelli ' }, settings);
    expect(await listResidents(database, HOME, settings)).toEqual([{ email: owner.email, name: 'Guido Modarelli', source: 'environment', canRemove: false }]);
    await expect(resolveHomeAccess(database, owner, HOME, settings)).resolves.toMatchObject({ displayName: 'Guido Modarelli' });
  });

  test('no se repiten nombres en una casa, sin importar mayúsculas, tildes ni espacios', async () => {
    await addResident(database, owner, { homeId: HOME, email: member.email }, settings);
    await renameResident(database, owner, { homeId: HOME, email: owner.email, name: 'Guido' }, settings);
    for (const name of ['guido', 'GUÍDO', ' Guido ']) {
      await expect(renameResident(database, owner, { homeId: HOME, email: member.email, name }, settings)).rejects.toMatchObject({ code: 'RESIDENT_NAME_TAKEN' });
    }
    // Changing only the casing of one's own name is not a repetition.
    await renameResident(database, owner, { homeId: HOME, email: owner.email, name: 'GUIDO' }, settings);
    await renameResident(database, owner, { homeId: HOME, email: member.email, name: 'Cami' }, settings);
    expect((await listResidents(database, HOME, settings)).map((entry) => entry.name)).toEqual(['Cami', 'GUIDO']);
  });

  test('cualquier residente de la casa puede cambiar el nombre de otro, pero no el de alguien de afuera', async () => {
    await addResident(database, owner, { homeId: HOME, email: member.email }, settings);
    await renameResident(database, owner, { homeId: HOME, email: member.email, name: 'Cami' }, settings);
    await expect(resolveHomeAccess(database, member, HOME, settings)).resolves.toMatchObject({ displayName: 'Cami' });
    await renameResident(database, member, { homeId: HOME, email: owner.email, name: 'Guido' }, settings);
    await expect(resolveHomeAccess(database, owner, HOME, settings)).resolves.toMatchObject({ displayName: 'Guido' });
    await expect(renameResident(database, owner, { homeId: HOME, email: outsider.email, name: 'Nadie' }, settings)).rejects.toMatchObject({ code: 'RESIDENT_NOT_FOUND' });
  });

  test('el primer nombre reemplaza el nombre genérico de sus celulares en esa casa y respeta los elegidos', async () => {
    // A device from before devices were named when connected: its name in the home is generic.
    const { deviceId } = await saveDevice(database, { homeId: HOME, name: 'Celu viejo', subscription: pushSubscription('generic') }, owner, settings);
    await database.query(`UPDATE device_homes SET name = 'Mi celular', name_key = 'mi celular' WHERE device_id = $1`, [deviceId]);
    await saveDevice(database, { homeId: HOME, name: 'Tablet del living', subscription: pushSubscription('chosen') }, owner, settings);
    await renameResident(database, owner, { homeId: HOME, email: owner.email, name: 'Guido Modarelli' }, settings);
    expect((await snapshot(database, HOME)).devices.map((device) => device.name)).toEqual(['Celular de Guido', 'Tablet del living']);
  });

  test('la sugerencia para «¿Quién sos?» es el último nombre elegido o el de la cuenta', async () => {
    expect(await suggestedResidentName(database, owner)).toBe('Guido');
    expect(await suggestedResidentName(database, member)).toBe('member');
    await renameResident(database, owner, { homeId: HOME, email: owner.email, name: 'Guido M.' }, settings);
    expect(await suggestedResidentName(database, owner)).toBe('Guido M.');
  });
});

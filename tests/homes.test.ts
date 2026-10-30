import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { initialize } from '../src/server/database';
import { addResident, listResidentHomes, listResidents, removeResident, renameResident, resolveHomeAccess } from '../src/server/residents';
import { createHome, deleteHome } from '../src/server/homes';
import { answerVisit, getHome, readVisit, registerVisit, snapshot, updateHomeName } from '../src/server/doorbell';
import { saveDevice } from '../src/server/push';
import { pickPanelHome } from '../src/server/panel-home';
import { HOMES } from '../src/constants/homes';
import { ZodError } from 'zod';
import { testDatabase } from './support/test-database';
import { pushSubscription } from './support/push-subscription';
import { legacyAccess } from './support/legacy-access';

const postgres = new PGlite();
const database = testDatabase(postgres);
const HOME = HOMES.originalId;
const owner = { id: 'owner-identity', email: 'owner@example.com', name: 'Guido', emailVerified: true };
const member = { id: 'member-identity', email: 'member@example.com', emailVerified: true };
const settings = { bootstrapEmails: [owner.email] };
const ORIGINAL_NAME = 'Casa';

const ring = (token: string, client = 'visitor') => registerVisit(database, token, { id: crypto.randomUUID(), message: 'Hola', client });

beforeAll(async () => { await initialize(database); });
beforeEach(async () => {
  for (const table of ['home_members', 'home_revocations', 'devices', 'visits', 'rate_limits']) await database.query(`DELETE FROM ${table}`);
  await database.query('DELETE FROM homes WHERE id <> $1', [HOME]);
  await database.query('UPDATE homes SET name = $2, enabled = TRUE, paused_until = NULL, quiet_start = NULL, quiet_end = NULL WHERE id = $1', [HOME, ORIGINAL_NAME]);
});
afterAll(async () => { await postgres.close(); });

describe('crear casas', () => {
  test('solo quien ya es residente puede crear una casa, y entra con el nombre que usa en las otras', async () => {
    await expect(createHome(database, member, 'Casa nueva', settings)).rejects.toMatchObject({ code: 'HOME_CREATION_NOT_ALLOWED' });
    await renameResident(database, owner, { homeId: HOME, email: owner.email, name: 'Guido' }, settings);
    const { id } = await createHome(database, owner, '  Casa de   mamá ', settings);
    expect(await listResidentHomes(database, owner, settings)).toEqual([{ id: HOME, name: ORIGINAL_NAME }, { id, name: 'Casa de mamá' }]);
    await expect(resolveHomeAccess(database, owner, id, settings)).resolves.toMatchObject({ homeId: id, displayName: 'Guido' });
    expect(await listResidents(database, id, settings)).toEqual([{ email: owner.email, name: 'Guido', source: 'invitation', canRemove: false }]);
  });

  test('una casa necesita nombre y no repite el de otra casa de la misma persona', async () => {
    await expect(createHome(database, owner, '   ', settings)).rejects.toThrow(ZodError);
    for (const name of ['casa', 'CÁSA', '  Casa  ']) await expect(createHome(database, owner, name, settings)).rejects.toMatchObject({ code: 'HOME_NAME_TAKEN' });
    const { id } = await createHome(database, owner, 'Depto', settings);
    await expect(updateHomeName(database, await resolveHomeAccess(database, owner, id, settings), 'casa', settings)).rejects.toMatchObject({ code: 'HOME_NAME_TAKEN' });
    // Renaming a home to its own name with other casing is allowed.
    await updateHomeName(database, await resolveHomeAccess(database, owner, id, settings), 'DEPTO', settings);
    expect((await getHome(database, id)).name).toBe('DEPTO');
  });

  test('dos personas pueden tener cada una su casa con el mismo nombre', async () => {
    await addResident(database, owner, { homeId: HOME, email: member.email }, settings);
    const memberHome = await createHome(database, member, 'Depto', settings);
    const ownerHome = await createHome(database, owner, 'Depto', settings);
    expect(ownerHome.id).not.toBe(memberHome.id);
  });

  test(`cada persona puede tener hasta ${HOMES.maxPerResident} casas`, async () => {
    for (let count = 2; count <= HOMES.maxPerResident; count += 1) await createHome(database, owner, `Casa ${count}`, settings);
    await expect(createHome(database, owner, 'Una más', settings)).rejects.toMatchObject({ code: 'HOME_LIMIT' });
    expect(await listResidentHomes(database, owner, settings)).toHaveLength(HOMES.maxPerResident);
  });
});

describe('aislamiento entre casas', () => {
  test('una casa nueva no comparte residentes, visitas ni QR con las demás', async () => {
    await addResident(database, owner, { homeId: HOME, email: member.email }, settings);
    const { id: other } = await createHome(database, owner, 'Casa de mamá', settings);
    await expect(resolveHomeAccess(database, member, other, settings)).rejects.toMatchObject({ code: 'RESIDENT_NOT_INVITED' });
    const [original, second] = [await getHome(database, HOME), await getHome(database, other)];
    expect(second.token).not.toBe(original.token);
    const { visit } = await ring(original.token);
    expect((await snapshot(database, HOME)).visits.map((item) => item.id)).toEqual([visit.id]);
    expect((await snapshot(database, other)).visits).toEqual([]);
    // Another home's panel cannot answer it, and the other home's QR can neither read it nor reuse its id.
    await expect(answerVisit(database, { homeId: other, id: visit.id }, 'coming', 'Guido')).rejects.toMatchObject({ code: 'VISIT_EXPIRED' });
    await expect(readVisit(database, second.token, visit.id)).rejects.toMatchObject({ code: 'VISIT_NOT_FOUND' });
    await expect(registerVisit(database, second.token, { id: visit.id, message: 'Otra', client: 'visitor' })).rejects.toMatchObject({ code: 'RING_ID_TAKEN' });
    await expect(answerVisit(database, { homeId: HOME, id: visit.id }, 'coming', 'Guido')).resolves.toMatchObject({ reply: 'coming' });
  });

  test('los límites de timbrazos de un visitante cuentan por casa', async () => {
    const { id: other } = await createHome(database, owner, 'Casa de mamá', settings);
    const [original, second] = [await getHome(database, HOME), await getHome(database, other)];
    await ring(original.token, 'same-visitor');
    await expect(ring(original.token, 'same-visitor')).rejects.toMatchObject({ code: 'COOLDOWN' });
    await expect(ring(second.token, 'same-visitor')).resolves.toMatchObject({ created: true });
  });

  test('quitar a alguien de una casa no le quita las otras', async () => {
    await addResident(database, owner, { homeId: HOME, email: member.email }, settings);
    const { id: other } = await createHome(database, owner, 'Casa de mamá', settings);
    await addResident(database, owner, { homeId: other, email: member.email }, settings);
    await removeResident(database, owner, { homeId: other, email: member.email }, settings);
    await expect(resolveHomeAccess(database, member, other, settings)).rejects.toMatchObject({ code: 'RESIDENT_NOT_INVITED' });
    expect(await listResidentHomes(database, member, settings)).toEqual([{ id: HOME, name: ORIGINAL_NAME }]);
  });
});

describe('eliminar casas', () => {
  test('nadie puede eliminar la única casa que tiene ni una casa que usan otros residentes', async () => {
    await expect(deleteHome(database, owner, HOME, settings)).rejects.toMatchObject({ code: 'LAST_HOME' });
    const { id: other } = await createHome(database, owner, 'Casa de mamá', settings);
    await addResident(database, owner, { homeId: other, email: member.email }, settings);
    await expect(deleteHome(database, owner, other, settings)).rejects.toMatchObject({ code: 'HOME_HAS_RESIDENTS' });
    await expect(deleteHome(database, member, other, settings)).rejects.toMatchObject({ code: 'HOME_HAS_RESIDENTS' });
    await expect(deleteHome(database, member, HOME, settings)).rejects.toMatchObject({ code: 'RESIDENT_NOT_INVITED' });
    expect((await listResidentHomes(database, owner, settings)).map((home) => home.id)).toEqual([HOME, other]);
  });

  test('dos eliminaciones a la vez no dejan a nadie sin casa', async () => {
    await addResident(database, owner, { homeId: HOME, email: member.email }, settings);
    const homes = [await createHome(database, member, 'Depto', settings), await createHome(database, member, 'Casa de mamá', settings)];
    await removeResident(database, member, { homeId: HOME, email: member.email }, settings);
    // As from two tabs: one deletion goes through and the other finds no other home to keep.
    const results = await Promise.allSettled(homes.map((home) => deleteHome(database, member, home.id, settings)));
    const remaining = await listResidentHomes(database, member, settings);
    expect(remaining).toHaveLength(1);
    expect(results.find((result) => result.status === 'fulfilled')).toEqual({ status: 'fulfilled', value: { nextHomeId: remaining[0].id } });
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { code: 'LAST_HOME' } });
  });

  test('eliminar una casa borra sus visitas y olvida los celulares que solo sonaban ahí', async () => {
    const { id: other } = await createHome(database, owner, 'Casa de mamá', settings);
    const shared = pushSubscription('shared');
    await saveDevice(database, { homeId: other, name: 'Celular', subscription: pushSubscription('only-there') }, owner, settings);
    await saveDevice(database, { homeId: other, name: 'Compartido', subscription: shared }, owner, settings);
    await saveDevice(database, { homeId: HOME, name: 'Compartido', subscription: shared }, owner, settings);
    const { visit } = await ring((await getHome(database, other)).token);
    await expect(deleteHome(database, owner, other, settings)).resolves.toEqual({ nextHomeId: HOME });
    await expect(getHome(database, other)).rejects.toMatchObject({ code: 'HOME_NOT_FOUND' });
    expect((await database.query('SELECT id FROM visits WHERE id = $1', [visit.id])).rows).toEqual([]);
    expect((await snapshot(database, HOME)).devices.map((device) => device.name)).toEqual(['Compartido']);
    expect((await database.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM devices')).rows[0].count).toBe(1);
    expect(await listResidentHomes(database, owner, settings)).toEqual([{ id: HOME, name: ORIGINAL_NAME }]);
  });

  test('eliminar la casa original también la cierra para la versión anterior', async () => {
    // Its own database: the other tests need the original home.
    const isolated = new PGlite();
    try {
      const isolatedDatabase = testDatabase(isolated);
      await initialize(isolatedDatabase);
      await addResident(isolatedDatabase, owner, { homeId: HOME, email: member.email }, settings);
      await removeResident(isolatedDatabase, member, { homeId: HOME, email: owner.email }, settings);
      await createHome(isolatedDatabase, member, 'Depto', settings);
      await deleteHome(isolatedDatabase, member, HOME, settings);
      expect(await legacyAccess(isolatedDatabase)).toEqual({ invited: [], revoked: [member.email, owner.email] });
    } finally { await isolated.close(); }
  });
});

describe('casa que abre el panel', () => {
  const homes = [{ id: HOME, name: ORIGINAL_NAME }, { id: 7, name: 'Casa de mamá' }];

  test('abre la casa de la dirección, si no la última abierta, y si no la primera', () => {
    expect(pickPanelHome(homes, '7', String(HOME))).toBe(7);
    expect(pickPanelHome(homes, undefined, '7')).toBe(7);
    expect(pickPanelHome(homes, undefined, undefined)).toBe(HOME);
  });

  test('nunca elige una casa ajena ni un valor inválido', () => {
    expect(pickPanelHome(homes, '99', '7')).toBe(7);
    expect(pickPanelHome(homes, 'abc', '1.5')).toBe(HOME);
    expect(pickPanelHome(homes, '-7', '0')).toBe(HOME);
    expect(pickPanelHome([], String(HOME), String(HOME))).toBeNull();
  });
});

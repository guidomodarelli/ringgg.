import { describe, expect, test } from 'vitest';
import { authorizeResident } from '../src/server/resident-access';
import { AppError } from '../src/server/errors';

const resident = { id: 'neon-test-user', email: 'resident@example.com', name: 'Residente', emailVerified: true };

describe('autorización de la vivienda', () => {
  test('un correo verificado e invitado conserva su identidad de Neon', () => {
    expect(authorizeResident(resident, 'another@example.com, RESIDENT@example.com ')).toEqual(resident);
  });
  test('un registro nuevo no habilita acceso a la vivienda', () => {
    expect(() => authorizeResident(resident, 'other@example.com')).toThrow(AppError);
    try { authorizeResident(resident, 'other@example.com'); } catch (error) { expect(error).toMatchObject({ status: 403, code: 'RESIDENT_NOT_INVITED' }); }
  });
  test('la configuración vacía falla cerrada y no convierte al primer usuario en propietario', () => {
    expect(() => authorizeResident(resident, undefined)).toThrow('no tiene acceso');
    expect(() => authorizeResident(resident, ' , ')).toThrow('no tiene acceso');
  });
  test('conocer un correo autorizado no basta sin verificar que es propio', () => {
    expect(() => authorizeResident({ ...resident, emailVerified: false }, resident.email)).toThrow('Verificá tu correo');
  });
});

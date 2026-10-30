import { describe, expect, test } from 'vitest';
import { AppError, describeError, errorResponse } from '../src/server/errors';
import { forwardSetCookies } from '../src/server/session-cookies';

describe('errores para los logs', () => {
  test('resume el error con su código y la cadena de causas, sin campos que traen datos de filas', () => {
    const driverError = Object.assign(new Error('duplicate key value violates unique constraint "devices_endpoint_key"'), { code: '23505', detail: 'Key (endpoint)=(https://fcm.googleapis.com/secreto) already exists.' });
    const wrapped = new AppError(503, 'AUTH_UPSTREAM', 'No pudimos comprobar tu sesión.', { cause: driverError });
    const description = describeError(wrapped);
    expect(description).toMatchObject({ name: 'AppError', code: 'AUTH_UPSTREAM', cause: { name: 'Error', code: '23505' } });
    expect(JSON.stringify(description)).not.toContain('secreto');
    expect(describeError('texto suelto')).toEqual({ type: 'string' });
  });

  test('los mensajes largos se recortan', () => {
    const description = describeError(new Error('x'.repeat(1000)));
    expect(String(description.message)).toHaveLength(300);
  });

  test('las fallas del servidor devuelven una referencia y las esperadas no', async () => {
    const expected = await errorResponse(new AppError(409, 'VISIT_EXPIRED', 'Este timbrazo ya venció.'), 'test').json();
    expect(expected).toEqual({ error: 'Este timbrazo ya venció.', code: 'VISIT_EXPIRED' });
    const upstream = errorResponse(new AppError(503, 'AUTH_UPSTREAM', 'No pudimos comprobar tu sesión.'), 'test');
    expect(upstream.status).toBe(503);
    expect(await upstream.json()).toMatchObject({ code: 'AUTH_UPSTREAM', requestId: expect.any(String) });
    const unexpected = errorResponse(new Error('connection refused'), 'test');
    const body = await unexpected.json();
    expect(unexpected.status).toBe(500);
    expect(body.error).toContain(body.requestId);
    expect(JSON.stringify(body)).not.toContain('connection refused');
  });
});

describe('sesiones renovadas', () => {
  test('el proxy reenvía cada cookie de la respuesta de autenticación por separado', () => {
    const source = new Headers();
    source.append('set-cookie', 'session=nueva; Path=/; HttpOnly; Secure; SameSite=Lax');
    source.append('set-cookie', 'session_data=cache; Path=/; HttpOnly');
    const target = forwardSetCookies(source, new Headers({ 'x-existing': '1' }));
    expect(target.getSetCookie()).toEqual(['session=nueva; Path=/; HttpOnly; Secure; SameSite=Lax', 'session_data=cache; Path=/; HttpOnly']);
    expect(target.get('x-existing')).toBe('1');
  });
});

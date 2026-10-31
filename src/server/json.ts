import type { z } from 'zod';
import { HTTP } from '@/constants/doorbell';
import { AppError } from './errors';

/** Parses JSON text against a schema; malformed JSON is a 400, never a 500. */
export function parseJson<T extends z.ZodType>(text: string, schema: T): z.infer<T> {
  let value: unknown;
  try { value = JSON.parse(text); } catch (error) { throw new AppError(HTTP.badRequest, 'INVALID_JSON', 'La solicitud no tiene un formato válido.', { cause: error }); }
  return schema.parse(value);
}

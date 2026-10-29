import type { ResidentIdentity } from '../types/auth';
import { HTTP } from '../constants/doorbell';
import { AppError } from './errors';

/** In this single-home MVP, only explicitly invited and verified emails belong to the home. */
export function authorizeResident(user: ResidentIdentity, allowedEmails: string | undefined): ResidentIdentity {
  if (!user.emailVerified) throw new AppError(HTTP.forbidden, 'EMAIL_UNVERIFIED', 'Verificá tu correo para acceder a tu vivienda.');
  const residents = (allowedEmails || '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (!residents.includes(user.email.toLowerCase())) throw new AppError(HTTP.forbidden, 'RESIDENT_NOT_INVITED', 'Tu cuenta no tiene acceso a esta vivienda. Pedí al administrador que autorice tu correo.');
  return user;
}

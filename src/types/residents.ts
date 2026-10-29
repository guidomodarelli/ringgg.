import type { ResidentIdentity } from './auth';
export interface ResidentAccess extends ResidentIdentity { isAdmin: boolean }
export interface ResidentEntry { email: string; source: 'administrator' | 'environment' | 'invitation'; canRemove: boolean }
export interface ResidentSettings { adminEmails: string; residentEmails: string }

import type { Me, Permission } from './types';

export const PERMISSIONS: { value: Permission; label: string; description: string }[] = [
  { value: 'users', label: 'Users', description: 'View accounts, suspend patients and doctors, and limit what they can post' },
  { value: 'verifications', label: 'Doctor verification', description: 'Review licences and documents, approve or reject doctors' },
  { value: 'appointments', label: 'Appointments', description: 'View all appointments and cancel them' },
  { value: 'reviews', label: 'Review moderation', description: 'Hide or restore reviews and resolve reports' },
  { value: 'specialties', label: 'Specialties', description: 'Add, edit and remove medical specialties' },
  { value: 'plans', label: 'Plans & boosts', description: 'Confirm Pro plan and Featured boost payments' },
  { value: 'activity', label: 'System activity', description: 'Read the audit log and contact messages' },
];

/** "admin" means administrators only (role changes, staff permissions, settings). */
export type Access = Permission | 'admin';

/** UI check only; the backend and database enforce the same rule. */
export function hasAccess(me: Pick<Me, 'role' | 'permissions'> | null | undefined, access: Access): boolean {
  if (!me) return false;
  if (me.role === 'admin') return true;
  return access !== 'admin' && me.role === 'staff' && (me.permissions ?? []).includes(access);
}

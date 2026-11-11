import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Users } from 'lucide-react';
import { api, errorMessage, qs } from '../../lib/api';
import type { Permission, Role, VerificationStatus } from '../../lib/types';
import { PERMISSIONS, hasAccess } from '../../lib/permissions';
import { useAuth } from '../../context/AuthContext';
import { Card, PageHeader } from '../../components/ui/Card';
import { Checkbox, Input, Select, Textarea } from '../../components/ui/Field';
import { Badge, VerificationBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState, ErrorState, Spinner } from '../../components/ui/Feedback';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import { Pagination } from '../../components/ui/Misc';
import { useToast } from '../../components/ui/Toast';
import { formatDate } from '../../lib/format';

interface AdminUser {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  account_status: 'active' | 'suspended';
  verification_status: VerificationStatus | null;
  permissions: Permission[];
  can_send_messages: boolean;
  can_post_reviews: boolean;
  can_book_appointments: boolean;
  created_at: string;
  last_sign_in_at: string | null;
}

const LIMIT = 25;

const ROLE_LABELS: Record<Role, string> = { patient: 'Patient', doctor: 'Doctor', staff: 'Staff', admin: 'Administrator' };

const RESTRICTIONS = [
  { key: 'can_send_messages', label: 'Send messages', blocked: 'No messaging' },
  { key: 'can_post_reviews', label: 'Post and edit reviews', blocked: 'No reviews' },
  { key: 'can_book_appointments', label: 'Book appointments', blocked: 'No booking' },
] as const;
type Restrictions = Pick<AdminUser, (typeof RESTRICTIONS)[number]['key']>;

export function AdminUsersPage() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const role = params.get('role') ?? '';
  const status = params.get('status') ?? '';
  const offset = Number(params.get('offset') ?? 0);
  const [statusTarget, setStatusTarget] = useState<AdminUser | null>(null);
  const [reason, setReason] = useState('');
  const [roleTarget, setRoleTarget] = useState<{ user: AdminUser; role: Role } | null>(null);
  const [accessTarget, setAccessTarget] = useState<AdminUser | null>(null);
  const isAdmin = hasAccess(me, 'admin');
  // Only administrators manage staff and administrator accounts.
  const canManage = (u: AdminUser) => u.id !== me?.id && (isAdmin || (u.role !== 'admin' && u.role !== 'staff'));

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('offset' in patch)) next.delete('offset');
    setParams(next, { replace: true });
  };

  const query = useQuery({
    queryKey: ['admin', 'users', params.get('search'), role, status, offset],
    queryFn: () => api.get<{ total: number; items: AdminUser[] }>(`/admin/users${qs({ search: params.get('search'), role, status, limit: LIMIT, offset })}`),
    placeholderData: keepPreviousData,
  });

  const changeStatus = useMutation({
    mutationFn: (u: AdminUser) =>
      api.post<{ warning?: string }>(`/admin/users/${u.id}/status`, { status: u.account_status === 'active' ? 'suspended' : 'active', reason: reason.trim() || undefined }),
    onSuccess: (res, u) => {
      toast.success(u.account_status === 'active' ? 'Account suspended' : 'Account reactivated', res.warning);
      setStatusTarget(null);
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err) => toast.error('Could not change the account status', errorMessage(err)),
  });
  const changeRole = useMutation({
    mutationFn: (t: { user: AdminUser; role: Role }) => api.post(`/admin/users/${t.user.id}/role`, { role: t.role }),
    onSuccess: () => {
      toast.success('Role updated');
      setRoleTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err) => toast.error('Could not change the role', errorMessage(err)),
  });

  return (
    <div>
      <PageHeader
        title="Users & staff"
        description="Manage accounts, roles and staff permissions, and control what each user can post. Every change is recorded in the audit log."
      />
      <Card className="mb-4 p-4">
        <form
          className="grid gap-3 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            set({ search: search.trim() });
          }}
        >
          <div className="sm:col-span-2">
            <Input label="Search" placeholder="Name or email" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} />
          </div>
          <Select label="Role" value={role} onChange={(e) => set({ role: e.target.value })}>
            <option value="">All roles</option>
            <option value="patient">Patients</option>
            <option value="doctor">Doctors</option>
            <option value="staff">Staff</option>
            <option value="admin">Administrators</option>
          </Select>
          <Select label="Status" value={status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </Select>
          <button type="submit" className="sr-only">
            Search
          </button>
        </form>
      </Card>
      <Card className="overflow-hidden">
        {query.isLoading ? (
          <Spinner />
        ) : query.isError ? (
          <div className="p-4">
            <ErrorState error={query.error} onRetry={() => query.refetch()} />
          </div>
        ) : query.data!.items.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={Users} title="No users found" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3">User</th>
                  <th scope="col" className="px-4 py-3">Role</th>
                  <th scope="col" className="px-4 py-3">Access</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Joined</th>
                  <th scope="col" className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {query.data!.items.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{u.full_name}</p>
                      <p className="text-xs text-slate-500">{u.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-1">
                        <select
                          aria-label={`Role for ${u.full_name}`}
                          value={u.role}
                          disabled={u.id === me?.id || !isAdmin}
                          onChange={(e) => setRoleTarget({ user: u, role: e.target.value as Role })}
                          className="h-8 rounded-md border border-slate-300 px-2 text-sm disabled:bg-slate-50"
                        >
                          {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                        {u.role === 'doctor' && u.verification_status && <VerificationBadge status={u.verification_status} />}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex max-w-[16rem] flex-wrap gap-1">
                        {u.role === 'admin' && <Badge tone="purple">Full access</Badge>}
                        {u.role === 'staff' &&
                          (u.permissions.length ? (
                            u.permissions.map((p) => (
                              <Badge key={p} tone="blue">
                                {PERMISSIONS.find((x) => x.value === p)?.label ?? p}
                              </Badge>
                            ))
                          ) : (
                            <Badge tone="amber">No permissions</Badge>
                          ))}
                        {RESTRICTIONS.filter((r) => !u[r.key]).map((r) => (
                          <Badge key={r.key} tone="red">
                            {r.blocked}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">{u.account_status === 'active' ? <Badge tone="teal">Active</Badge> : <Badge tone="red">Suspended</Badge>}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(u.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      {canManage(u) && (
                        <div className="flex justify-end gap-2">
                          {u.role !== 'admin' && (
                            <Button variant="outline" size="sm" onClick={() => setAccessTarget(u)}>
                              <KeyRound className="h-4 w-4" aria-hidden="true" /> Access
                            </Button>
                          )}
                          <Button variant={u.account_status === 'active' ? 'outline' : 'teal'} size="sm" onClick={() => { setReason(''); setStatusTarget(u); }}>
                            {u.account_status === 'active' ? 'Suspend' : 'Reactivate'}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Pagination total={query.data?.total ?? 0} limit={LIMIT} offset={offset} onChange={(o) => set({ offset: String(o) })} />

      <ConfirmDialog
        open={Boolean(statusTarget)}
        title={statusTarget?.account_status === 'active' ? `Suspend ${statusTarget?.full_name}?` : `Reactivate ${statusTarget?.full_name}?`}
        message={
          statusTarget?.account_status === 'active'
            ? 'The user will be signed out and blocked from signing in. Existing appointments are not cancelled automatically.'
            : 'The user will be able to sign in again.'
        }
        confirmLabel={statusTarget?.account_status === 'active' ? 'Suspend account' : 'Reactivate account'}
        tone={statusTarget?.account_status === 'active' ? 'danger' : 'teal'}
        loading={changeStatus.isPending}
        onClose={() => setStatusTarget(null)}
        onConfirm={() => {
          if (statusTarget?.account_status === 'active' && reason.trim().length < 3) {
            toast.error('Please record a reason for the suspension');
            return;
          }
          if (statusTarget) changeStatus.mutate(statusTarget);
        }}
      >
        <Textarea label={statusTarget?.account_status === 'active' ? 'Reason (required, kept in the audit log)' : 'Note (optional)'} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmDialog>
      <ConfirmDialog
        open={Boolean(roleTarget)}
        title="Change role"
        message={
          roleTarget && (
            <>
              Change <strong>{roleTarget.user.full_name}</strong> from <strong>{ROLE_LABELS[roleTarget.user.role]}</strong> to{' '}
              <strong>{ROLE_LABELS[roleTarget.role]}</strong>?
              {roleTarget.role === 'admin' && ' Administrators have full access to user data and settings.'}
              {roleTarget.role === 'staff' && ' Staff start with no permissions; choose them afterwards under Access.'}
              {roleTarget.user.role === 'staff' && ' Their staff permissions will be removed.'}
              {roleTarget.role === 'doctor' && ' They will still need verification before patients can book them.'}
            </>
          )
        }
        confirmLabel="Change role"
        tone={roleTarget?.role === 'admin' ? 'danger' : 'primary'}
        loading={changeRole.isPending}
        onClose={() => setRoleTarget(null)}
        onConfirm={() => roleTarget && changeRole.mutate(roleTarget)}
      />
      {accessTarget && <AccessModal user={accessTarget} canEditPermissions={isAdmin} onClose={() => setAccessTarget(null)} />}
    </div>
  );
}

function AccessModal({ user, canEditPermissions, onClose }: { user: AdminUser; canEditPermissions: boolean; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [permissions, setPermissions] = useState<Permission[]>(user.permissions);
  const [restrictions, setRestrictions] = useState<Restrictions>({
    can_send_messages: user.can_send_messages,
    can_post_reviews: user.can_post_reviews,
    can_book_appointments: user.can_book_appointments,
  });
  const isStaff = user.role === 'staff';
  const permissionsChanged = [...permissions].sort().join() !== [...user.permissions].sort().join();
  const restrictionsChanged = RESTRICTIONS.some((r) => restrictions[r.key] !== user[r.key]);

  const save = useMutation({
    mutationFn: async () => {
      if (isStaff && canEditPermissions && permissionsChanged) await api.post(`/admin/users/${user.id}/permissions`, { permissions });
      if (restrictionsChanged) await api.post(`/admin/users/${user.id}/restrictions`, restrictions);
    },
    onSuccess: () => {
      toast.success('Access updated');
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
      onClose();
    },
    onError: (err) => {
      toast.error('Could not update access', errorMessage(err));
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });

  const togglePermission = (p: Permission) => setPermissions((list) => (list.includes(p) ? list.filter((x) => x !== p) : [...list, p]));

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Access for ${user.full_name}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!permissionsChanged && !restrictionsChanged} loading={save.isPending} onClick={() => save.mutate()}>
            Save access
          </Button>
        </>
      }
    >
      <div className="space-y-6 text-sm">
        {isStaff && (
          <fieldset className="space-y-3">
            <legend className="font-semibold text-slate-900">Admin areas this staff member can use</legend>
            {!canEditPermissions && <p className="text-slate-500">Only administrators can change staff permissions.</p>}
            {PERMISSIONS.map((p) => (
              <div key={p.value}>
                <Checkbox label={p.label} checked={permissions.includes(p.value)} disabled={!canEditPermissions} onChange={() => togglePermission(p.value)} />
                <p className="ml-6 text-xs text-slate-500">{p.description}</p>
              </div>
            ))}
            <p className="text-xs text-slate-500">Role changes, staff permissions and system settings always stay with administrators.</p>
          </fieldset>
        )}
        <fieldset className="space-y-3">
          <legend className="font-semibold text-slate-900">What this user can post</legend>
          {RESTRICTIONS.map((r) => (
            <Checkbox
              key={r.key}
              label={r.label}
              checked={restrictions[r.key]}
              onChange={(e) => setRestrictions((v) => ({ ...v, [r.key]: e.target.checked }))}
            />
          ))}
          <p className="text-xs text-slate-500">Unticked actions are blocked in the database for this account. Existing content is not removed.</p>
        </fieldset>
      </div>
    </Modal>
  );
}

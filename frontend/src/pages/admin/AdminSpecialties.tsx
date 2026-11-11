import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Stethoscope } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { Card, PageHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Checkbox, Input, Textarea } from '../../components/ui/Field';
import { Badge } from '../../components/ui/Badge';
import { EmptyState, ErrorState, Spinner } from '../../components/ui/Feedback';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';

interface AdminSpecialty {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  doctor_count: number;
}

export function AdminSpecialtiesPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['admin', 'specialties'], queryFn: () => api.get<AdminSpecialty[]>('/admin/specialties') });
  const [editing, setEditing] = useState<Partial<AdminSpecialty> | null>(null);
  const [deleting, setDeleting] = useState<AdminSpecialty | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'specialties'] });
    void queryClient.invalidateQueries({ queryKey: ['specialties'] });
  };
  const save = useMutation({
    mutationFn: (s: Partial<AdminSpecialty>) => {
      const body = { name: s.name?.trim(), description: s.description?.trim() || null, is_active: s.is_active ?? true };
      return s.id ? api.patch(`/admin/specialties/${s.id}`, body) : api.post('/admin/specialties', body);
    },
    onSuccess: () => {
      toast.success('Specialty saved');
      setEditing(null);
      invalidate();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: (s: AdminSpecialty) => api.del(`/admin/specialties/${s.id}`),
    onSuccess: () => {
      toast.success('Specialty deleted');
      setDeleting(null);
      invalidate();
    },
    onError: (err) => {
      toast.error('Could not delete', errorMessage(err));
      setDeleting(null);
    },
  });

  return (
    <div>
      <PageHeader
        title="Specialty management"
        description="Specialties patients can filter by. Deactivate a specialty to hide it from new profiles without affecting existing doctors."
        action={
          <Button onClick={() => { setError(null); setEditing({ is_active: true }); }}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add specialty
          </Button>
        }
      />
      <Card>
        {query.isLoading ? (
          <Spinner />
        ) : query.isError ? (
          <div className="p-4">
            <ErrorState error={query.error} onRetry={() => query.refetch()} />
          </div>
        ) : query.data!.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={Stethoscope} title="No specialties yet" />
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {query.data!.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {s.name} {!s.is_active && <Badge>Inactive</Badge>}
                  </p>
                  {s.description && <p className="text-sm text-slate-500">{s.description}</p>}
                  <p className="text-xs text-slate-400">
                    {s.doctor_count} doctor{s.doctor_count === 1 ? '' : 's'} · /{s.slug}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => { setError(null); setEditing(s); }}>
                  Edit
                </Button>
                <Button variant="ghost" size="sm" className="text-red-700" onClick={() => setDeleting(s)} disabled={s.doctor_count > 0} title={s.doctor_count > 0 ? 'In use: deactivate instead' : undefined}>
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit specialty' : 'Add specialty'}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Go back
            </Button>
            <Button
              loading={save.isPending}
              onClick={() => {
                if (!editing?.name || editing.name.trim().length < 2) return setError('Name must be at least 2 characters');
                save.mutate(editing);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            {error && <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}
            <Input label="Name" required maxLength={80} value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <Textarea label="Description" rows={3} maxLength={500} value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            <Checkbox label="Active (visible to patients and doctors)" checked={editing.is_active ?? true} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} />
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Delete ${deleting?.name}?`}
        message="This permanently removes the specialty."
        confirmLabel="Delete"
        tone="danger"
        loading={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { PublicSettings, Specialty } from '../lib/types';

export function usePublicSettings() {
  const q = useQuery({ queryKey: ['settings', 'public'], queryFn: () => api.get<PublicSettings>('/settings/public'), staleTime: 5 * 60_000 });
  return { ...q, currency: q.data?.currency ?? 'KES' };
}

export function useSpecialties() {
  return useQuery({ queryKey: ['specialties'], queryFn: () => api.get<Specialty[]>('/specialties'), staleTime: 10 * 60_000 });
}

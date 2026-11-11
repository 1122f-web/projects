import { Link } from 'react-router-dom';
import { MapPin, Sparkles, Video, Building2 } from 'lucide-react';
import type { DoctorSummary } from '../../lib/types';
import { Avatar, Stars } from '../ui/Misc';
import { Badge } from '../ui/Badge';
import { formatMoney } from '../../lib/format';

export function DoctorCard({ doctor, currency, basePath = '/doctors' }: { doctor: DoctorSummary; currency: string; basePath?: string }) {
  const name = `${doctor.title} ${doctor.full_name}`;
  return (
    <article
      className={`flex flex-col rounded-xl border bg-white p-5 shadow-sm transition hover:shadow-md ${doctor.is_featured ? 'border-violet-300 ring-1 ring-violet-200' : 'border-slate-200'}`}
    >
      <div className="flex gap-4">
        <Avatar name={doctor.full_name} url={doctor.avatar_url} size="lg" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-slate-900">
            <Link to={`${basePath}/${doctor.id}`} className="hover:text-brand-700">
              {name}
            </Link>
          </h3>
          <p className="truncate text-sm text-slate-500">{doctor.specialties.map((s) => s.name).join(', ') || 'General'}</p>
          <div className="mt-1">
            {doctor.rating_count > 0 ? <Stars value={doctor.rating_avg} count={doctor.rating_count} /> : <span className="text-xs text-slate-400">No reviews yet</span>}
          </div>
        </div>
      </div>
      <dl className="mt-4 space-y-1.5 text-sm text-slate-600">
        {(doctor.city || doctor.clinic_name) && (
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-slate-400" aria-hidden="true" />
            <dt className="sr-only">Location</dt>
            <dd className="truncate">{[doctor.clinic_name, doctor.city].filter(Boolean).join(', ')}</dd>
          </div>
        )}
        {doctor.years_experience !== null && (
          <div className="text-slate-500">
            <dt className="sr-only">Experience</dt>
            <dd>{doctor.years_experience} years experience</dd>
          </div>
        )}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        {doctor.is_featured && (
          <Badge tone="purple">
            <Sparkles className="mr-1 h-3 w-3" aria-hidden="true" /> Featured
          </Badge>
        )}
        {doctor.is_pro && <Badge tone="blue">Pro</Badge>}
        {doctor.offers_online && (
          <Badge tone="blue">
            <Video className="mr-1 h-3 w-3" aria-hidden="true" /> Online
          </Badge>
        )}
        {doctor.offers_in_person && (
          <Badge tone="teal">
            <Building2 className="mr-1 h-3 w-3" aria-hidden="true" /> In person
          </Badge>
        )}
        {!doctor.is_accepting_patients && <Badge tone="gray">Not accepting bookings</Badge>}
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <p className="text-sm">
          <span className="font-semibold text-slate-900">{formatMoney(doctor.consultation_fee, currency)}</span>
          <span className="text-slate-500"> / visit</span>
        </p>
        <Link to={`${basePath}/${doctor.id}`} className="text-sm font-semibold text-brand-700 hover:underline">
          View profile
        </Link>
      </div>
    </article>
  );
}

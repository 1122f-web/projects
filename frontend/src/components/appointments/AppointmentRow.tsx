import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, ChevronRight, Video, FileUp } from 'lucide-react';
import type { Appointment } from '../../lib/types';
import { StatusBadge } from '../ui/Badge';
import { Avatar } from '../ui/Misc';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { DocumentUpload } from '../DocumentUpload';
import { PatientDocumentList } from '../PatientDocumentList';
import { consultationLabel, doctorName, formatDateTime } from '../../lib/format';

export function AppointmentRow({ appt, viewer, timeZone }: { appt: Appointment; viewer: 'patient' | 'doctor'; timeZone: string }) {
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  const other =
    viewer === 'patient'
      ? { name: doctorName(appt.doctor), avatar: appt.doctor?.profile?.avatar_url ?? null }
      : { name: appt.patient?.full_name ?? 'Patient', avatar: appt.patient?.avatar_url ?? null };

  return (
    <li>
      <div className="flex items-center gap-4 rounded-lg px-3 py-3 transition hover:bg-slate-50 focus-visible:bg-slate-50">
        <Link to={`/${viewer}/appointments/${appt.id}`} className="flex items-center gap-4 min-w-0 flex-1">
          <Avatar name={other.name} url={other.avatar} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-slate-900">{other.name}</p>
            <p className="truncate text-sm text-slate-500">{formatDateTime(appt.starts_at, timeZone)}</p>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
              {appt.consultation_type === 'online' ? <Video className="h-3.5 w-3.5" aria-hidden="true" /> : <Building2 className="h-3.5 w-3.5" aria-hidden="true" />}
              {consultationLabel(appt.consultation_type)}
            </p>
          </div>
          <StatusBadge status={appt.status} />
        </Link>

        {/* Upload Button for Doctors */}
        {viewer === 'doctor' && (
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setIsUploadOpen(true);
            }}
            className="flex items-center gap-1 text-xs shrink-0"
            title="Upload medical document for this patient"
          >
            <FileUp className="h-4 w-4" /> Upload Record
          </Button>
        )}

        {/* View/Download Records Button for Patients (or anyone who wants to view records from the list) */}
        {viewer === 'patient' && (
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setIsUploadOpen(true);
            }}
            className="flex items-center gap-1 text-xs shrink-0"
            title="View medical documents"
          >
            <FileUp className="h-4 w-4" /> View Records
          </Button>
        )}

        <Link to={`/${viewer}/appointments/${appt.id}`}>
          <ChevronRight className="h-5 w-5 shrink-0 text-slate-300" aria-hidden="true" />
        </Link>
      </div>

      {/* Modal popup containing DocumentUpload (for doctors) and PatientDocumentList (for everyone) */}
      <Modal
        open={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        title={`Medical Records for ${other.name}`}
      >
        <div className="p-2 space-y-4">
          {viewer === 'doctor' && (
            <DocumentUpload
              patientId={appt.patient_id}
              onUploadSuccess={() => {
                // Keep modal open so they can see the newly added file in the list below
              }}
            />
          )}

          <PatientDocumentList patientId={appt.patient_id} />
        </div>
      </Modal>
    </li>
  );
}
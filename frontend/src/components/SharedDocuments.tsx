import { useQuery } from '@tanstack/react-query';
import { FileText, Calendar } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { Card, CardHeader, CardBody } from './ui/Card';
import { PageLoader } from './ui/Feedback';

interface Medicine {
  name: string;
  dosage: string;
  frequency: string;
  duration: string;
}

interface PrescriptionRecord {
  id: string;
  diagnosis: string;
  medicines: Medicine[] | null;
  notes: string | null;
  issued_at: string;
}

interface SharedDocumentsProps {
  appointmentId: string;
}

export default function SharedDocuments({ appointmentId }: SharedDocumentsProps) {
  const { data: prescriptions, isLoading, isError, error } = useQuery<PrescriptionRecord[]>({
    queryKey: ['appointment-prescriptions', appointmentId],
    queryFn: () => api.get<PrescriptionRecord[]>(`/prescriptions?appointment_id=${encodeURIComponent(appointmentId)}`),
  });

  if (isLoading) return <PageLoader />;
  if (isError) return <p className="text-sm text-red-600">{errorMessage(error)}</p>;

  const list = prescriptions ?? [];

  return (
    <Card>
      <CardHeader 
        title="Shared Prescriptions & Medical Files" 
        description="All official documents and prescriptions issued during this consultation." 
      />
      <CardBody>
        {list.length === 0 ? (
          <p className="text-sm text-slate-500 py-4 text-center">No prescription documents shared for this appointment yet.</p>
        ) : (
          <div className="space-y-4">
            {list.map((p) => (
              <div key={p.id} className="p-4 bg-slate-50 border rounded-lg flex flex-col gap-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-cyan-100 text-cyan-700 rounded-lg">
                      <FileText className="h-6 w-6" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-800 text-sm">Official Medical Prescription</h4>
                      <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                        <Calendar className="h-3.5 w-3.5" /> {new Date(p.issued_at).toLocaleDateString()} at {new Date(p.issued_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-3 rounded border text-sm space-y-2">
                  <p><strong className="text-slate-700">Diagnosis:</strong> {p.diagnosis}</p>
                  <div>
                    <strong className="text-slate-700 block mb-1">Medications:</strong>
                    <ul className="list-disc list-inside space-y-1 text-xs text-slate-600">
                      {(p.medicines ?? []).map((med, idx) => (
                        <li key={idx}>
                          <span className="font-medium text-slate-800">{med.name}</span> — {med.dosage}, {med.frequency} for {med.duration}
                        </li>
                      ))}
                    </ul>
                  </div>
                  {p.notes && <p className="text-xs text-slate-500 pt-1 border-t"><strong className="text-slate-600">Notes:</strong> {p.notes}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
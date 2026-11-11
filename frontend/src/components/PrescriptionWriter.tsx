import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { generatePrescriptionPDF } from '../utils/generatePrescriptionPDF';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage } from '../lib/api';
import { useToast } from './ui/Toast';

interface Medicine {
  name: string;
  dosage: string;
  frequency: string;
  duration: string;
}

type MedicineField = keyof Medicine;

interface AppointmentData {
  id: string;
  conversation_id?: string;
  patient_id?: string;
  doctor_id?: string;
  patient?: { full_name: string; phone?: string; id?: string };
  doctor?: { full_name: string };
  patient_name?: string;
}

interface PrescriptionData {
  doctorName: string;
  patientName: string;
  date: string;
  diagnosis: string;
  medicines: Medicine[];
  notes: string;
}

export default function PrescriptionWriter() {
  const { me } = useAuth();
  const { appointmentId, patientName: urlPatientName } = useParams<{ appointmentId?: string; patientName?: string }>();
  const toast = useToast();

  const [doctorName, setDoctorName] = useState(me?.full_name || 'Doctor');
  const [patientName, setPatientName] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [notes, setNotes] = useState('');
  const [medicines, setMedicines] = useState<Medicine[]>([
    { name: '', dosage: '', frequency: '', duration: '' }
  ]);

  const { data: appointment } = useQuery<AppointmentData>({
    queryKey: ['appointment', appointmentId],
    queryFn: () => api.get<AppointmentData>(`/appointments/${appointmentId}`),
    enabled: Boolean(appointmentId),
  });

  useEffect(() => {
    if (me?.full_name) setDoctorName(me.full_name);
    if (appointment?.patient?.full_name) {
      setPatientName(appointment.patient.full_name);
    } else if (appointment?.patient_name) {
      setPatientName(appointment.patient_name);
    } else if (urlPatientName) {
      setPatientName(decodeURIComponent(urlPatientName));
    }
  }, [me, appointment, urlPatientName]);

  const handleAddMedicine = () => {
    setMedicines([...medicines, { name: '', dosage: '', frequency: '', duration: '' }]);
  };

  const handleMedicineChange = (index: number, field: MedicineField, value: string) => {
    setMedicines((current) =>
      current.map((medicine, medicineIndex) =>
        medicineIndex === index ? { ...medicine, [field]: value } : medicine,
      ),
    );
  };

  const getPrescriptionData = (): PrescriptionData | null => {
    const normalizedPatientName = patientName.trim();
    if (!normalizedPatientName) {
      toast.error('Patient Name is required', 'Please provide a patient name.');
      return null;
    }
    const normalizedDiagnosis = diagnosis.trim();
    if (!normalizedDiagnosis) {
      toast.error('Diagnosis is required', 'Please provide a diagnosis.');
      return null;
    }

    const completedMedicines: Medicine[] = [];
    for (const medicine of medicines) {
      const name = medicine.name.trim();
      if (!name) continue;

      const dosage = medicine.dosage.trim();
      const frequency = medicine.frequency.trim();
      const duration = medicine.duration.trim();
      if (!dosage || !frequency || !duration) {
        toast.error('Incomplete medication', 'Provide dosage, frequency, and duration for each medication.');
        return null;
      }
      completedMedicines.push({ name, dosage, frequency, duration });
    }

    return {
      doctorName: doctorName.trim(),
      patientName: normalizedPatientName,
      date: new Date().toLocaleDateString(),
      diagnosis: normalizedDiagnosis,
      medicines: completedMedicines,
      notes: notes.trim(),
    };
  };

  const handleDownload = () => {
    const prescription = getPrescriptionData();
    if (!prescription) return;
    generatePrescriptionPDF(prescription);
    toast.success('PDF Generated', 'Prescription downloaded successfully.');
  };

  const handleSendToPatient = async () => {
    const prescription = getPrescriptionData();
    if (!prescription) return;
    if (!appointmentId) {
      toast.error('Appointment required', 'Open a prescription from an appointment to save and share it.');
      return;
    }
    
    // 1. Generate & download local PDF
    generatePrescriptionPDF(prescription);

    try {
      // 2. Save permanent record to the `prescriptions` table
      await api.post('/prescriptions', {
        appointment_id: appointmentId,
        doctor_id: appointment?.doctor_id || me?.id,
        patient_id: appointment?.patient_id,
        diagnosis: prescription.diagnosis,
        medicines: prescription.medicines,
        notes: prescription.notes,
      });

      // 3. Also post to chat if conversation exists
      if (appointment?.conversation_id) {
        const medListSummary = prescription.medicines
          .map(m => `• ${m.name} (${m.dosage}, ${m.frequency} for ${m.duration})`)
          .join('\n');

        const chatMessage = `📄 [Official Medical Prescription Issued]\n\nDiagnosis: ${prescription.diagnosis}\n\nPrescribed Medications:\n${medListSummary || 'None specified'}\n\nNotes: ${prescription.notes || 'Follow standard instructions.'}`;
        
        await api.post(`/conversations/${appointment.conversation_id}/messages`, { body: chatMessage });
      }

      toast.success('Sent & Shared!', 'Prescription saved and sent directly to the patient.');
    } catch (err: unknown) {
      toast.error('Unable to share prescription', errorMessage(err));
    }
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow-md max-w-2xl mx-auto my-6 border">
      <h3 className="text-2xl font-bold mb-6 text-slate-800 border-b pb-2">Issue Medical Prescription</h3>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium text-slate-700">Doctor Name</label>
          <input type="text" value={doctorName} onChange={(e) => setDoctorName(e.target.value)} className="w-full mt-1 p-2 border rounded-md bg-slate-50" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Patient Name</label>
          <input type="text" value={patientName} onChange={(e) => setPatientName(e.target.value)} placeholder="Patient name" className="w-full mt-1 p-2 border rounded-md bg-slate-50" />
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-slate-700">Diagnosis</label>
        <input type="text" value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder="e.g. Acute Upper Respiratory Infection" className="w-full mt-1 p-2 border rounded-md" />
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-slate-700 mb-2">Medications</label>
        {medicines.map((med, index) => (
          <div key={index} className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-2 p-3 bg-slate-50 rounded border">
            <input type="text" placeholder="Medication name" value={med.name} onChange={(e) => handleMedicineChange(index, 'name', e.target.value)} className="p-1.5 border rounded bg-white text-sm" />
            <input type="text" placeholder="Dosage" value={med.dosage} onChange={(e) => handleMedicineChange(index, 'dosage', e.target.value)} className="p-1.5 border rounded bg-white text-sm" />
            <input type="text" placeholder="Frequency" value={med.frequency} onChange={(e) => handleMedicineChange(index, 'frequency', e.target.value)} className="p-1.5 border rounded bg-white text-sm" />
            <input type="text" placeholder="Duration" value={med.duration} onChange={(e) => handleMedicineChange(index, 'duration', e.target.value)} className="p-1.5 border rounded bg-white text-sm" />
          </div>
        ))}
        <button type="button" onClick={handleAddMedicine} className="text-sm text-cyan-600 hover:text-cyan-800 font-medium mt-1">+ Add Another Medication</button>
      </div>

      <div className="mb-6">
        <label className="block text-sm font-medium text-slate-700">Notes / Instructions</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Complete full dosage." className="w-full mt-1 p-2 border rounded-md" />
      </div>

      <div className="flex gap-4">
        <button onClick={handleDownload} className="flex-1 bg-slate-700 text-white py-3 rounded-md hover:bg-slate-800 font-medium">Download PDF Only</button>
        <button onClick={handleSendToPatient} className="flex-1 bg-cyan-600 text-white py-3 rounded-md hover:bg-cyan-700 font-medium">Send & Share with Patient</button>
      </div>
    </div>
  );
}
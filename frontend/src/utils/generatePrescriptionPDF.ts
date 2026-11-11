import jsPDF from 'jspdf';

interface PrescriptionData {
  doctorName: string;
  patientName: string;
  date: string;
  diagnosis: string;
  medicines: { name: string; dosage: string; frequency: string; duration: string }[];
  notes?: string;
}

export const generatePrescriptionPDF = (data: PrescriptionData) => {
  const doc = new jsPDF();

  // --- Header ---
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(14, 116, 144); // Medical blue tone
  doc.text("MediConnect", 20, 20);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text("Digital Health & Teleconsultation Services", 20, 26);
  doc.text("Email: support@mediconnect.co.ke | Tel: +254 700 000000", 20, 32);

  // Divider Line
  doc.setDrawColor(200, 200, 200);
  doc.line(20, 38, 190, 38);

  // --- Metadata (Doctor & Patient info) ---
  doc.setFontSize(11);
  doc.setTextColor(50, 50, 50);
  
  doc.setFont("helvetica", "bold");
  doc.text("Patient Name:", 20, 48);
  doc.setFont("helvetica", "normal");
  doc.text(data.patientName, 55, 48);

  doc.setFont("helvetica", "bold");
  doc.text("Prescribing Doctor:", 20, 56);
  doc.setFont("helvetica", "normal");
  doc.text(`Dr. ${data.doctorName}`, 55, 56);

  doc.setFont("helvetica", "bold");
  doc.text("Date:", 135, 48);
  doc.setFont("helvetica", "normal");
  doc.text(data.date, 150, 48);

  doc.setFont("helvetica", "bold");
  doc.text("Diagnosis:", 20, 64);
  doc.setFont("helvetica", "normal");
  doc.text(data.diagnosis, 55, 64);

  // Divider Line
  doc.line(20, 72, 190, 72);

  // --- Rx Symbol ---
  doc.setFont("times", "bold");
  doc.setFontSize(28);
  doc.setTextColor(14, 116, 144);
  doc.text("Rx", 20, 88);

  // --- Medications Table Header ---
  let startY = 98;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  doc.text("NO.", 20, startY);
  doc.text("MEDICATION & STRENGTH", 35, startY);
  doc.text("DOSAGE", 115, startY);
  doc.text("DURATION", 155, startY);

  doc.setDrawColor(220, 220, 220);
  doc.line(20, startY + 3, 190, startY + 3);

  // --- Medications List ---
  startY += 10;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(50, 50, 50);

  data.medicines.forEach((med, index) => {
    const y = startY + (index * 10);
    doc.text(`${index + 1}.`, 20, y);
    doc.text(med.name, 35, y);
    doc.text(`${med.dosage} (${med.frequency})`, 115, y);
    doc.text(med.duration, 155, y);
  });

  // --- Additional Doctor Notes ---
  const notesY = startY + (data.medicines.length * 10) + 15;
  if (data.notes) {
    doc.setFont("helvetica", "bold");
    doc.text("Additional Notes / Instructions:", 20, notesY);
    doc.setFont("helvetica", "normal");
    doc.text(data.notes, 20, notesY + 6, { maxWidth: 170 });
  }

  // --- Footer / Signature ---
  const footerY = notesY + 35;
  doc.line(130, footerY, 190, footerY);
  doc.setFont("helvetica", "bold");
  doc.text(`Dr. ${data.doctorName}`, 130, footerY + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Authorized Signature & Stamp", 130, footerY + 12);

  // Trigger browser download
  doc.save(`Prescription_${data.patientName.replace(/\s+/g, '_')}.pdf`);
};
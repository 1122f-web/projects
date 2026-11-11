import { useEffect, useState } from 'react';
import { FileText, Download } from 'lucide-react';
import { api, errorMessage } from '../lib/api';

interface PatientDocument {
  id: string;
  file_name: string;
  file_size: number;
  created_at: string;
}

interface SignedUrlResponse {
  signed_url: string;
}

interface PatientDocumentListProps {
  patientId: string;
}

export function PatientDocumentList({ patientId }: PatientDocumentListProps) {
  const [docs, setDocs] = useState<PatientDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDocs() {
      try {
        const data = await api.get<PatientDocument[]>(`/documents/patient/${patientId}`);
        setDocs(data);
      } catch (err: unknown) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    }
    if (patientId) fetchDocs();
  }, [patientId]);

  const handleDownload = async (docId: string, fileName: string) => {
    try {
      setDownloadingId(docId);
      const { signed_url } = await api.get<SignedUrlResponse>(`/documents/${docId}/download`);
      const response = await fetch(signed_url);
      if (!response.ok) throw new Error(`Download failed (${response.status})`);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = fileName || 'medical_document.pdf';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err: unknown) {
      alert('Failed to download document: ' + errorMessage(err));
    } finally {
      setDownloadingId(null);
    }
  };

  if (loading) return <p className="text-sm text-slate-500">Loading documents...</p>;
  if (error) return <p className="text-sm text-red-500">{error}</p>;
  if (docs.length === 0) return <p className="text-sm text-slate-500">No medical documents uploaded yet.</p>;

  return (
    <div className="space-y-3 mt-4">
      <h4 className="font-semibold text-slate-800 text-sm">Medical Records & Documents</h4>
      <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg bg-white">
        {docs.map((doc) => (
          <li key={doc.id} className="flex items-center justify-between p-3 hover:bg-slate-50">
            <div className="flex items-center gap-3 min-w-0">
              <FileText className="h-5 w-5 text-blue-600 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">{doc.file_name}</p>
                <p className="text-xs text-slate-500">
                  Uploaded on {new Date(doc.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>
            <button
              onClick={() => handleDownload(doc.id, doc.file_name)}
              disabled={downloadingId === doc.id}
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium px-3 py-1.5 rounded border border-blue-200 hover:bg-blue-50 transition shrink-0 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" /> 
              {downloadingId === doc.id ? 'Downloading...' : 'Download'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
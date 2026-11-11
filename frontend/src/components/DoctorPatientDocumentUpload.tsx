import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { Search, FileText } from 'lucide-react';

interface Patient {
  id: string;
  full_name: string;
  patient_code: string;
}

export function DoctorPatientDocumentUpload() {
  const [searchQuery, setSearchQuery] = useState('');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Search patients live as the doctor types a name or code
  useEffect(() => {
    const delayDebounce = setTimeout(async () => {
      if (searchQuery.trim().length < 2) {
        setPatients([]);
        return;
      }
      try {
        const data = await api.get<Patient[]>(`/documents/patients/search?query=${encodeURIComponent(searchQuery)}`);
        setPatients(data);
      } catch (err) {
        console.error('Failed to search patients', errorMessage(err));
      }
    }, 300);

    return () => clearTimeout(delayDebounce);
  }, [searchQuery]);

  const handleUpload = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedPatient) {
      setError('Please select a patient from the search results.');
      return;
    }
    if (!file) {
      setError('Please select a file to upload.');
      return;
    }

    setUploading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('patient_id', selectedPatient.id);

      const sbKey = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
      let accessToken = '';
      if (sbKey) {
        const sessionData = JSON.parse(localStorage.getItem(sbKey) || '{}');
        accessToken = sessionData?.access_token || '';
      }

      const response = await fetch('/api/documents/upload', {
        method: 'POST',
        headers: {
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        let errorMsg = `Upload failed with status ${response.status}`;
        try {
          const json = JSON.parse(text);
          errorMsg = json.error || json.message || text;
        } catch {
          errorMsg = text || errorMsg;
        }
        throw new Error(errorMsg);
      }

      setSuccessMsg(`Document successfully uploaded for ${selectedPatient.full_name}!`);
      setFile(null);
      setSelectedPatient(null);
      setSearchQuery('');
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow-md border border-gray-200 max-w-lg">
      <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
        <FileText className="h-5 w-5 text-blue-600" /> Patient Document Upload Portal
      </h3>

      <form onSubmit={handleUpload} className="space-y-4 relative">
        {/* Patient Search Input */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Search Patient by Name or Code</label>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="e.g. Henry Mwami or PAT-8492"
              value={selectedPatient ? `${selectedPatient.full_name} (${selectedPatient.patient_code || 'No Code'})` : searchQuery}
              onChange={(e) => {
                setSelectedPatient(null);
                setSearchQuery(e.target.value);
              }}
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          {/* Search Dropdown Results */}
          {!selectedPatient && patients.length > 0 && (
            <ul className="absolute z-10 w-full bg-white border border-gray-200 rounded-md shadow-lg mt-1 max-h-48 overflow-y-auto">
              {patients.map((p) => (
                <li
                  key={p.id}
                  onClick={() => {
                    setSelectedPatient(p);
                    setSearchQuery('');
                    setPatients([]);
                  }}
                  className="px-4 py-2 text-sm hover:bg-blue-50 cursor-pointer flex justify-between items-center"
                >
                  <span className="font-medium text-gray-900">{p.full_name}</span>
                  <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-mono">{p.patient_code || 'PAT-NEW'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* File Selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Select Document (PDF, Image)</label>
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
        </div>

        {file && <p className="text-xs text-slate-600">Selected file: <strong>{file.name}</strong></p>}

        {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded border border-red-200">{error}</div>}
        {successMsg && <div className="text-sm text-green-600 bg-green-50 p-2 rounded border border-green-200">{successMsg}</div>}

        <button
          type="submit"
          disabled={uploading || !selectedPatient || !file}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-md font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {uploading ? 'Uploading...' : 'Upload to Patient File'}
        </button>
      </form>
    </div>
  );
}
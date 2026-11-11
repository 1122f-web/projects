import { useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { errorMessage } from '../lib/api';

interface DocumentUploadProps {
  patientId: string;
  onUploadSuccess?: () => void;
}

export function DocumentUpload({ patientId, onUploadSuccess }: DocumentUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError(null);
      setSuccessMsg(null);
    }
  };

  const handleUpload = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file) {
      setError('Please select a file to upload.');
      return;
    }

    if (!patientId) {
      setError('Patient ID is missing.');
      return;
    }

    setUploading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('patient_id', patientId);

      // Extract Supabase auth token from local storage
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

      setSuccessMsg('Document uploaded successfully!');
      setFile(null);
      if (onUploadSuccess) {
        setTimeout(() => {
          onUploadSuccess();
        }, 1000);
      }
    } catch (err: unknown) {
      // Safely extract string message to prevent [object Object] rendering
      setError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-4 bg-white rounded-lg shadow-md border border-gray-200 max-w-md">
      <h3 className="text-lg font-semibold text-gray-800 mb-3">Upload Medical Document</h3>
      
      <form onSubmit={handleUpload} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Select File (PDF, Image, etc.)</label>
          <input
            type="file"
            onChange={handleFileChange}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
        </div>

        {file && (
          <p className="text-xs text-slate-600 truncate">Selected: <strong>{file.name}</strong></p>
        )}

        {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded border border-red-200">{error}</div>}
        {successMsg && <div className="text-sm text-green-600 bg-green-50 p-2 rounded border border-green-200">{successMsg}</div>}

        <button
          type="submit"
          disabled={uploading || !file}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-md font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {uploading ? 'Uploading...' : 'Upload Document'}
        </button>
      </form>
    </div>
  );
}
import { serviceClient } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';

const BUCKET_NAME = 'medical-documents';

interface UploadOptions {
  userId: string;
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
}

/** Uploads a file into a user's dedicated medical documents folder */
export async function uploadMedicalDocument({ userId, fileBuffer, fileName, mimeType }: UploadOptions) {
  const filePath = `${userId}/${Date.now()}_${fileName}`;

  const { data, error } = await serviceClient.storage
    .from(BUCKET_NAME)
    .upload(filePath, fileBuffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (error) {
    console.error('[Storage Error - Upload]:', error);
    throw new HttpError(500, 'Failed to upload document.', 'storage_upload_error');
  }

  return { path: data.path, filePath };
}

/** Generates a temporary signed URL to securely view/download a private document */
export async function getDocumentSignedUrl(filePath: string, expiresInSeconds: number = 3600) {
  const { data, error } = await serviceClient.storage
    .from(BUCKET_NAME)
    .createSignedUrl(filePath, expiresInSeconds);

  if (error || !data) {
    console.error('[Storage Error - Signed URL]:', error);
    throw new HttpError(404, 'Document not found or inaccessible.', 'storage_url_error');
  }

  return data.signedUrl;
}
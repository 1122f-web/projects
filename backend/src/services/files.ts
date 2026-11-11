import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { badRequest } from '../lib/errors.js';

export type AllowedMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

const extensions: Record<AllowedMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/** Detects the real file type from its leading bytes (never trust the client's MIME type). */
export function detectMime(buf: Buffer): AllowedMime | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  if (buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  return null;
}

export function sanitizeFileName(name: string): string {
  const base = name.normalize('NFKC').replace(/[/\\]/g, '_');
  const cleaned = base.replace(/[^\w.\- ()]/g, '_').replace(/_+/g, '_').trim();
  return (cleaned || 'file').slice(0, 120);
}

export interface ValidatedFile {
  buffer: Buffer;
  mime: AllowedMime;
  size: number;
  originalName: string;
  extension: string;
}

/** Validates an uploaded file's real type and size. */
export function validateFile(
  file: Express.Multer.File | undefined,
  allowed: readonly AllowedMime[],
  maxBytes: number,
): ValidatedFile {
  if (!file) throw badRequest('Please attach a file');
  if (file.size === 0) throw badRequest('The file is empty');
  if (file.size > maxBytes) throw badRequest(`The file must be smaller than ${Math.round(maxBytes / 1048576)} MB`);
  const mime = detectMime(file.buffer);
  if (!mime || !allowed.includes(mime)) {
    throw badRequest(`Unsupported file type. Allowed: ${allowed.map((m) => extensions[m]).join(', ')}`);
  }
  return {
    buffer: file.buffer,
    mime,
    size: file.size,
    originalName: sanitizeFileName(file.originalname),
    extension: extensions[mime],
  };
}

export function objectPath(folder: string, file: ValidatedFile): string {
  return `${folder}/${randomUUID()}.${file.extension}`;
}

/** Multer configured to keep files in memory with hard limits. */
export function uploader(maxBytes: number, maxFiles = 1) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: maxFiles, fields: 20, fieldSize: 8 * 1024 },
  });
}

export const MB = 1024 * 1024;
export const IMAGE_TYPES: readonly AllowedMime[] = ['image/jpeg', 'image/png', 'image/webp'];
export const DOCUMENT_TYPES: readonly AllowedMime[] = ['application/pdf', 'image/jpeg', 'image/png'];
export const ATTACHMENT_TYPES: readonly AllowedMime[] = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

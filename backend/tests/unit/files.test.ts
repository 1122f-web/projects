import { describe, expect, it } from 'vitest';
import { ATTACHMENT_TYPES, detectMime, sanitizeFileName, validateFile } from '../../src/services/files.js';

const file = (buffer: Buffer, originalname = 'x.bin') =>
  ({ buffer, size: buffer.length, originalname, mimetype: 'application/pdf' }) as Express.Multer.File;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const PDF = Buffer.from('%PDF-1.7\n...');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);

describe('detectMime', () => {
  it('recognises allowed types by their magic bytes', () => {
    expect(detectMime(PNG)).toBe('image/png');
    expect(detectMime(JPEG)).toBe('image/jpeg');
    expect(detectMime(PDF)).toBe('application/pdf');
    expect(detectMime(WEBP)).toBe('image/webp');
  });

  it('rejects anything else, whatever the file is called', () => {
    expect(detectMime(Buffer.from('<script>alert(1)</script>'))).toBeNull();
    expect(detectMime(Buffer.from('MZ\x90\x00'))).toBeNull(); // Windows executable
    expect(detectMime(Buffer.alloc(0))).toBeNull();
  });
});

describe('validateFile', () => {
  it('returns the detected type and a safe name', () => {
    const v = validateFile(file(PDF, '../../etc/report.pdf'), ATTACHMENT_TYPES, 1024);
    expect(v.mime).toBe('application/pdf');
    expect(v.extension).toBe('pdf');
    expect(v.originalName).not.toContain('/');
  });

  it('ignores the client-declared MIME type', () => {
    expect(() => validateFile(file(Buffer.from('not a pdf'), 'evil.pdf'), ATTACHMENT_TYPES, 1024)).toThrow(/Unsupported file type/);
  });

  it('rejects missing, empty, oversized and disallowed files', () => {
    expect(() => validateFile(undefined, ATTACHMENT_TYPES, 1024)).toThrow(/attach a file/);
    expect(() => validateFile(file(Buffer.alloc(0)), ATTACHMENT_TYPES, 1024)).toThrow(/empty/);
    expect(() => validateFile(file(Buffer.concat([PDF, Buffer.alloc(2048)])), ATTACHMENT_TYPES, 1024)).toThrow(/smaller than/);
    expect(() => validateFile(file(PDF), ['image/png'], 1024)).toThrow(/Allowed: png/);
  });
});

describe('sanitizeFileName', () => {
  it('strips path separators and odd characters and caps the length', () => {
    expect(sanitizeFileName('a/b\\c.pdf')).toBe('a_b_c.pdf');
    expect(sanitizeFileName('<img onerror=x>.png')).not.toMatch(/[<>=]/);
    expect(sanitizeFileName('x'.repeat(300))).toHaveLength(120);
    expect(sanitizeFileName('')).toBe('file');
  });
});

import { Router } from 'express';
import multer from 'multer';
import { authOf, requireAuth } from '../middleware/auth.js';
import { uploadMedicalDocument, getDocumentSignedUrl } from '../services/storage.js';
import { parse, idParams } from '../lib/validate.js';
import { check } from '../lib/errors.js';
import { serviceClient } from '../lib/supabase.js';

const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 },
});

export const documentsRouter = Router();

documentsRouter.use(requireAuth());

/** POST /api/documents/upload: Upload lab report or medical document */
documentsRouter.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided' });
  }

  const targetPatientId = req.body.patient_id;
  if (!targetPatientId) {
    return res.status(400).json({ error: 'Patient ID is required' });
  }

  const { userId: authenticatedUserId } = authOf(req);

  const result = await uploadMedicalDocument({
    userId: targetPatientId,
    fileBuffer: req.file.buffer,
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
  });

  const documentRecord = check(
    await serviceClient
      .from('medical_documents')
      .insert({
        patient_id: targetPatientId,
        uploaded_by: authenticatedUserId,
        file_path: result.filePath,
        file_name: req.file.originalname,
        mime_type: req.file.mimetype,
        file_size: req.file.size,
      })
      .select()
      .single()
  );

  res.status(201).json(documentRecord);
});

/** GET /api/documents/patients/search?query=... : Search patients by name or code */
documentsRouter.get('/patients/search', async (req, res) => {
  const query = (req.query.query as string || '').trim();
  
  if (!query) {
    return res.json([]);
  }

  const { data, error } = await serviceClient
    .from('profiles')
    .select('id, full_name, patient_code, email')
    .or(`full_name.ilike.%${query}%,patient_code.ilike.%${query}%`)
    .eq('role', 'patient')
    .limit(10);

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json(data);
});

/** GET /api/documents/patient/:patientId: Get all documents for a patient */
documentsRouter.get('/patient/:patientId', async (req, res) => {
  const { patientId } = req.params;

  const docs = check(
    await serviceClient
      .from('medical_documents')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
  );

  res.json(docs);
});

/** GET /api/documents/:id/download: Get secure signed URL for viewing/downloading */
documentsRouter.get('/:id/download', async (req, res) => {
  const { id } = parse(idParams, req.params);
  
  const doc = check(
    await serviceClient
      .from('medical_documents')
      .select('*')
      .eq('id', id)
      .single()
  );

  const signedUrl = await getDocumentSignedUrl(doc.file_path);
  res.json({ signed_url: signedUrl });
});
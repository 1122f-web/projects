import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS, authOf, requireAuth, requirePermission, requireRole } from '../middleware/auth.js';
import { check, checkMaybe, conflict, notFound } from '../lib/errors.js';
import { idParams, optionalText, parse, trimmed } from '../lib/validate.js';
import { adminWriteLimiter } from '../middleware/rateLimit.js';
import { serviceClient } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { APPOINTMENT_SELECT } from './appointments.js';

export const adminRouter = Router();
adminRouter.use(requireAuth(), requireRole('admin', 'staff'));
adminRouter.post('/{*any}', adminWriteLimiter);
adminRouter.put('/{*any}', adminWriteLimiter);
adminRouter.patch('/{*any}', adminWriteLimiter);
adminRouter.delete('/{*any}', adminWriteLimiter);

// Staff reach each area only with its permission; administrators reach all of them.
adminRouter.use('/users', requirePermission('users'));
adminRouter.use('/verifications', requirePermission('verifications'));
adminRouter.use('/appointments', requirePermission('appointments'));
adminRouter.use('/specialties', requirePermission('specialties'));
adminRouter.use(['/reviews', '/reports'], requirePermission('reviews'));
adminRouter.use(['/audit-logs', '/contact-messages'], requirePermission('activity'));
adminRouter.use('/plan-requests', requirePermission('plans'));
adminRouter.use('/settings', requireRole('admin'));

const page = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

/** GET /api/admin/stats */
adminRouter.get('/stats', async (req, res) => {
  const { db } = authOf(req);
  res.json(check(await db.rpc('admin_stats')));
});

// ---------------------------------------------------------------- users
const usersQuery = page.extend({
  search: z.string().trim().max(100).optional(),
  role: z.enum(['patient', 'doctor', 'admin', 'staff']).optional(),
  status: z.enum(['active', 'suspended']).optional(),
});

/** GET /api/admin/users */
adminRouter.get('/users', async (req, res) => {
  const { db } = authOf(req);
  const q = parse(usersQuery, req.query);
  res.json(
    check(
      await db.rpc('admin_list_users', {
        p_search: q.search ?? null,
        p_role: q.role ?? null,
        p_status: q.status ?? null,
        p_limit: q.limit,
        p_offset: q.offset,
      }),
    ),
  );
});

const statusBody = z.object({ status: z.enum(['active', 'suspended']), reason: optionalText(500) });

/** POST /api/admin/users/:id/status: suspend or reactivate (also blocks sign-in at the Auth level). */
adminRouter.post('/users/:id/status', async (req, res) => {
  const { db } = authOf(req);
  const { id } = parse(idParams, req.params);
  const body = parse(statusBody, req.body);
  check(await db.rpc('admin_set_account_status', { p_user_id: id, p_status: body.status, p_reason: body.reason ?? null }));

  // Ban/unban in Supabase Auth so a suspended user cannot sign in or refresh tokens.
  const { error } = await serviceClient.auth.admin.updateUserById(id, {
    ban_duration: body.status === 'suspended' ? '876000h' : 'none',
  });
  if (error) {
    logger.error({ err: error, userId: id }, 'auth ban update failed');
    res.json({ status: body.status, warning: 'Account status saved, but the sign-in block could not be updated. Try again.' });
    return;
  }
  res.json({ status: body.status });
});

const roleBody = z.object({ role: z.enum(['patient', 'doctor', 'admin', 'staff']) });

/** POST /api/admin/users/:id/role: change a user's role (administrators only; audited; not your own role). */
adminRouter.post('/users/:id/role', requireRole('admin'), async (req, res) => {
  const { db } = authOf(req);
  const { id } = parse(idParams, req.params);
  const body = parse(roleBody, req.body);
  check(await db.rpc('admin_set_user_role', { p_user_id: id, p_role: body.role }));
  res.json({ role: body.role });
});

const permissionsBody = z.object({ permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length) });

/** POST /api/admin/users/:id/permissions: set the admin areas a staff account may use (administrators only). */
adminRouter.post('/users/:id/permissions', requireRole('admin'), async (req, res) => {
  const { db } = authOf(req);
  const { id } = parse(idParams, req.params);
  const body = parse(permissionsBody, req.body);
  check(await db.rpc('admin_set_staff_permissions', { p_user_id: id, p_permissions: body.permissions }));
  res.json({ permissions: [...new Set(body.permissions)].sort() });
});

const restrictionsBody = z.object({
  can_send_messages: z.boolean(),
  can_post_reviews: z.boolean(),
  can_book_appointments: z.boolean(),
});

/** POST /api/admin/users/:id/restrictions: allow or block messaging, reviews and booking for one account. */
adminRouter.post('/users/:id/restrictions', async (req, res) => {
  const { db } = authOf(req);
  const { id } = parse(idParams, req.params);
  const body = parse(restrictionsBody, req.body);
  check(
    await db.rpc('admin_set_user_restrictions', {
      p_user_id: id,
      p_can_send_messages: body.can_send_messages,
      p_can_post_reviews: body.can_post_reviews,
      p_can_book_appointments: body.can_book_appointments,
    }),
  );
  res.json(body);
});

// ---------------------------------------------------------------- verification
const VERIFICATION_SELECT = `id, doctor_id, license_number, issuing_authority, qualifications, document_paths, status,
  payment_reference, admin_notes, reviewed_by, reviewed_at, created_at,
  doctor:doctor_profiles!doctor_verification_requests_doctor_id_fkey(id, title, years_experience, city, clinic_name,
    verification_status, profile:profiles!doctor_profiles_id_fkey(full_name, avatar_url, phone))`;

/** GET /api/admin/verifications?status=pending */
adminRouter.get('/verifications', async (req, res) => {
  const { db } = authOf(req);
  const q = parse(page.extend({ status: z.enum(['pending', 'approved', 'rejected']).optional() }), req.query);
  let query = db
    .from('doctor_verification_requests')
    .select(VERIFICATION_SELECT, { count: 'exact' })
    .order('created_at', { ascending: q.status === 'pending' });
  if (q.status) query = query.eq('status', q.status);
  const { data, error, count } = await query.range(q.offset, q.offset + q.limit - 1);
  check({ data, error });
  res.json({ total: count ?? 0, items: data });
});

/** GET /api/admin/verifications/:id: includes signed URLs (10 minutes) for the documents. */
adminRouter.get('/verifications/:id', async (req, res) => {
  const { db } = authOf(req);
  const { id } = parse(idParams, req.params);
  const row = checkMaybe(await db.from('doctor_verification_requests').select(VERIFICATION_SELECT).eq('id', id).maybeSingle());
  if (!row) throw notFound('Verification request not found');
  const specialties = check(
    await db.from('doctor_specialties').select('specialty:specialties(name)').eq('doctor_id', row.doctor_id),
  );
  const documents = await Promise.all(
    (row.document_paths as string[]).map(async (path, index) => {
      const { data } = await db.storage.from('verification-documents').createSignedUrl(path, 600);
      return { index, name: path.split('/').pop(), url: data?.signedUrl ?? null };
    }),
  );
  res.json({ ...row, documents, specialties });
});

const decisionBody = z.object({ approve: z.boolean(), notes: optionalText(1000) });

/** POST /api/admin/verifications/:id/decision */
adminRouter.post('/verifications/:id/decision', async (req, res) => {
  const { db } = authOf(req);
  const { id } = parse(idParams, req.params);
  const body = parse(decisionBody, req.body);
  check(await db.rpc('admin_review_verification', { p_request_id: id, p_approve: body.approve, p_notes: body.notes ?? null }));
  res.json({ status: body.approve ? 'approved' : 'rejected' });
});

// ---------------------------------------------------------------- doctor plans
const PLAN_REQUEST_SELECT = `id, doctor_id, plan, periods, amount, payment_reference, status, admin_notes, reviewed_at, created_at,
  doctor:doctor_profiles!doctor_plan_requests_doctor_id_fkey(id, title, pro_until, featured_until,
    profile:profiles!doctor_profiles_id_fkey(full_name, avatar_url))`;

/** GET /api/admin/plan-requests?status=pending */
adminRouter.get('/plan-requests', async (req, res) => {
  const { db } = authOf(req);
  const q = parse(page.extend({ status: z.enum(['pending', 'approved', 'rejected']).optional() }), req.query);
  let query = db
    .from('doctor_plan_requests')
    .select(PLAN_REQUEST_SELECT, { count: 'exact' })
    .order('created_at', { ascending: q.status === 'pending' });
  if (q.status) query = query.eq('status', q.status);
  const { data, error, count } = await query.range(q.offset, q.offset + q.limit - 1);
  check({ data, error });
  res.json({ total: count ?? 0, items: data });
});

/** POST /api/admin/plan-requests/:id/decision: confirm the payment (activates the plan) or reject it. */
adminRouter.post('/plan-requests/:id/decision', async (req, res) => {
  const { db } = authOf(req);
  const { id } = parse(idParams, req.params);
  const body = parse(decisionBody, req.body);
  check(await db.rpc('admin_review_plan_request', { p_request_id: id, p_approve: body.approve, p_notes: body.notes ?? null }));
  res.json({ status: body.approve ? 'approved' : 'rejected' });
});

// ---------------------------------------------------------------- appointments
const apptQuery = page.extend({
  status: z.enum(['pending', 'confirmed', 'rejected', 'cancelled', 'completed', 'rescheduled']).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

/** GET /api/admin/appointments */
adminRouter.get('/appointments', async (req, res) => {
  const { db } = authOf(req);
  const q = parse(apptQuery, req.query);
  let query = db
    .from('appointments')
    .select(APPOINTMENT_SELECT, { count: 'exact' })
    .order('starts_at', { ascending: false });
  if (q.status) query = query.eq('status', q.status);
  if (q.from) query = query.gte('starts_at', q.from);
  if (q.to) query = query.lt('starts_at', q.to);
  const { data, error, count } = await query.range(q.offset, q.offset + q.limit - 1);
  check({ data, error });
  res.json({ total: count ?? 0, items: data });
});

/** POST /api/admin/appointments/:id/cancel */
adminRouter.post('/appointments/:id/cancel', async (req, res) => {
  const { db } = authOf(req);
  const { id } = parse(idParams, req.params);
  const body = parse(z.object({ note: trimmed(3, 500, 'Reason') }), req.body);
  check(await db.rpc('update_appointment_status', { p_appointment_id: id, p_status: 'cancelled', p_note: body.note }));
  res.json({ status: 'cancelled' });
});

// ---------------------------------------------------------------- specialties
const specialtyBody = z.object({
  name: trimmed(2, 80, 'Name'),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens')
    .max(80)
    .optional(),
  description: optionalText(500).nullable(),
  is_active: z.boolean().optional(),
});

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

/** GET /api/admin/specialties: all specialties with usage counts. */
adminRouter.get('/specialties', async (req, res) => {
  const { db } = authOf(req);
  const rows = check(
    await db.from('specialties').select('id, name, slug, description, is_active, created_at, doctor_specialties(count)').order('name'),
  );
  res.json(
    rows.map(({ doctor_specialties, ...s }) => ({
      ...s,
      doctor_count: (doctor_specialties as unknown as Array<{ count: number }>)[0]?.count ?? 0,
    })),
  );
});

/** POST /api/admin/specialties */
adminRouter.post('/specialties', async (req, res) => {
  const { db } = authOf(req);
  const body = parse(specialtyBody, req.body);
  const { data, error } = await db
    .from('specialties')
    .insert({ ...body, slug: body.slug ?? slugify(body.name) })
    .select()
    .single();
  if (error?.code === '23505') throw conflict('A specialty with that name already exists');
  res.status(201).json(check({ data, error }));
});

/** PATCH /api/admin/specialties/:id */
adminRouter.patch('/specialties/:id', async (req, res) => {
  const { db } = authOf(req);
  const { id } = parse(idParams, req.params);
  const body = parse(specialtyBody.partial(), req.body);
  const { data, error } = await db.from('specialties').update(body).eq('id', id).select();
  if (error?.code === '23505') throw conflict('A specialty with that name already exists');
  const rows = check({ data, error });
  if (!rows?.length) throw notFound('Specialty not found');
  res.json(rows[0]);
});

/** DELETE /api/admin/specialties/:id: only when no doctor uses it (otherwise deactivate). */
adminRouter.delete('/specialties/:id', async (req, res) => {
  const { db } = authOf(req);
  const { id } = parse(idParams, req.params);
  const { data, error } = await db.from('specialties').delete().eq('id', id).select('id');
  if (error?.code === '23503') throw conflict('Doctors still use this specialty. Deactivate it instead.');
  const rows = check({ data, error });
  if (!rows?.length) throw notFound('Specialty not found');
  res.status(204).end();
});

// ---------------------------------------------------------------- reviews & reports
const REVIEW_ADMIN_SELECT = `id, rating, comment, status, moderation_note, moderated_at, created_at, doctor_id, patient_id,
  patient:profiles!reviews_patient_id_fkey(full_name),
  doctor:doctor_profiles!reviews_doctor_id_fkey(title, profile:profiles!doctor_profiles_id_fkey(full_name)),
  reports:review_reports(id, status)`;

/** GET /api/admin/reviews?status=published|hidden */
adminRouter.get('/reviews', async (req, res) => {
  const { db } = authOf(req);
  const q = parse(page.extend({ status: z.enum(['published', 'hidden']).optional() }), req.query);
  let query = db.from('reviews').select(REVIEW_ADMIN_SELECT, { count: 'exact' }).order('created_at', { ascending: false });
  if (q.status) query = query.eq('status', q.status);
  const { data, error, count } = await query.range(q.offset, q.offset + q.limit - 1);
  check({ data, error });
  res.json({ total: count ?? 0, items: data });
});

/** GET /api/admin/reports?status=open */
adminRouter.get('/reports', async (req, res) => {
  const { db } = authOf(req);
  const q = parse(page.extend({ status: z.enum(['open', 'resolved', 'dismissed']).optional() }), req.query);
  let query = db
    .from('review_reports')
    .select(
      `id, reason, status, resolution_note, resolved_at, created_at,
       reporter:profiles!review_reports_reporter_id_fkey(full_name, role),
       review:reviews!review_reports_review_id_fkey(${REVIEW_ADMIN_SELECT.replace(/,\s*reports:review_reports\(id, status\)/, '')})`,
      { count: 'exact' },
    )
    .order('created_at', { ascending: false });
  if (q.status) query = query.eq('status', q.status);
  const { data, error, count } = await query.range(q.offset, q.offset + q.limit - 1);
  check({ data, error });
  res.json({ total: count ?? 0, items: data });
});

/** POST /api/admin/reviews/:id/moderate { status: published|hidden, note? } */
adminRouter.post('/reviews/:id/moderate', async (req, res) => {
  const { db } = authOf(req);
  const { id } = parse(idParams, req.params);
  const body = parse(z.object({ status: z.enum(['published', 'hidden']), note: optionalText(500) }), req.body);
  check(await db.rpc('admin_moderate_review', { p_review_id: id, p_status: body.status, p_note: body.note ?? null }));
  res.json({ status: body.status });
});

/** POST /api/admin/reports/:id/resolve { status: resolved|dismissed, note?, hide_review? } */
adminRouter.post('/reports/:id/resolve', async (req, res) => {
  const { db } = authOf(req);
  const { id } = parse(idParams, req.params);
  const body = parse(
    z.object({ status: z.enum(['resolved', 'dismissed']), note: optionalText(500), hide_review: z.boolean().default(false) }),
    req.body,
  );
  check(
    await db.rpc('admin_resolve_report', {
      p_report_id: id,
      p_status: body.status,
      p_note: body.note ?? null,
      p_hide_review: body.hide_review,
    }),
  );
  res.json({ status: body.status });
});

// ---------------------------------------------------------------- activity & settings
/** GET /api/admin/audit-logs?action=&entity_type= */
adminRouter.get('/audit-logs', async (req, res) => {
  const { db } = authOf(req);
  const q = parse(
    page.extend({ action: z.string().trim().max(100).optional(), entity_type: z.string().trim().max(60).optional() }),
    req.query,
  );
  let query = db
    .from('audit_logs')
    .select('id, action, entity_type, entity_id, details, created_at, actor:profiles!audit_logs_actor_id_fkey(full_name, role)', {
      count: 'exact',
    })
    .order('created_at', { ascending: false });
  if (q.action) query = query.ilike('action', `%${q.action.replace(/[%_]/g, '')}%`);
  if (q.entity_type) query = query.eq('entity_type', q.entity_type);
  const { data, error, count } = await query.range(q.offset, q.offset + q.limit - 1);
  check({ data, error });
  res.json({ total: count ?? 0, items: data });
});

/** GET /api/admin/settings */
adminRouter.get('/settings', async (req, res) => {
  const { db } = authOf(req);
  res.json(check(await db.from('system_settings').select('key, value, description, updated_at').order('key')));
});

/** PUT /api/admin/settings/:key { value } (validated per key in the database) */
adminRouter.put('/settings/:key', async (req, res) => {
  const { db } = authOf(req);
  const { key } = parse(z.object({ key: z.string().regex(/^[a-z_]{2,60}$/) }), req.params);
  const body = parse(z.object({ value: z.union([z.string().max(200), z.number(), z.boolean()]) }), req.body);
  check(await db.rpc('admin_update_setting', { p_key: key, p_value: body.value }));
  res.json({ key, value: body.value });
});

/** GET /api/admin/contact-messages?status=new */
adminRouter.get('/contact-messages', async (req, res) => {
  const { db } = authOf(req);
  const q = parse(page.extend({ status: z.enum(['new', 'handled']).optional() }), req.query);
  let query = db.from('contact_messages').select('*', { count: 'exact' }).order('created_at', { ascending: false });
  if (q.status) query = query.eq('status', q.status);
  const { data, error, count } = await query.range(q.offset, q.offset + q.limit - 1);
  check({ data, error });
  res.json({ total: count ?? 0, items: data });
});

/** PATCH /api/admin/contact-messages/:id { status } */
adminRouter.patch('/contact-messages/:id', async (req, res) => {
  const { db } = authOf(req);
  const { id } = parse(idParams, req.params);
  const body = parse(z.object({ status: z.enum(['new', 'handled']) }), req.body);
  const rows = check(await db.from('contact_messages').update({ status: body.status }).eq('id', id).select('id, status'));
  if (!rows.length) throw notFound('Message not found');
  res.json(rows[0]);
});

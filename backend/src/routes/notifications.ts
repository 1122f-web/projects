import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireAuth } from '../middleware/auth.js';
import { check } from '../lib/errors.js';
import { idParams, parse } from '../lib/validate.js';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth());

const listSchema = z.object({
  unread_only: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/** GET /api/notifications */
notificationsRouter.get('/', async (req, res) => {
  const { db, userId } = authOf(req);
  const q = parse(listSchema, req.query);
  let query = db
    .from('notifications')
    .select('id, type, title, body, link, data, read_at, created_at, updated_at', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (q.unread_only) query = query.is('read_at', null);
  const { data, error, count } = await query.range(q.offset, q.offset + q.limit - 1);
  check({ data, error });
  const unread = await db.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('read_at', null);
  res.json({ total: count ?? 0, unread: unread.count ?? 0, items: data });
});

/** GET /api/notifications/unread-count */
notificationsRouter.get('/unread-count', async (req, res) => {
  const { db, userId } = authOf(req);
  const { count, error } = await db
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null);
  check({ data: null, error });
  res.json({ unread: count ?? 0 });
});

const readSchema = z.object({ ids: z.array(z.uuid()).max(100).optional() });

/** POST /api/notifications/read: { ids?: string[] } (omit ids to mark all as read). */
notificationsRouter.post('/read', async (req, res) => {
  const { db } = authOf(req);
  const body = parse(readSchema, req.body ?? {});
  const updated = check(await db.rpc('mark_notifications_read', { p_ids: body.ids ?? null }));
  res.json({ updated });
});

/** DELETE /api/notifications/:id */
notificationsRouter.delete('/:id', async (req, res) => {
  const { db } = authOf(req);
  const { id } = parse(idParams, req.params);
  check(await db.rpc('delete_notification', { p_id: id }));
  res.status(204).end();
});

import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireAuth } from '../middleware/auth.js';
import { HttpError, badRequest, check, checkMaybe, notFound } from '../lib/errors.js';
import { parse, uuid } from '../lib/validate.js';
import { messageLimiter } from '../middleware/rateLimit.js';
import { ATTACHMENT_TYPES, MB, objectPath, uploader, validateFile } from '../services/files.js';

export const conversationsRouter = Router();
conversationsRouter.use(requireAuth());

const MESSAGE_COLUMNS =
  'id, conversation_id, sender_id, body, attachment_path, attachment_name, attachment_mime, attachment_size, created_at';

/** GET /api/conversations: conversation list with last message and unread count. */
conversationsRouter.get('/', async (req, res) => {
  const { db } = authOf(req);
  const rows = check(await db.rpc('get_my_conversations'));
  res.json(rows);
});

const convParams = z.object({ id: uuid });

async function loadConversation(req: Parameters<typeof authOf>[0], id: string) {
  const { db } = authOf(req);
  const conversations = check(await db.rpc('get_my_conversations'));
  const conversation = (conversations as Array<{ conversation_id: string }>).find((c) => c.conversation_id === id);
  if (!conversation) throw notFound('Conversation not found');
  return conversation;
}

/** GET /api/conversations/:id */
conversationsRouter.get('/:id', async (req, res) => {
  const { id } = parse(convParams, req.params);
  res.json(await loadConversation(req, id));
});

const historySchema = z.object({
  before: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/** GET /api/conversations/:id/messages?before=ISO&limit=30: newest page first, returned oldest to newest. */
conversationsRouter.get('/:id/messages', async (req, res) => {
  const { db } = authOf(req);
  const { id } = parse(convParams, req.params);
  const q = parse(historySchema, req.query);
  await loadConversation(req, id);

  let query = db.from('messages').select(MESSAGE_COLUMNS).eq('conversation_id', id).order('created_at', { ascending: false });
  if (q.before) query = query.lt('created_at', q.before);
  const rows = check(await query.limit(q.limit + 1));
  const hasMore = rows.length > q.limit;
  res.json({ items: rows.slice(0, q.limit).reverse(), has_more: hasMore });
});

const sendSchema = z.object({
  body: z
    .string()
    .trim()
    .max(4000, 'Messages can be at most 4000 characters')
    .optional()
    .transform((v) => (v ? v : undefined)),
});

const attachmentUpload = uploader(10 * MB);

/**
 * POST /api/conversations/:id/messages: JSON { body } or multipart with
 * "body" and an optional "attachment" (PDF, JPEG, PNG, WebP up to 10 MB).
 */
conversationsRouter.post('/:id/messages', messageLimiter, attachmentUpload.single('attachment'), async (req, res) => {
  const { db, userId } = authOf(req);
  const { id } = parse(convParams, req.params);
  const body = parse(sendSchema, req.body ?? {});
  if (!body.body && !req.file) throw badRequest('Type a message or attach a file');

  let attachment: { path: string; name: string; mime: string; size: number } | null = null;
  if (req.file) {
    const file = validateFile(req.file, ATTACHMENT_TYPES, 10 * MB);
    const path = objectPath(id, file);
    const { error } = await db.storage.from('chat-attachments').upload(path, file.buffer, { contentType: file.mime });
    if (error) {
      // Storage RLS rejects uploads into conversations the user is not part of.
      throw new HttpError(404, 'Conversation not found', 'not_found');
    }
    attachment = { path, name: file.originalName, mime: file.mime, size: file.size };
  }

  const { data, error } = await db
    .from('messages')
    .insert({
      conversation_id: id,
      sender_id: userId,
      body: body.body ?? null,
      attachment_path: attachment?.path ?? null,
      attachment_name: attachment?.name ?? null,
      attachment_mime: attachment?.mime ?? null,
      attachment_size: attachment?.size ?? null,
    })
    .select(MESSAGE_COLUMNS)
    .single();
  if (error) {
    if (attachment) await db.storage.from('chat-attachments').remove([attachment.path]);
    if (error.code === '42501') throw notFound('Conversation not found');
    check({ data, error });
  }
  res.status(201).json(data);
});

/** POST /api/conversations/:id/read: mark everything up to now as read (drives read receipts). */
conversationsRouter.post('/:id/read', async (req, res) => {
  const { db } = authOf(req);
  const { id } = parse(convParams, req.params);
  const readAt = check(await db.rpc('mark_conversation_read', { p_conversation_id: id }));
  res.json({ last_read_at: readAt });
});

const attachmentParams = z.object({ id: uuid, messageId: uuid });

/** GET /api/conversations/:id/messages/:messageId/attachment: short-lived signed download URL. */
conversationsRouter.get('/:id/messages/:messageId/attachment', async (req, res) => {
  const { db } = authOf(req);
  const { id, messageId } = parse(attachmentParams, req.params);
  const message = checkMaybe(
    await db
      .from('messages')
      .select('attachment_path, attachment_name')
      .eq('id', messageId)
      .eq('conversation_id', id)
      .maybeSingle(),
  );
  if (!message?.attachment_path) throw notFound('Attachment not found');
  const { data, error } = await db.storage
    .from('chat-attachments')
    .createSignedUrl(message.attachment_path, 300, { download: message.attachment_name ?? true });
  if (error || !data) throw notFound('Attachment not found');
  res.json({ url: data.signedUrl, expires_in: 300 });
});
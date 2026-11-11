import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, CheckCheck, FileText, Loader2, MessageSquare, Paperclip, Send, Wifi, WifiOff, X } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import type { Conversation, Message } from '../../lib/types';
import { useAuth } from '../../context/AuthContext';
import { useRealtime, type ConnectionState } from '../../hooks/useRealtime';
import { Avatar } from '../../components/ui/Misc';
import { EmptyState, ErrorState, Spinner } from '../../components/ui/Feedback';
import { useToast } from '../../components/ui/Toast';
import { dateKey, formatBytes, formatDate, formatTime, timeAgo } from '../../lib/format';

const MAX_FILE = 10 * 1024 * 1024;
const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export function MessagesPage({ viewer }: { viewer: 'patient' | 'doctor' }) {
  const { conversationId } = useParams();
  const conversations = useQuery({ queryKey: ['conversations'], queryFn: () => api.get<Conversation[]>('/conversations') });
  const active = conversations.data?.find((c) => c.conversation_id === conversationId) ?? null;

  return (
    <div>
      <h1 className="sr-only">Messages</h1>
      <div className="flex h-[calc(100vh-8.5rem)] min-h-[420px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <aside className={`${conversationId ? 'hidden md:flex' : 'flex'} w-full flex-col border-r border-slate-200 md:w-80`} aria-label="Conversations">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="font-semibold">Messages</h2>
            <p className="text-xs text-slate-500">Conversations start when an appointment is booked.</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversations.isLoading ? (
              <Spinner label="Loading conversations" />
            ) : conversations.isError ? (
              <div className="p-3">
                <ErrorState error={conversations.error} onRetry={() => conversations.refetch()} />
              </div>
            ) : conversations.data!.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={MessageSquare}
                  title="No conversations yet"
                  description={viewer === 'patient' ? 'Book an appointment to start chatting with a doctor.' : 'Conversations appear when patients book with you.'}
                />
              </div>
            ) : (
              <ul>
                {conversations.data!.map((c) => (
                  <li key={c.conversation_id}>
                    <Link
                      to={`/${viewer}/messages/${c.conversation_id}`}
                      aria-current={c.conversation_id === conversationId ? 'page' : undefined}
                      className={`flex gap-3 border-b border-slate-50 px-4 py-3 hover:bg-slate-50 ${c.conversation_id === conversationId ? 'bg-brand-50' : ''}`}
                    >
                      <Avatar name={c.other_name} url={c.other_avatar_url} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className={`truncate text-sm ${c.unread_count ? 'font-semibold text-slate-900' : 'font-medium text-slate-800'}`}>{c.other_name}</p>
                          {c.last_message_at && <span className="shrink-0 text-xs text-slate-400">{timeAgo(c.last_message_at)}</span>}
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-xs text-slate-500">
                            {c.last_message_at
                              ? `${c.last_message_sender_id === c.other_user_id ? '' : 'You: '}${c.last_message_body ?? (c.last_message_has_attachment ? 'Sent an attachment' : '')}`
                              : 'No messages yet'}
                          </p>
                          {c.unread_count > 0 && (
                            <span className="shrink-0 rounded-full bg-teal-600 px-1.5 py-0.5 text-[10px] font-bold text-white" aria-label={`${c.unread_count} unread`}>
                              {c.unread_count}
                            </span>
                          )}
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
        <section className={`${conversationId ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col`} aria-label="Conversation">
          {conversationId ? (
            active ? (
              <Thread key={active.conversation_id} conversation={active} viewer={viewer} />
            ) : conversations.isLoading ? (
              <Spinner />
            ) : (
              <div className="p-6">
                <EmptyState icon={MessageSquare} title="Conversation not found" description="It may not exist or you may not have access." />
              </div>
            )
          ) : (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState icon={MessageSquare} title="Select a conversation" description="Choose a conversation from the list to read and send messages." />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

interface PendingMessage {
  tempId: string;
  body: string | null;
  file: File | null;
  failed?: boolean;
}

function ConnectionPill({ state }: { state: ConnectionState }) {
  const map = {
    live: { text: 'Live', cls: 'text-teal-700 bg-teal-50', Icon: Wifi },
    connecting: { text: 'Connecting', cls: 'text-slate-600 bg-slate-100', Icon: Loader2 },
    reconnecting: { text: 'Reconnecting', cls: 'text-amber-700 bg-amber-50', Icon: Loader2 },
    offline: { text: 'Offline', cls: 'text-red-700 bg-red-50', Icon: WifiOff },
  }[state];
  return (
    <span role="status" className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${map.cls}`}>
      <map.Icon className={`h-3 w-3 ${state === 'connecting' || state === 'reconnecting' ? 'animate-spin' : ''}`} aria-hidden="true" />
      {map.text}
    </span>
  );
}

function Thread({ conversation, viewer }: { conversation: Conversation; viewer: 'patient' | 'doctor' }) {
  const { me } = useAuth();
  const tz = me?.timezone ?? 'UTC';
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const id = conversation.conversation_id;

  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [otherReadAt, setOtherReadAt] = useState<string | null>(conversation.other_last_read_at);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const markRead = useCallback(async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      await api.post(`/conversations/${id}/read`);
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    } catch {
      /* read receipts are best effort */
    }
  }, [id, queryClient]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const page = await api.get<{ items: Message[]; has_more: boolean }>(`/conversations/${id}/messages?limit=30`);
      setMessages(page.items);
      setHasMore(page.has_more);
      void markRead();
    } catch (err) {
      setLoadError(err);
    } finally {
      setLoading(false);
    }
  }, [id, markRead]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && void markRead();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [markRead]);

  const connection = useRealtime(
    `conversation:${id}`,
    [
      { table: 'messages', event: 'INSERT', filter: `conversation_id=eq.${id}` },
      { table: 'conversation_participants', event: 'UPDATE', filter: `conversation_id=eq.${id}` },
    ],
    (payload) => {
      if (payload.table === 'messages') {
        const m = payload.new as unknown as Message;
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        if (m.sender_id !== me?.id) void markRead();
      } else {
        const row = payload.new as { user_id: string; last_read_at: string };
        if (row.user_id !== me?.id) setOtherReadAt(row.last_read_at);
      }
    },
  );

  // Catch up on anything missed while the connection was down.
  const prevConnection = useRef(connection);
  useEffect(() => {
    if (prevConnection.current !== 'live' && connection === 'live' && !loading) {
      api
        .get<{ items: Message[] }>(`/conversations/${id}/messages?limit=50`)
        .then((page) =>
          setMessages((prev) => {
            const known = new Set(prev.map((m) => m.id));
            return [...prev, ...page.items.filter((m) => !known.has(m.id))].sort((a, b) => a.created_at.localeCompare(b.created_at));
          }),
        )
        .catch(() => undefined);
    }
    prevConnection.current = connection;
  }, [connection, id, loading]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  const loadEarlier = async () => {
    if (!messages[0]) return;
    setLoadingMore(true);
    const el = scroller.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const page = await api.get<{ items: Message[]; has_more: boolean }>(
        `/conversations/${id}/messages?limit=30&before=${encodeURIComponent(messages[0].created_at)}`,
      );
      stickToBottom.current = false;
      setMessages((prev) => [...page.items, ...prev]);
      setHasMore(page.has_more);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight;
      });
    } catch (err) {
      toast.error('Could not load earlier messages', errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  };

  const sendPending = async (p: PendingMessage) => {
    try {
      let msg: Message;
      if (p.file) {
        const form = new FormData();
        if (p.body) form.append('body', p.body);
        form.append('attachment', p.file);
        msg = await api.post<Message>(`/conversations/${id}/messages`, form);
      } else {
        msg = await api.post<Message>(`/conversations/${id}/messages`, { body: p.body });
      }
      setPending((list) => list.filter((x) => x.tempId !== p.tempId));
      setMessages((prev) => (prev.some((x) => x.id === msg.id) ? prev : [...prev, msg]));
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    } catch (err) {
      setPending((list) => list.map((x) => (x.tempId === p.tempId ? { ...x, failed: true } : x)));
      toast.error('Message not sent', errorMessage(err));
    }
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body && !file) return;
    if (body.length > 4000) {
      toast.error('Message too long', 'Messages can be at most 4000 characters.');
      return;
    }
    const p: PendingMessage = { tempId: crypto.randomUUID(), body: body || null, file };
    stickToBottom.current = true;
    setPending((list) => [...list, p]);
    setText('');
    setFile(null);
    if (fileInput.current) fileInput.current.value = '';
    void sendPending(p);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    if (!FILE_TYPES.includes(f.type)) {
      toast.error('Unsupported file', 'Attach a JPEG, PNG, WebP image or a PDF.');
      return;
    }
    if (f.size > MAX_FILE) {
      toast.error('File too large', 'Attachments must be 10 MB or smaller.');
      return;
    }
    setFile(f);
  };

  const groups = useMemo(() => {
    const out: { day: string; items: Message[] }[] = [];
    for (const m of messages) {
      const day = dateKey(m.created_at, tz);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(m);
      else out.push({ day, items: [m] });
    }
    return out;
  }, [messages, tz]);

  return (
    <>
      <header className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
        <button type="button" onClick={() => navigate(`/${viewer}/messages`)} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 md:hidden" aria-label="Back to conversations">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Avatar name={conversation.other_name} url={conversation.other_avatar_url} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{conversation.other_name}</p>
          <p className="text-xs capitalize text-slate-500">{conversation.other_role}</p>
        </div>
        <ConnectionPill state={connection} />
      </header>

      <div
        ref={scroller}
        className="flex-1 overflow-y-auto bg-slate-50 px-4 py-4"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        aria-live="polite"
        aria-label="Message history"
      >
        {loading ? (
          <Spinner label="Loading messages" />
        ) : loadError ? (
          <ErrorState error={loadError} onRetry={() => void load()} />
        ) : (
          <>
            {hasMore && (
              <div className="mb-3 text-center">
                <button type="button" onClick={loadEarlier} disabled={loadingMore} className="text-sm font-medium text-brand-700 hover:underline disabled:opacity-50">
                  {loadingMore ? 'Loading…' : 'Load earlier messages'}
                </button>
              </div>
            )}
            {messages.length === 0 && pending.length === 0 && (
              <p className="py-10 text-center text-sm text-slate-500">No messages yet. Say hello to {conversation.other_name}.</p>
            )}
            {groups.map((g) => (
              <div key={g.day}>
                <div className="my-3 flex items-center gap-3 text-xs text-slate-400">
                  <span className="h-px flex-1 bg-slate-200" />
                  {formatDate(g.items[0]!.created_at, tz)}
                  <span className="h-px flex-1 bg-slate-200" />
                </div>
                <ul className="space-y-2">
                  {g.items.map((m) => {
                    const mine = m.sender_id === me?.id;
                    const read = mine && otherReadAt !== null && new Date(otherReadAt).getTime() >= new Date(m.created_at).getTime();
                    return (
                      <li key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${mine ? 'rounded-br-sm bg-brand-600 text-white' : 'rounded-bl-sm bg-white text-slate-800'}`}>
                          {m.attachment_path && <Attachment message={m} mine={mine} />}
                          {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                          <p className={`mt-1 flex items-center justify-end gap-1 text-[11px] ${mine ? 'text-brand-100' : 'text-slate-400'}`}>
                            <time dateTime={m.created_at}>{formatTime(m.created_at, tz)}</time>
                            {mine &&
                              (read ? (
                                <CheckCheck className="h-3.5 w-3.5 text-teal-200" aria-label="Read" />
                              ) : (
                                <Check className="h-3.5 w-3.5" aria-label="Sent" />
                              ))}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {pending.length > 0 && (
              <ul className="mt-2 space-y-2">
                {pending.map((p) => (
                  <li key={p.tempId} className="flex justify-end">
                    <div className={`max-w-[80%] rounded-2xl rounded-br-sm px-3.5 py-2 text-sm ${p.failed ? 'bg-red-50 text-red-800 ring-1 ring-red-200' : 'bg-brand-400 text-white'}`}>
                      {p.file && <p className="flex items-center gap-1 text-xs"><FileText className="h-3.5 w-3.5" aria-hidden="true" /> {p.file.name}</p>}
                      {p.body && <p className="whitespace-pre-wrap break-words">{p.body}</p>}
                      <p className="mt-1 text-right text-[11px]">
                        {p.failed ? (
                          <span className="flex items-center justify-end gap-2">
                            Failed to send
                            <button type="button" className="font-semibold underline" onClick={() => { setPending((l) => l.map((x) => (x.tempId === p.tempId ? { ...x, failed: false } : x))); void sendPending({ ...p, failed: false }); }}>
                              Retry
                            </button>
                            <button type="button" className="underline" onClick={() => setPending((l) => l.filter((x) => x.tempId !== p.tempId))}>
                              Discard
                            </button>
                          </span>
                        ) : (
                          'Sending…'
                        )}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <form onSubmit={submit} className="border-t border-slate-200 bg-white p-3">
        {file && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <FileText className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
              <span className="truncate">{file.name}</span>
              <span className="shrink-0 text-xs text-slate-500">{formatBytes(file.size)}</span>
            </span>
            <button type="button" onClick={() => { setFile(null); if (fileInput.current) fileInput.current.value = ''; }} aria-label="Remove attachment" className="text-slate-500 hover:text-slate-700">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input ref={fileInput} type="file" accept={FILE_TYPES.join(',')} className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} aria-label="Attach file" />
          <button type="button" onClick={() => fileInput.current?.click()} className="rounded-lg p-2.5 text-slate-500 hover:bg-slate-100" aria-label="Attach a file (PDF or image, up to 10 MB)">
            <Paperclip className="h-5 w-5" />
          </button>
          <label htmlFor="message-input" className="sr-only">
            Message
          </label>
          <textarea
            id="message-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={4000}
            placeholder="Write a message…"
            className="max-h-32 min-h-[42px] flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
          <button type="submit" disabled={!text.trim() && !file} className="rounded-lg bg-brand-600 p-2.5 text-white hover:bg-brand-700 disabled:opacity-50" aria-label="Send message">
            <Send className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-1 text-[11px] text-slate-400">Enter to send, Shift + Enter for a new line. Not for emergencies.</p>
      </form>
    </>
  );
}

function Attachment({ message, mine }: { message: Message; mine: boolean }) {
  const isImage = message.attachment_mime?.startsWith('image/');
  const toast = useToast();
  const url = useQuery({
    queryKey: ['attachment', message.id],
    queryFn: () => api.get<{ url: string }>(`/conversations/${message.conversation_id}/messages/${message.id}/attachment`),
    enabled: Boolean(isImage),
    staleTime: 4 * 60_000,
  });

  const open = async () => {
    try {
      const res = await api.get<{ url: string }>(`/conversations/${message.conversation_id}/messages/${message.id}/attachment`);
      window.open(res.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error('Could not open the file', errorMessage(err));
    }
  };

  if (isImage && url.data) {
    return (
      <button type="button" onClick={open} className="mb-1 block" aria-label={`Open image ${message.attachment_name}`}>
        <img src={url.data.url} alt={message.attachment_name ?? 'Attachment'} className="max-h-60 rounded-lg object-cover" loading="lazy" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={open}
      className={`mb-1 flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${mine ? 'bg-brand-700/60 hover:bg-brand-700' : 'bg-slate-100 hover:bg-slate-200'}`}
    >
      <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block truncate font-medium">{message.attachment_name}</span>
        {message.attachment_size && <span className="opacity-75">{formatBytes(message.attachment_size)}</span>}
      </span>
    </button>
  );
}

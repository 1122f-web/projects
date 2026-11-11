import { useEffect, useRef, useState } from 'react';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline';

interface Subscription {
  table: string;
  event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*';
  filter?: string;
}

/**
 * Subscribes to Postgres changes over Supabase Realtime. Row Level Security is
 * applied by Supabase, so a client only ever receives rows it may read.
 */
export function useRealtime(
  channelName: string | null,
  subscriptions: Subscription[],
  onChange: (payload: RealtimePostgresChangesPayload<Record<string, unknown>> & { table: string }) => void,
  /** Called each time the channel (re)connects, to refetch anything that changed while it was not listening. */
  onLive?: () => void,
): ConnectionState {
  const [state, setState] = useState<ConnectionState>('connecting');
  const handler = useRef(onChange);
  handler.current = onChange;
  const liveHandler = useRef(onLive);
  liveHandler.current = onLive;
  const key = JSON.stringify(subscriptions);

  useEffect(() => {
    if (!channelName) return;
    setState('connecting');
    const subs = JSON.parse(key) as Subscription[];
    let channel = supabase.channel(`${channelName}:${Math.random().toString(36).slice(2, 8)}`);
    for (const s of subs) {
      channel = channel.on(
        'postgres_changes' as never,
        { event: s.event ?? '*', schema: 'public', table: s.table, ...(s.filter ? { filter: s.filter } : {}) },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => handler.current({ ...payload, table: s.table }),
      );
    }
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setState('live');
        liveHandler.current?.();
      }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setState('reconnecting');
      else if (status === 'CLOSED') setState('offline');
    });

    const onOffline = () => setState('offline');
    const onOnline = () => setState('reconnecting');
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      void supabase.removeChannel(channel);
    };
  }, [channelName, key]);

  return state;
}

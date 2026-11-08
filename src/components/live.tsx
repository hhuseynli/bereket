'use client';
// Client side of the shared state: one fetch, then refetch whenever the server's version changes (SSE).
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Readiness } from '@/lib/presenter';
import type { State } from '@/lib/types';

export type LiveState = State & { keys: { claude: boolean; elevenlabs: boolean; twilio: boolean }; presenter: Readiness };

interface Ctx {
  s: LiveState | null;
  act: (action: string, payload?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  connected: boolean;
  phoneFarmer: string;
  setPhoneFarmer: (id: string) => void;
}

const LiveCtx = createContext<Ctx>({ s: null, act: async () => ({}), connected: false, phoneFarmer: 'f-elsen', setPhoneFarmer: () => {} });

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const [s, setS] = useState<LiveState | null>(null);
  const [connected, setConnected] = useState(false);
  const [phoneFarmer, setPhoneFarmer] = useState('f-elsen');
  const lastSeen = useRef<string | undefined>(undefined);
  // The phone follows whichever conversation just changed, so the presenter never switches by hand.
  const newest = s?.messages[s.messages.length - 1];
  useEffect(() => {
    if (!s) return;
    if (!newest) { lastSeen.current = ''; return; }
    if (newest.id !== lastSeen.current) {
      if (lastSeen.current !== undefined) setPhoneFarmer(newest.farmerId);
      lastSeen.current = newest.id;
    }
  }, [s, newest]);
  const fetching = useRef(false);
  const again = useRef(false);

  const refresh = useCallback(async () => {
    if (fetching.current) { again.current = true; return; }
    fetching.current = true;
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      if (res.ok) setS(await res.json());
    } catch {
      /* server restarting: the SSE reconnect triggers another refresh */
    } finally {
      fetching.current = false;
      if (again.current) { again.current = false; void refresh(); }
    }
  }, []);

  // After a rebuild, an open page may ask for script files that no longer exist: reload once to get the new ones.
  useEffect(() => {
    const stale = (msg: string) => /ChunkLoadError|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module/i.test(msg);
    const heal = (msg: string) => {
      if (!stale(msg)) return;
      try {
        const last = Number(sessionStorage.getItem('berekat.reloaded') ?? 0);
        if (Date.now() - last < 30_000) return; // never loop
        sessionStorage.setItem('berekat.reloaded', String(Date.now()));
      } catch { /* storage blocked: still reload once */ }
      window.location.reload();
    };
    const onError = (e: ErrorEvent) => heal(`${e.message} ${e.error?.name ?? ''}`);
    const onRejection = (e: PromiseRejectionEvent) => heal(`${(e.reason as Error)?.name ?? ''} ${(e.reason as Error)?.message ?? e.reason}`);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); };
  }, []);

  useEffect(() => {
    void refresh();
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      es = new EventSource('/api/events');
      es.onopen = () => setConnected(true);
      es.onmessage = () => void refresh();
      es.onerror = () => {
        setConnected(false);
        es?.close();
        retry = setTimeout(open, 1500);
      };
    };
    open();
    return () => { es?.close(); if (retry) clearTimeout(retry); };
  }, [refresh]);

  const act = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    const res = await fetch('/api/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...payload }) });
    return res.json();
  }, []);

  return <LiveCtx.Provider value={{ s, act, connected, phoneFarmer, setPhoneFarmer }}>{children}</LiveCtx.Provider>;
}

export const useLive = () => useContext(LiveCtx);

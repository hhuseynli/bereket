'use client';
// Client side of the shared state: one fetch, then refetch whenever the server's version changes (SSE).
import { usePathname } from 'next/navigation';
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
    // Wait until the server answers (it may be mid-restart), then reload; at most 3 times a minute, never in a loop.
    const heal = async (msg: string) => {
      if (!stale(msg)) return;
      let tries: number[] = [];
      try { tries = (JSON.parse(sessionStorage.getItem('berekat.reloads') ?? '[]') as number[]).filter((t) => Date.now() - t < 60_000); } catch { /* */ }
      if (tries.length >= 3) return;
      for (let i = 0; i < 30; i++) {
        try { if ((await fetch('/icon.svg', { method: 'HEAD', cache: 'no-store' })).status < 500) break; } catch { /* server down */ }
        await new Promise((r) => setTimeout(r, 1000));
      }
      try { sessionStorage.setItem('berekat.reloads', JSON.stringify([...tries, Date.now()])); } catch { /* */ }
      window.location.reload();
    };
    const onError = (e: ErrorEvent) => void heal(`${e.message} ${e.error?.name ?? ''}`);
    const onRejection = (e: PromiseRejectionEvent) => void heal(`${(e.reason as Error)?.name ?? ''} ${(e.reason as Error)?.message ?? e.reason}`);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); };
  }, []);

  // The sign-up page has no live data (and no access to it yet).
  const path = usePathname();
  const off = !!path?.startsWith('/join');
  useEffect(() => {
    if (off) return;
    void refresh();
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    let heard = false; // the server sends the version as soon as the stream opens
    let version = -1;
    // Some proxies hold back event streams (Cloudflare quick tunnels never deliver them): if the first event does
    // not arrive within 4 s, check the version every 1.5 s instead and fetch the state only when it changed.
    const startPolling = () => {
      if (poll) return;
      es?.close();
      if (retry) clearTimeout(retry);
      poll = setInterval(async () => {
        try {
          const r = await fetch('/api/events?poll=1', { cache: 'no-store' });
          if (!r.ok) { setConnected(false); return; }
          const { version: v } = (await r.json()) as { version: number };
          setConnected(true);
          if (v !== version) { version = v; void refresh(); }
        } catch { setConnected(false); }
      }, 1500);
    };
    const silent = setTimeout(() => { if (!heard) startPolling(); }, 4000);
    const open = () => {
      es = new EventSource('/api/events');
      es.onopen = () => setConnected(true);
      es.onmessage = () => { heard = true; void refresh(); };
      es.onerror = () => {
        setConnected(false);
        es?.close();
        if (!poll) retry = setTimeout(open, 1500);
      };
    };
    open();
    return () => { es?.close(); clearTimeout(silent); if (retry) clearTimeout(retry); if (poll) clearInterval(poll); };
  }, [refresh, off]);

  const act = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    const res = await fetch('/api/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...payload }) });
    return res.json();
  }, []);

  return <LiveCtx.Provider value={{ s, act, connected, phoneFarmer, setPhoneFarmer }}>{children}</LiveCtx.Provider>;
}

export const useLive = () => useContext(LiveCtx);

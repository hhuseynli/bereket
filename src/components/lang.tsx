'use client';
// Website language (English / Azərbaycanca). Each viewer picks their own; it is remembered in this browser.
// Strings are written in place as pairs: t('Tenders', 'Tenderlər'). Text made on the server carries an Azerbaijani
// twin in an *Az field; loc() picks the right one and falls back to English.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type Lang = 'en' | 'az';

interface Ctx { lang: Lang; setLang: (l: Lang) => void; t: (en: string, az: string) => string; loc: (en?: string, az?: string) => string }

const LangCtx = createContext<Ctx>({ lang: 'en', setLang: () => {}, t: (en) => en, loc: (en) => en ?? '' });

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');
  useEffect(() => {
    try {
      const saved = localStorage.getItem('berekat.lang');
      if (saved === 'az' || saved === 'en') setLangState(saved);
    } catch { /* storage blocked: English */ }
  }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem('berekat.lang', l); } catch { /* */ }
  }, []);
  const t = useCallback((en: string, az: string) => (lang === 'az' ? az : en), [lang]);
  const loc = useCallback((en?: string, az?: string) => (lang === 'az' && az ? az : en ?? ''), [lang]);
  return <LangCtx.Provider value={{ lang, setLang, t, loc }}>{children}</LangCtx.Provider>;
}

export const useLang = () => useContext(LangCtx);


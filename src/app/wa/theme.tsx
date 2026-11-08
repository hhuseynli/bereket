// WhatsApp (iOS) colours as CSS variables, following the phone's light or dark setting. The wallpaper is our own
// farm doodles (tomatoes, leaves, crates, a tractor), drawn in the spirit of WhatsApp's, not copied from it.
export const sys = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export function WaTheme() {
  return (
    <style>{`
      :root {
        --wa-bg: #efeae2; --wa-dot: rgba(0,0,0,0.045); --wa-head: #f6f6f6; --wa-head-text: #000; --wa-sub: #8696a0;
        --wa-pill: rgba(0,0,0,0.06); --wa-out: #d9fdd3; --wa-in: #ffffff; --wa-text: #111b21; --wa-meta: #667781;
        --wa-meta-out: #5f7a5b; --wa-tick: #8696a0; --wa-read: #53bdeb; --wa-chip: #ffffff; --wa-chip-text: #54656f;
        --wa-bar: #f6f6f6; --wa-input: #ffffff; --wa-input-line: #e2e2e6; --wa-icon: #3b4a54; --wa-green: #21c063;
        --wa-link: #027eb5; --wa-wave: #b6c2c9; --wa-wave-out: #8fb48a; --wa-wave-on: #5b9b72; --wa-sheet: #ffffff;
        --wa-banner: #fff8c4; --wa-banner-text: #54656f; --wa-red: #f15c6d; --wa-shadow: 0 1px 0.5px rgba(11,20,26,0.13);
        --wa-wall: url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%22220%22%20height%3D%22220%22%20viewBox%3D%220%200%20220%20220%22%20fill%3D%22none%22%20stroke%3D%22rgba%280%2C0%2C0%2C0.075%29%22%20stroke-width%3D%221.6%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%20%3Ccircle%20cx%3D%2232%22%20cy%3D%2234%22%20r%3D%2213%22/%3E%3Cpath%20d%3D%22M26%2022l6%205%206-5M32%2027v-7%22/%3E%20%3Cpath%20d%3D%22M78%2018c10%202%2016%2010%2014%2022-12-2-17-10-14-22zM80%2022l10%2016%22/%3E%20%3Crect%20x%3D%22130%22%20y%3D%2220%22%20width%3D%2234%22%20height%3D%2222%22%20rx%3D%222%22/%3E%3Cpath%20d%3D%22M130%2031h34M141%2020v22M153%2020v22%22/%3E%20%3Crect%20x%3D%2218%22%20y%3D%2286%22%20width%3D%2230%22%20height%3D%2216%22%20rx%3D%223%22/%3E%3Ccircle%20cx%3D%2224%22%20cy%3D%22106%22%20r%3D%226%22/%3E%3Ccircle%20cx%3D%2246%22%20cy%3D%22104%22%20r%3D%224%22/%3E%3Cpath%20d%3D%22M48%2092h8v10%22/%3E%20%3Cpath%20d%3D%22M92%2092h20l6%208v12H92zM118%20100l12-6M98%2092v-6h10%22/%3E%20%3Ccircle%20cx%3D%22168%22%20cy%3D%2296%22%20r%3D%229%22/%3E%3Cpath%20d%3D%22M168%2081v-4M168%20115v-4M153%2096h-4M187%2096h-4M157%2085l-3-3M182%20110l-3-3M157%20107l-3%203M182%2082l-3%203%22/%3E%20%3Cpath%20d%3D%22M30%20150v38M30%20158c-6-2-8-6-8-10%206%201%208%205%208%2010zM30%20158c6-2%208-6%208-10-6%201-8%205-8%2010zM30%20170c-6-2-8-6-8-10%206%201%208%205%208%2010zM30%20170c6-2%208-6%208-10-6%201-8%205-8%2010z%22/%3E%20%3Cpath%20d%3D%22M88%20160c0-8%208-12%2014-8%206-4%2014%200%2014%208%200%2012-14%2020-14%2020s-14-8-14-20zM102%20152c0-4%202-7%206-8%22/%3E%20%3Ccircle%20cx%3D%22160%22%20cy%3D%22166%22%20r%3D%2211%22/%3E%3Ccircle%20cx%3D%22178%22%20cy%3D%22172%22%20r%3D%228%22/%3E%3Cpath%20d%3D%22M156%20156l4%203%204-3M175%20165l3%202%203-2%22/%3E%20%3Ccircle%20cx%3D%2266%22%20cy%3D%2262%22%20r%3D%221.6%22/%3E%3Ccircle%20cx%3D%22196%22%20cy%3D%2258%22%20r%3D%221.6%22/%3E%3Ccircle%20cx%3D%2262%22%20cy%3D%22128%22%20r%3D%221.6%22/%3E%3Ccircle%20cx%3D%22130%22%20cy%3D%22140%22%20r%3D%221.6%22/%3E%3Ccircle%20cx%3D%22198%22%20cy%3D%22140%22%20r%3D%221.6%22/%3E%3Ccircle%20cx%3D%2260%22%20cy%3D%22200%22%20r%3D%221.6%22/%3E%3Ccircle%20cx%3D%22130%22%20cy%3D%22204%22%20r%3D%221.6%22/%3E%20%3C/svg%3E");
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --wa-bg: #0b141a; --wa-dot: rgba(255,255,255,0.035); --wa-head: #0b141a; --wa-head-text: #e9edef; --wa-sub: #8696a0;
          --wa-pill: rgba(255,255,255,0.10); --wa-out: #1d5b43; --wa-in: #1f2c34; --wa-text: #e9edef; --wa-meta: #8696a0;
          --wa-meta-out: #a7c2b4; --wa-tick: #a7c2b4; --wa-read: #53bdeb; --wa-chip: #182229; --wa-chip-text: #e9edef;
          --wa-bar: #0b141a; --wa-input: #1f2c33; --wa-input-line: #1f2c33; --wa-icon: #e9edef; --wa-green: #21c063;
          --wa-link: #53bdeb; --wa-wave: #5c6b73; --wa-wave-out: #6f9d87; --wa-wave-on: #e9edef; --wa-sheet: #1f2c34;
          --wa-banner: #182229; --wa-banner-text: #ffd279; --wa-shadow: 0 1px 0.5px rgba(0,0,0,0.3);
          --wa-wall: url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%22220%22%20height%3D%22220%22%20viewBox%3D%220%200%20220%20220%22%20fill%3D%22none%22%20stroke%3D%22rgba%28255%2C255%2C255%2C0.055%29%22%20stroke-width%3D%221.6%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%20%3Ccircle%20cx%3D%2232%22%20cy%3D%2234%22%20r%3D%2213%22/%3E%3Cpath%20d%3D%22M26%2022l6%205%206-5M32%2027v-7%22/%3E%20%3Cpath%20d%3D%22M78%2018c10%202%2016%2010%2014%2022-12-2-17-10-14-22zM80%2022l10%2016%22/%3E%20%3Crect%20x%3D%22130%22%20y%3D%2220%22%20width%3D%2234%22%20height%3D%2222%22%20rx%3D%222%22/%3E%3Cpath%20d%3D%22M130%2031h34M141%2020v22M153%2020v22%22/%3E%20%3Crect%20x%3D%2218%22%20y%3D%2286%22%20width%3D%2230%22%20height%3D%2216%22%20rx%3D%223%22/%3E%3Ccircle%20cx%3D%2224%22%20cy%3D%22106%22%20r%3D%226%22/%3E%3Ccircle%20cx%3D%2246%22%20cy%3D%22104%22%20r%3D%224%22/%3E%3Cpath%20d%3D%22M48%2092h8v10%22/%3E%20%3Cpath%20d%3D%22M92%2092h20l6%208v12H92zM118%20100l12-6M98%2092v-6h10%22/%3E%20%3Ccircle%20cx%3D%22168%22%20cy%3D%2296%22%20r%3D%229%22/%3E%3Cpath%20d%3D%22M168%2081v-4M168%20115v-4M153%2096h-4M187%2096h-4M157%2085l-3-3M182%20110l-3-3M157%20107l-3%203M182%2082l-3%203%22/%3E%20%3Cpath%20d%3D%22M30%20150v38M30%20158c-6-2-8-6-8-10%206%201%208%205%208%2010zM30%20158c6-2%208-6%208-10-6%201-8%205-8%2010zM30%20170c-6-2-8-6-8-10%206%201%208%205%208%2010zM30%20170c6-2%208-6%208-10-6%201-8%205-8%2010z%22/%3E%20%3Cpath%20d%3D%22M88%20160c0-8%208-12%2014-8%206-4%2014%200%2014%208%200%2012-14%2020-14%2020s-14-8-14-20zM102%20152c0-4%202-7%206-8%22/%3E%20%3Ccircle%20cx%3D%22160%22%20cy%3D%22166%22%20r%3D%2211%22/%3E%3Ccircle%20cx%3D%22178%22%20cy%3D%22172%22%20r%3D%228%22/%3E%3Cpath%20d%3D%22M156%20156l4%203%204-3M175%20165l3%202%203-2%22/%3E%20%3Ccircle%20cx%3D%2266%22%20cy%3D%2262%22%20r%3D%221.6%22/%3E%3Ccircle%20cx%3D%22196%22%20cy%3D%2258%22%20r%3D%221.6%22/%3E%3Ccircle%20cx%3D%2262%22%20cy%3D%22128%22%20r%3D%221.6%22/%3E%3Ccircle%20cx%3D%22130%22%20cy%3D%22140%22%20r%3D%221.6%22/%3E%3Ccircle%20cx%3D%22198%22%20cy%3D%22140%22%20r%3D%221.6%22/%3E%3Ccircle%20cx%3D%2260%22%20cy%3D%22200%22%20r%3D%221.6%22/%3E%3Ccircle%20cx%3D%22130%22%20cy%3D%22204%22%20r%3D%221.6%22/%3E%20%3C/svg%3E");
        }
      }
      html, body { background: var(--wa-bg); overscroll-behavior: none; height: 100%; overflow: hidden; }
      .wa-noselect { user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
      @keyframes wa-blink { 50% { opacity: 0.2; } }
      @keyframes wa-nudge { 0%,100% { transform: translateX(0); } 50% { transform: translateX(-6px); } }
      @keyframes wa-up { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
    `}</style>
  );
}

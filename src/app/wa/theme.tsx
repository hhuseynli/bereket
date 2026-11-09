// WhatsApp (iOS) colours as CSS variables, following the phone's light or dark setting. The wallpaper is our own
// farm doodles (tomatoes, leaves, crates, a tractor), drawn in the spirit of WhatsApp's, not copied from it.
export const sys = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

// Injected as raw CSS: as a text child, React escapes the quotes in the wallpaper URL on the server but not in the
// browser, and the mismatch makes React throw away the server HTML (hydration errors #418 / #425).
export function WaTheme() {
  return <style dangerouslySetInnerHTML={{ __html: CSS }} />;
}


// ---------- Chat wallpaper ----------
// Many small line doodles on a light tile, in the style of WhatsApp's default wallpaper (our own drawings: farm
// produce and chat things, not WhatsApp's artwork). Placed on a jittered grid with a fixed seed, so it never changes.
const ICONS: string[] = [
  'M12 7a6 6 0 1 0 .01 0M9 6.5l3 2 3-2M12 8.5V5', // tomato
  'M5 19C5 10 11 5 19 5c0 8-5 14-14 14zM5 19l8-8', // leaf
  'M12 8c-3-2-7 0-7 5s3 8 5 8c1 0 1.5-.5 2-.5s1 .5 2 .5c2 0 5-3 5-8s-4-7-7-5zM12 8c0-2 1-4 3-5', // apple
  'M7 20L17 6M17 6l-1-3M17 6l3-1M8.5 17.5l2 1M10.5 14.5l2 1M12.5 11.5l2 1', // carrot
  'M4 6h16v10H9l-5 4z', // chat bubble
  'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z', // heart
  'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z', // star
  'M4 8h4l2-2h4l2 2h4v11H4zM12 10.5a3.5 3.5 0 1 0 .01 0', // camera
  'M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z', // music
  'M12 8a4 4 0 1 0 .01 0M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2', // sun
  'M7 18h10a4 4 0 0 0 0-8 5 5 0 0 0-9.5-1A4.5 4.5 0 0 0 7 18z', // cloud
  'M5 9h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4zM16 11h2a2 2 0 0 1 0 4h-2M8 3v3M11 3v3', // cup
  'M6 3h4l1.5 4.5-2.5 1.5a11 11 0 0 0 6 6l1.5-2.5L21 14v4a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2z', // phone
  'M3 6h18v12H3zM3 6l9 7 9-7', // envelope
  'M4 9h16v10H4zM4 13h16M9 9v10M15 9v10', // crate
  'M3 16a3 3 0 1 0 6 0 3 3 0 0 0-6 0M15 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0M6 13V8h6l2 5h5v4M12 8V5', // tractor
  'M5 17a3 3 0 1 0 .01 0M19 17a3 3 0 1 0 .01 0M5 17l4-8h6l4 8M9 9l3 8h-3', // bicycle
  'M12 4a8 8 0 1 0 .01 0M12 8v4l3 2', // clock
  'M12 4a8 8 0 1 0 .01 0M9 10h.01M15 10h.01M8.5 14c1 1.5 2.2 2 3.5 2s2.5-.5 3.5-2', // smiley
  'M9 4h6v9a3 3 0 0 1-6 0zM6 11a6 6 0 0 0 12 0M12 17v4', // microphone
  'M12 21c-4 0-6-3-5-7 .7-2.5 2.5-3 2.5-5.5S11 4 12 4s2.5 2 2.5 4.5S16.3 11.5 17 14c1 4-1 7-5 7zM12 4V2', // pear
  'M4 10h16l-2 10H6zM8 10l4-6 4 6', // basket
  'M12 9a3 3 0 1 0 .01 0M12 6V3M12 18v-3M9 12H6M18 12h-3M9.9 9.9 7.8 7.8M16.2 16.2l-2.1-2.1M9.9 14.1l-2.1 2.1M16.2 7.8l-2.1 2.1', // flower
  'M8 17a3 3 0 1 0 .01 0M16 15a3 3 0 1 0 .01 0M8 14c0-5 3-8 6-10M16 12c0-4-1-6-2-8', // cherries
  'M6 4h12v16l-6-4-6 4z', // bookmark
  'M3 12h4l3-7 4 14 3-7h4', // pulse
];

function rng(seed: number) { return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646; }

function wallpaper(stroke: string) {
  const T = 320, COLS = 10, ROWS = 10, cell = T / COLS;
  const r = rng(20261110);
  let body = '';
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const cx = (x + 0.5) * cell + (r() - 0.5) * cell * 0.45, cy = (y + 0.5) * cell + (r() - 0.5) * cell * 0.45;
    if (r() < 0.3) {
      // fillers between icons: a dot or a small sparkle
      body += r() < 0.5 ? `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="1.4"/>` : `<path d="M${cx.toFixed(1)} ${(cy - 3.5).toFixed(1)}v7M${(cx - 3.5).toFixed(1)} ${cy.toFixed(1)}h7"/>`;
      continue;
    }
    const icon = ICONS[Math.floor(r() * ICONS.length)];
    const k = 0.78 + r() * 0.26, rot = Math.round((r() - 0.5) * 50);
    body += `<path transform="translate(${(cx - 12 * k).toFixed(1)} ${(cy - 12 * k).toFixed(1)}) rotate(${rot} ${(12 * k).toFixed(1)} ${(12 * k).toFixed(1)}) scale(${k.toFixed(2)})" d="${icon}"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${T}" height="${T}" viewBox="0 0 ${T} ${T}" fill="none" stroke="${stroke}" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const WALL_LIGHT = wallpaper('rgba(0,0,0,0.13)');
const WALL_DARK = wallpaper('rgba(255,255,255,0.075)');

const CSS = `
      :root {
        --wa-bg: #f4f3f1; --wa-dot: rgba(0,0,0,0.045); --wa-head: #f6f6f6; --wa-head-text: #000; --wa-sub: #8696a0;
        --wa-pill: rgba(0,0,0,0.06); --wa-out: #d9fdd3; --wa-in: #ffffff; --wa-text: #111b21; --wa-meta: #667781;
        --wa-meta-out: #5f7a5b; --wa-tick: #8696a0; --wa-read: #53bdeb; --wa-chip: #ffffff; --wa-chip-text: #54656f;
        --wa-bar: #f6f6f6; --wa-input: #ffffff; --wa-input-line: #e2e2e6; --wa-icon: #3b4a54; --wa-green: #21c063;
        --wa-link: #027eb5; --wa-wave: #b6c2c9; --wa-wave-out: #8fb48a; --wa-wave-on: #5b9b72; --wa-sheet: #ffffff;
        --wa-banner: #fff8c4; --wa-banner-text: #54656f; --wa-red: #f15c6d; --wa-shadow: 0 1px 0.5px rgba(11,20,26,0.13);
        --wa-wall: ${WALL_LIGHT};
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --wa-bg: #0b141a; --wa-dot: rgba(255,255,255,0.035); --wa-head: #0b141a; --wa-head-text: #e9edef; --wa-sub: #8696a0;
          --wa-pill: rgba(255,255,255,0.10); --wa-out: #1d5b43; --wa-in: #1f2c34; --wa-text: #e9edef; --wa-meta: #8696a0;
          --wa-meta-out: #a7c2b4; --wa-tick: #a7c2b4; --wa-read: #53bdeb; --wa-chip: #182229; --wa-chip-text: #e9edef;
          --wa-bar: #0b141a; --wa-input: #1f2c33; --wa-input-line: #1f2c33; --wa-icon: #e9edef; --wa-green: #21c063;
          --wa-link: #53bdeb; --wa-wave: #5c6b73; --wa-wave-out: #6f9d87; --wa-wave-on: #e9edef; --wa-sheet: #1f2c34;
          --wa-banner: #182229; --wa-banner-text: #ffd279; --wa-shadow: 0 1px 0.5px rgba(0,0,0,0.3);
          --wa-wall: ${WALL_DARK};
        }
      }
      html, body { background: var(--wa-bg); overscroll-behavior: none; height: 100%; overflow: hidden; }
      .wa-noselect { user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
      @keyframes wa-blink { 50% { opacity: 0.2; } }
      @keyframes wa-nudge { 0%,100% { transform: translateX(0); } 50% { transform: translateX(-6px); } }
      @keyframes wa-up { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
`;

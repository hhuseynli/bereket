import fs from 'node:fs';

// Hosted (Render): the keys come from a secret file instead of .env.local. Values already set win.
for (const f of ['/etc/secrets/berekat.env']) {
  try {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  } catch { /* not hosted */ }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  // Browsers ask for /favicon.ico even with an SVG icon declared.
  async rewrites() {
    return [{ source: '/favicon.ico', destination: '/icon.svg' }];
  },
};
export default nextConfig;

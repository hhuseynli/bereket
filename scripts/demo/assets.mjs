#!/usr/bin/env node
// npm run demo:assets [-- --fix] [-- --normalize] [-- --ai]
//   (no flags)   inspect public/demo: which files exist, formats, durations, sizes, loudness
//   --fix        convert formats the app cannot use (wav/opus/aac/heic/png…) into <id>.ogg / <id>.jpg, and shrink huge photos
//   --normalize  loudness-normalise quiet or clipping recordings (the original is kept in public/demo/originals/)
//   --ai         transcribe the recordings and inspect the photos with the real AI (cached by file hash, so cheap to repeat)
// Never deletes or overwrites what you recorded: any file it replaces is moved to public/demo/originals/ first.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ANY_AUDIO_EXT, ASSETS, Report, ROOT, args, bold, dim, ffprobe, findAsset, run, which } from './lib.mjs';

const DIR = path.join(ROOT, 'public', 'demo');
const ORIG = path.join(DIR, 'originals');

function loudness(file) {
  try {
    const out = execFileSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return parseVol(out);
  } catch (e) {
    return parseVol(String(e.stderr ?? ''));
  }
}
function parseVol(s) {
  const mean = s.match(/mean_volume: (-?[\d.]+) dB/);
  const max = s.match(/max_volume: (-?[\d.]+) dB/);
  return mean && max ? { mean: Number(mean[1]), max: Number(max[1]) } : undefined;
}

function keepOriginal(file) {
  fs.mkdirSync(ORIG, { recursive: true });
  const dest = path.join(ORIG, `${Date.now()}-${path.basename(file)}`);
  fs.renameSync(file, dest);
  return dest;
}

function toOgg(src, dest, normalize) {
  const af = normalize ? ['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11'] : [];
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, ...af, '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '32k', dest]);
}

function toJpg(src, dest, maxPx = 2000) {
  if (process.platform === 'darwin' && which('sips')) {
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', '-Z', String(maxPx), src, '--out', dest], { stdio: 'ignore' });
  } else {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-vf', `scale='min(${maxPx},iw)':-2`, '-q:v', '3', dest]);
  }
}

export async function checkAssets(r, opts = {}) {
  const hasFfmpeg = !!which('ffmpeg');
  const changes = [];
  for (const [id, a] of Object.entries(ASSETS)) {
    let { found, usable } = findAsset(id);
    const label = `${a.label}`;
    if (!found.length) {
      if (a.required) r.warn(label, `missing: add public/demo/${id}.${a.kind === 'audio' ? 'ogg' : 'jpg'} (scripted fallback until then)`);
      else r.info(label, 'optional, not provided');
      continue;
    }
    // Convert a format the app cannot use.
    if (!usable && opts.fix) {
      const src = found[0];
      const dest = path.join(DIR, `${id}.${a.kind === 'audio' ? 'ogg' : 'jpg'}`);
      try {
        if (a.kind === 'audio') {
          if (!hasFfmpeg) throw new Error('FFmpeg needed: brew install ffmpeg');
          toOgg(src, dest, true);
        } else toJpg(src, dest);
        changes.push(`${path.basename(src)} → ${path.basename(dest)} (original kept)`);
        usable = dest;
      } catch (e) {
        r.fail(label, `could not convert ${path.basename(src)}: ${e.message}`);
        continue;
      }
    }
    if (!usable) {
      r.warn(label, `${path.basename(found[0])} is not a format the app plays: run npm run demo:assets -- --fix`);
      continue;
    }
    const size = fs.statSync(usable).size;
    const info = ffprobe(usable);
    if (a.kind === 'audio') {
      const dur = Number(info?.format?.duration ?? 0);
      const st = info?.streams?.find((s) => s.codec_type === 'audio');
      const problems = [];
      if (!info) problems.push(hasFfmpeg ? 'unreadable audio file' : 'install FFmpeg to check');
      if (info && !st) problems.push('no audio stream');
      if (dur && dur < 2) problems.push(`very short (${dur.toFixed(1)} s)`);
      if (dur > 45) problems.push(`long (${dur.toFixed(0)} s): keep voice notes under ~25 s for the pitch`);
      if (size > 16 * 1024 * 1024) problems.push('over 16 MB, the WhatsApp limit');
      let vol;
      if (hasFfmpeg && st) {
        vol = loudness(usable);
        if (vol && vol.max < -12) problems.push(`quiet (peak ${vol.max} dB)`);
        if (vol && vol.max >= -0.1) problems.push('may clip (peak 0 dB)');
      }
      const detail = `${path.basename(usable)} · ${st?.codec_name ?? '?'} ${st?.sample_rate ? `${Math.round(st.sample_rate / 1000)} kHz` : ''} ${st?.channels === 1 ? 'mono' : st?.channels ? `${st.channels} ch` : ''} · ${dur ? `${dur.toFixed(1)} s` : '?'} · ${(size / 1024).toFixed(0)} KB${vol ? ` · peak ${vol.max} dB` : ''}`;
      if (problems.length && opts.normalize && hasFfmpeg && problems.some((p) => /quiet|clip/.test(p))) {
        const kept = keepOriginal(usable);
        const dest = path.join(DIR, `${id}.ogg`);
        toOgg(kept, dest, true);
        changes.push(`${path.basename(usable)} normalised → ${path.basename(dest)} (original in ${path.relative(ROOT, kept)})`);
        r.pass(label, `${detail} → normalised`);
      } else if (problems.length) r.warn(label, `${detail} — ${problems.join('; ')}`);
      else r.pass(label, detail);
    } else {
      const st = info?.streams?.find((s) => s.codec_type === 'video');
      const w = st?.width ?? 0;
      const h = st?.height ?? 0;
      const problems = [];
      if (info && !st) problems.push('not an image');
      if (w && Math.min(w, h) < 400) problems.push(`small (${w}×${h})`);
      if (size > 5 * 1024 * 1024) problems.push(`${(size / 1e6).toFixed(1)} MB: AI image limit is 5 MB`);
      const detail = `${path.basename(usable)} · ${w && h ? `${w}×${h}` : '?'} · ${(size / 1024).toFixed(0)} KB`;
      if (problems.some((p) => /MB/.test(p)) && opts.fix) {
        const kept = keepOriginal(usable);
        toJpg(kept, usable, 1800);
        changes.push(`${path.basename(usable)} resized (original in ${path.relative(ROOT, kept)})`);
        r.pass(label, `${detail} → resized to ${(fs.statSync(usable).size / 1024).toFixed(0)} KB`);
      } else if (problems.length) r.warn(label, `${detail} — ${problems.join('; ')}`);
      else r.pass(label, detail);
    }
  }
  return changes;
}

export async function aiCheckAssets(r) {
  const res = await run(path.join(ROOT, 'node_modules/.bin/tsx'), [path.join(ROOT, 'scripts/demo/ai-check.mts'), 'assets', ...(process.argv.includes('--fresh') ? ['--fresh'] : [])], { quiet: true });
  const line = res.out.split('\n').reverse().find((l) => l.startsWith('{'));
  if (!line) {
    r.fail('AI check', res.out.split('\n').filter((l) => !/DEP0205|trace-deprecation/.test(l)).slice(-5).join(' '));
    return undefined;
  }
  const j = JSON.parse(line);
  for (const c of j.checks) r.add(c.status, c.name, `${c.mode ? `[${c.mode.toUpperCase()}] ` : ''}${c.detail}`);
  for (const c of j.checks) if (c.data?.transcript) console.log(dim(`        “${c.data.transcript}”`));
  return j;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = args();
  const r = new Report('Demo assets (public/demo)');
  if (!which('ffmpeg')) r.warn('FFmpeg', 'not installed: brew install ffmpeg (needed for audio checks and conversion)');
  const changes = await checkAssets(r, { fix: !!a.fix, normalize: !!a.normalize });
  if (changes.length) {
    console.log(`\n${bold('Changed')}`);
    changes.forEach((c) => console.log(`  ${c}`));
  }
  if (a.ai) {
    r.section('Real AI check (ElevenLabs + text/vision model; results cached by file hash)');
    const j = await aiCheckAssets(r);
    if (j) {
      fs.mkdirSync(path.join(ROOT, '.data'), { recursive: true });
      fs.writeFileSync(path.join(ROOT, '.data', 'assets-ai-report.json'), JSON.stringify({ at: new Date().toISOString(), ...j }, null, 2));
    }
  } else console.log(dim('\n  Add --ai to transcribe the recordings and inspect the photos with the real AI.'));
  console.log(dim(`\n  Exact scripts to record: public/demo/README.md. Supported audio: ${ANY_AUDIO_EXT.join(', ')}.`));
  process.exit(r.summary() ? 0 : 1);
}

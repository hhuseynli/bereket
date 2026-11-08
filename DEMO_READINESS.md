# BƏRƏKƏT — demo readiness

Status on **8 Nov 2026, 19:55 Baku**. Short version: the whole four-act demo runs end to end in a real browser,
at both projector sizes, with real DeepSeek and ElevenLabs integrations verified and a fallback that needs no
keys or network. What's left needs you: real recordings and photos, the phone numbers, and one Twilio Console
field.

## Exact commands

```bash
npm run demo:setup                      # idempotent; already run
npm run demo:doctor                     # 18 pass · 6 warn (all warnings = things below that need you)
npm run demo:assets -- --fix --ai       # after you add recordings/photos: convert, check, real transcription
npm run demo:verify                     # full automated verification (≈2 min)
npm run demo:rehearse -- --size=all     # four acts in Chrome at 1920×1080 and 1366×768
npm run demo:fallback                   # proves the backup plan
npm run demo:launch                     # ON STAGE (add -- --ai=cached for zero AI network calls)
npm run demo:stop
```

Real WhatsApp version, additionally: `npm run demo:tunnel` → paste URL into the sandbox →
`npm run demo:mode -- --whatsapp=twilio` → `npm run demo:whatsapp-test`.

## What is working

- **All four acts**, with the demo numbers unchanged: options **1.33 / 1.23 / 1.38 ₼/kg**, recovery
  **1.35 ₼/kg**, cancellation gap **80 kg**.
- **AI integrations.**
  - **DeepSeek `deepseek-flash`** (your key) handles listing extraction, photo inspection and cancellation
    intent. It's called through the Anthropic SDK against DeepSeek's Anthropic-compatible endpoint.
  - If an `ANTHROPIC_API_KEY` is added, Claude (`claude-opus-5-5`, configurable with `ANTHROPIC_MODEL`) is
    used instead. I enabled Anthropic's server-side refusal fallback on that path; it's off for DeepSeek.
  - **ElevenLabs Scribe v2** does speech-to-text (`aze`), via the official SDK. The key was created with the
    ElevenLabs CLI and verified (Starter plan, active).
- **Three AI modes.** Each step is labelled on the Intake screen and the mode shows as a header chip:
  - **LIVE**: a real provider call.
  - **CACHED**: a previously verified result for the same input.
  - **SIMULATED**: the script.

  Fallback order: live → cache → script, and each fallback says why. Switch with **F** or
  `npm run demo:mode -- --ai=…`.
- **Validation of AI output.**
  - Quantities and prices the model returns but the transcript doesn't contain get low confidence, which
    sends the listing to operator review.
  - Malformed JSON falls back gracefully.
  - Product names are normalised. This fixed a real bug: DeepSeek answers "tomato", and the engine would not
    have matched it.
  - Mixed "100 səksən" speech-to-text output parses as 180.
  - Photo checks are labelled "visual estimate, not a food-safety certification".
- **Twilio WhatsApp hardening.**
  - Signature validation that works behind the tunnel.
  - Only numbers in `FARMER_PHONES` are accepted; strangers are no longer auto-registered.
  - MessageSid de-duplication.
  - A durable in-order inbox in `.data/inbox`, replacing fire-and-forget.
  - Authenticated media download, with Twilio hosts only (no SSRF), type and size limits, and a reply asking
    the farmer to resend on failure.
  - Serial outbound queue with a ~3 s gap and one retry.
  - 24-hour window check before sending.
  - Delivery receipts (sent → delivered → read, or failed with Twilio's error, shown on the phone and in the
    ledger).
- **Access control for the tunnel.**
  - The server binds to 127.0.0.1.
  - Tunnel traffic needs the presenter token (`?key=` once, then an HttpOnly Secure cookie).
  - `/api/action`, `/api/phone`, `/api/state`, `/api/events`, media and pages all return 401 to anonymous
    visitors.
  - Phone numbers are masked in `/api/state`.
- **Timeline.** It's configurable (`DEMO_DATE`, default: today in Baku). The demo opens at 14:00 and delivers at
  09:00 the next day, and every date is derived from that one day.
- **Fonts.** Source Sans 3 and Source Serif 4 are bundled locally (OFL). No Google Fonts request, and Ə ə ğ ı ö ş ü ç ₼
  were verified in Chrome.
- **Restart and refresh.** State is snapshotted. `npm run demo:launch -- --resume` restores it (tested).
  A refresh reloads from the server.
- **Presenter panel (?).** Shows the current act, the exact next action, AI mode, provider and model,
  WhatsApp channel, Twilio readiness, and the last provider errors. No secrets.
- **Narrow screens.** The Live map and the phone dock now narrow below 1500 px, so the map stays readable at
  1366×768.

## Added after the first real recordings (8 Nov, evening)

Your real apple voice note exposed four problems: the cost price was taken as the selling price, the pipeline
waited silently for a photo, the Intake label said SIMULATED during a live run, and the bot could not hold a
conversation. Now:

- **The farmer side is a chat assistant**: questions answered from real data, corrections in plain words, **Düzəliş**
  asks what to fix instead of discarding the draft, a photo can come later, confirm or withdraw by talking.
- **Robust against model mistakes**:
  - Only actions that fit the situation are applied.
  - A number the farmer didn't say is never applied.
  - Confirmations are written from what was actually changed, and chat replies can't claim changes.
  - Cost vs selling price is told apart, with the farmer asked to confirm when two prices were said.
  - Product names are normalised.
- **Robust against the network**:
  - Clear messages skip the model.
  - A chat turn falls back to the rules after 12 s.
  - A slow live call falls back to a verified cached result after 8 s.
  - A provider that just failed is skipped for 45 s.
  - One farmer's messages are processed strictly in order. This fixed a real double-draft race in the
    simulator.
- **Tested LIVE with DeepSeek** on your transcript:
  - Apple 400 kg, at the selling price 1.50 (cost 1.25 kept in the notes).
  - The price question was answered from real market data (0.70–1.10 ₼/kg).
  - "yox, qiymət 1.40" → *Düzəltdim: qiymət 1.40 ₼/kq*, shown on Intake as a correction.
  - The first version claimed actions it hadn't done ("I updated…", "I confirmed…"); that's what the
    truthful-reply rules fix.
- **LIVE four-act rehearsal with your real recordings passes on the current flaky network**: Act 1 took 10.5 s,
  Act 3 6.0 s.
- **Tests:** 8/8 original, 12 readiness (5 new for the chat: cost vs selling price, corrections, Düzəliş,
  photo later, the never-apply-unsaid-numbers guard, message ordering, the bad-network fallback).
- **Your photo** was rated stage 5 (light red), which would remove Elşən from option i. It's kept in
  `public/demo/originals/`; the photo step uses the placeholder (labelled SIMULATED) until a pinker photo is
  added.

## Voice replies (added 8 Nov, night)

Every assistant reply can also be an Azerbaijani voice note:
- **Voice:** ElevenLabs `eleven_v4_turbo` with the library voice "Ibrahim Mammadli", which is native Azerbaijani,
  verified for v4 and conversational.
- **Format:** OGG/Opus mono, the WhatsApp voice-note format.
- **Cards** are spoken as natural sentences, with numbers and money in words.
- **Tested LIVE:**
  - Round trip: *"Salam, Elşən bəy! Elanınız hazırdır: yüz səksən kilo…"* → TTS → Scribe → the same sentence back.
  - In the app, the listing card became a 12.6 s voice note and a chat answer a 13.7 s one; auto-play in Chrome
    played both.
- **Cost:** about 70 characters of credit so far out of 40,000. A full live demo run is about 1,000; clips are
  cached and replayed for free.
- **Twilio:** a voice note is sent as a separate media message right after the text. The clip URL is public but
  unguessable (HMAC-keyed). Not yet tested on a real phone: needs the tunnel and your numbers.
- **The API key can't add voices** to your ElevenLabs library (no `voices_write`). Library voices work by ID
  anyway, so nothing is needed.

## Real-phone WhatsApp screen (added 8 Nov, night)

Twilio's WhatsApp sandbox didn't work from Azerbaijan, so the farmer side is now a **WhatsApp-style web screen**
(`/wa/<farmer>`) that real phones open over the local Wi-Fi (`npm run demo:phone`: HTTPS relay with a
self-signed certificate on :3443, QR codes in the terminal and at `/connect`, the access token is inside the QR
link). The laptop views no longer show the docked phone (P brings it back as a backup).

**Tested** (mobile-emulated Chrome through the real relay, on this laptop's Wi-Fi address):
- Login via the QR link (secure cookie).
- Live updates through the relay; the page counts as secure, so the microphone is allowed.
- **Hold-to-record** with the fake microphone playing your Elşən recording: uploaded and transcribed LIVE word
  for word, then the listing card, then **Təsdiq** tapped on the phone made it live.
- Full four-act rehearsal with the phone page: PASS at 1920×1080 and 1366×768.

**Not yet tested** on a physical phone (iPhone Safari / Android Chrome); do one dry run with your phone.

## What was actually tested

| Component | How | Detail |
|---|---|---|
| Matching engine, cost optimisation, recovery | LOCAL | existing 8/8 tests pass (numbers unchanged) |
| Timeline, AI validation, number parsing, webhook signature/dedupe/allowlist | LOCAL | 7 new readiness tests; signature checked against Twilio's own test vector |
| HTTP API, access control, Twilio webhook security | LOCAL | 31/31 checks on an isolated server, including SSRF refusal, forged signatures and tunnel visitors |
| Four acts via API in SIMULATED mode with **all keys removed** | SIMULATED | 12/12 + **L** fallback + mid-demo restart (`demo:fallback`) |
| Browser: every act, B/O switch, presenter keys, phone dock, 3 options, margin note, recovery, delivery, payout, two-way ratings | LOCAL | Chrome, **1920×1080 and 1366×768**, no console errors, no external requests |
| Listing extraction from Azerbaijani text | **LIVE**, then CACHED | DeepSeek: Tomato Roma 180 kg @ 1.15 ₼ |
| Cancellation intent (Rauf's text) | **LIVE**, then CACHED | DeepSeek: cancel, "hail damaged the tomatoes" |
| Photo inspection | **LIVE**, then CACHED | DeepSeek vision on the *rendered SVG placeholder*: stage 5 at 25 % confidence (correctly unsure about a drawing) |
| Speech-to-text | **LIVE**, then CACHED | ElevenLabs on a *synthetic* clip (macOS Turkish voice reading the Azerbaijani script): "…Roma pomidor var, birinci sortdur… bir manat on beş qəpik…". The synthetic voice mangles "ə", so this proves the pipeline, not the accuracy. |
| Full app in LIVE mode in the browser | **LIVE** | rehearsal with real DeepSeek extraction inside the app; Act 2 still matched 1.33/1.23/1.38 |
| Twilio credentials | **LIVE** | read-only account lookup: active, **Trial**; no message sent |
| Public tunnel → app → webhook | **LIVE** | cloudflared quick tunnel: anonymous 401, unsigned webhook 403, token login + cookie 200, **webhook signed with your real auth token accepted**; then stopped |
| Your real recordings/photos with real AI | NOT TESTED | not provided yet |
| Real WhatsApp round trip with phones | NOT TESTED | needs your phones: `npm run demo:whatsapp-test` |
| Anthropic / Claude | NOT TESTED | no Anthropic key was provided; the code path is shared with DeepSeek's |

## What remains simulated (by design, and labelled)

- Escrow, payouts and the demo clock.
- Truck movement.
- Other farmers' replies when you press **A**.
- The docked phone in simulator mode.
- Until you add recordings and photos: Elşən's and Rauf's transcripts (script) and the photo inspection (SVG
  placeholder).

## What is blocked (needs you)

1. **Phone numbers**: `FARMER_PHONES` in `.env.local` is empty, so real WhatsApp can't be tested.
2. **Sandbox participants**: each phone sends `join <code>` to +1 415 523 8886 (within 3 days of the demo).
3. **Recordings and photos**: `elsen-listing`, `rauf-cancel` and `tomatoes-stage4.jpg` are missing (scripts are
   in `public/demo/README.md`).
4. **Twilio sandbox webhook URL**: set in the Console only. `demo:tunnel` prints the URL and copies it to
   your clipboard.

## What you must do next

1. Record the two voice notes and take the stage-4 photo, and put them in `public/demo/`. Then run
   `npm run demo:assets -- --fix --ai`. This checks the formats, transcribes the recordings with ElevenLabs,
   extracts the listing and inspects the photo, and caches the results for CACHED mode. Run it again on the
   presentation day so today's extraction is cached.
2. Add the numbers to `.env.local`:
   `FARMER_PHONES=f-elsen=+994…,f-rauf=+994…,f-sebine=+994…`
   Use different phones per farmer if you can; one phone can't be two farmers.
3. Each phone joins the sandbox.
4. `npm run demo:launch -- --whatsapp=twilio`, then `npm run demo:tunnel`, then paste the URL into
   *Sandbox settings → When a message comes in* (POST) and save.
5. `npm run demo:whatsapp-test`: it tells you what to send from which phone and checks each step (see below).
6. Rehearse with a person talking: `npm run demo:launch`, follow [RUNBOOK.md](RUNBOOK.md), and time it.
7. Optional:
   - Top up DeepSeek: the balance is 1.70 USD, which is plenty for the demo.
   - Add an Anthropic key if you want Claude instead of DeepSeek.
   - Set `NGROK_DOMAIN` with an ngrok static domain, so the sandbox URL doesn't change on every tunnel
     start.

## Credentials and accounts (short guide)

| What | Where | Status |
|---|---|---|
| DeepSeek API key | `DEEPSEEK_API_KEY` in `.env.local` | set, verified |
| ElevenLabs | `npx -y @elevenlabs/cli@latest onboard init` (done: browser sign-in wrote `ELEVENLABS_API_KEY`) | set, verified |
| Twilio SID + auth token | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | set, verified (Trial) |
| Twilio sandbox | Console → Messaging → Try it out → Send a WhatsApp message | join code + webhook URL: **you** |
| Phones | `FARMER_PHONES` (E.164) | **you** |
| Presenter token | `DEMO_ADMIN_TOKEN` (generated by `demo:setup`) | set |
| Anthropic (optional) | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | not set |

`.env.local` is git-ignored with mode 600. No script prints secret values. The paste in this chat contained
the Twilio auth token and the DeepSeek key, so consider rotating both after the hackathon.

## Real WhatsApp test plan (what `npm run demo:whatsapp-test` checks)

| # | You do | Success looks like |
|---|---|---|
| 1 | Elşən's phone sends a **voice note**: "Salam. Mənim yüz səksən kilo Roma pomidorum var, birinci sortdur. Bu gün yığıram. Kilosunu bir manat on beş qəpikdən verirəm." plus a **photo** of pink tomatoes | Voice note arrives through the webhook |
| 2 | — | Transcribe step **LIVE** (ElevenLabs), transcript shown |
| 3 | — | Extract step **LIVE**: 180 kg Roma @ 1.15 ₼, ripeness from the photo |
| 4 | — | Operator → Intake shows the five steps |
| 5 | — | Elşən's phone receives **"Elanınız hazırdır"** (status sent/delivered) |
| 6 | Elşən replies **1** | Listing **live**, confirmation delivered |
| 7 | (script runs Act 2) Elşən replies **1** to the order | Elşən's allocation accepted |
| 8 | Səbinə's phone sends **"Salam, pomidorlarım hələ satılmayıb."** | Her 24-hour window is open |
| 9 | Rauf's phone sends a **voice note**: "Salam, bağışlayın. Dünən gecə dolu pomidorları vurdu, göndərə bilmirəm." | Operator → Live shows the 80 kg gap and Səbinə as the backup |
| 10 | Optional: approve, Səbinə replies **1** | Order repaired at 1.35 ₼/kg |

Results go to `.data/whatsapp-test.json`. A step you skip is reported as skipped, never as passed.

## Last successful rehearsal

**8 Nov 2026, 15:53 UTC**: `npm run demo:rehearse -- --size=all`, CACHED mode, realistic pacing.

- All four acts **PASS** at **1920×1080** and **1366×768**.
- **16 s** of app time and **25 presenter interactions** at each size, which leaves about 164 s of the 3 minutes
  for talking.
- Fonts verified, no external requests, no console errors.
- Screenshots: `.data/rehearsals/2026-11-08T15-53-15/`.

Final `npm run demo:verify`: **58 pass · 1 warn (no phones mapped) · 0 fail**.

## Notes

- **Cloudflared incident during testing.** Your `~/.cloudflared/config.yml` belongs to a named tunnel for
  `qeydiyyat.magistratura.az`, and it routes to `localhost:3000`.
  - The first tunnel test inherited that config. For about 80 seconds (15:48:21–15:49:40 UTC) that domain's
    tunnel had a connector on this laptop pointing at the demo app.
  - Any visitor in that window would have seen a 401 "presenter access only" page. No data was exposed.
  - I stopped it at once. `demo:tunnel` now runs cloudflared with an explicit empty config, and kills it
    before it connects if named-tunnel credentials ever appear.
  - Your other cloudflared process (`friend-claude`) was not touched.
- **Changed files.**
  - `src/lib/ai.ts`, `store.ts`, `seed.ts`, `flows.ts`, `types.ts`.
  - New: `twilio.ts`, `inbox.ts`, `presenter.ts`, `paths.ts`, `middleware.ts`.
  - API routes, `Shell.tsx`, `Phone.tsx`, the Intake and Live pages, `layout.tsx`, `globals.css`.
  - `scripts/demo/*`, `package.json`, `.env.example`, the docs.
  - A pre-change backup of the project is in the session scratchpad (`baseline.tgz`).

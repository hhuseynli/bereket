# BƏRƏKƏT — 3-minute presenter runbook

Laptop on the projector, Chrome full screen (⌃⌘F), zoom 100 %. Tested at 1920×1080 and 1366×768.
Start with `npm run demo:launch`: it opens **Operator → Intake** at Act 1. Press **?** at any time for the
presenter panel: current act, next action, AI mode, WhatsApp channel, last provider errors.

Two people: the **presenter** (laptop) and the **phone operator** (holds Elşən's and Rauf's phones in the real
WhatsApp version). In the simulator version the presenter does everything on the docked phone.

## Before you go on (T – 15 min)

```bash
npm run demo:doctor          # all green except what you chose not to use
npm run demo:fallback        # backup plan works with no keys, no network
npm run demo:launch          # or: npm run demo:launch -- --ai=cached   (no AI network calls)
```

Real WhatsApp version only: `npm run demo:tunnel`, paste the printed URL into the Twilio sandbox, `npm run
demo:mode -- --whatsapp=twilio`, and have **Səbinə's phone send "Salam"** now (it opens her 24-hour window).
Every phone must have sent `join <code>` to +1 415 523 8886 in the last 3 days.

## Phones (the farmer side runs on a real phone)

The farmer never sees the laptop. Elşən's phone (and optionally Rauf's and Səbinə's) opens a WhatsApp-style
screen served by the laptop over the local Wi-Fi:

```bash
npm run demo:phone        # HTTPS relay on :3443 + a QR code per farmer (also on the laptop at /connect)
```

1. Phone and laptop on the **same Wi-Fi**. Venue Wi-Fi often blocks devices from seeing each other: then connect
   the laptop to the phone's **hotspot** and run `npm run demo:phone` again (the address changes).
2. Scan Elşən's code. Warning "not private" (self-signed certificate, needed for the microphone): Android
   **Advanced → Proceed**, iPhone **Show Details → visit this website**. Once per phone.
3. Optional: browser menu → **Add to Home Screen** for a full-screen app.

On the phone: hold the green mic to record (slide left to cancel), 📷 for a photo, 📎 for the prepared voice notes
("Səsli mesaj + şəkil: pomidor satışı" sends the real recording and photo in one tap), tap card buttons to reply.
The laptop's **🔈 Voice replies** chip plays the bot's voice notes on the projector speakers.
No phone available? Press **P** for the old docked phone on the laptop.

## The four acts

| Time | Screen | Action | Expected on screen | Say | If it fails |
|---|---|---|---|---|---|
| **0:00** | Operator → Intake | **On Elşən's phone:** hold the mic and say the listing, then 📷 a photo. Safer: 📎 → **Səsli mesaj + şəkil: pomidor satışı** | Incoming row appears; five steps tick (transcript, fields, ripeness, price, draft), each with a LIVE / CACHED / SIMULATED tag; the phone gets **Elanınız hazırdır** | "Elşən doesn't fill in forms. He talks to WhatsApp in Azerbaijani, sends one photo, and the listing writes itself: 180 kg of Roma at 1.15, ripeness stage 4 from the photo." | A step shows FAILED or hangs > 10 s: **F** (→ CACHED) and send again. Still failing: **L** puts the listing live; say "here is the listing it produced this morning" and go on. |
| 0:35 | same | Tap **Təsdiq** on Elşən's phone | Ledger: *New listing live: Elşən, 180 kg Roma* | "One tap and he's selling." | No reaction: tap again; else **L**. |
| **0:45** | **B** → Tenders → **T-1042** | **Find supply** | Weave animation, then three options **1.33 / 1.23 / 1.38 ₼/kg** | "A restaurant needs 400 kg by tomorrow 09:00. No single farm has it. We combine three farms." | Reload the page (state is on the server). |
| 1:05 | Tender page | Point at margin note 2 | "Option ii is 0.10 ₼/kg cheaper, but 220 kg of it arrives fully red…" | "Cheapest isn't best: 220 kg would arrive overripe. We price the arrival condition, not just the kilo." | — |
| 1:20 | same | **Confirm option i → Confirm and send offers** | Order page; offers go to the three farmers' WhatsApp | | Double clicks are safe: one order only. |
| 1:30 | Elşən's phone, then laptop | Tap **Qəbul** on the phone, then press **A** on the laptop | Order **confirmed**, all three farmers accepted | "Each farmer confirms in one tap." | **A** again. |
| **1:40** | anywhere | **S** (skip if Səbinə already texted), then **C**. Real: Rauf's phone sends his voice note | View jumps to **Operator → Live**; red ledger line *Rauf Əliyev drops 80 kg* with his quote; **Fill the 80 kg gap** | "Then hail hits Rauf's field. He tells us by voice note, like any farmer would." | Nothing after 10 s: press **C** (scripted Rauf) and continue. |
| 1:55 | Operator → Live | Wait ~2 s for re-matching | Backup **Səbinə Kərimova**, 1.33 → **1.35 ₼/kg**, arrival unchanged | "BƏRƏKƏT keeps the two other farms, finds the one farm that fits the gap, and explains why the others don't." | "No backup found": say so honestly and go to Act 4 with **T**. |
| 2:10 | same | **Approve and send offer**, then **A** (Səbinə accepts; or she taps **Qəbul** on her phone) | Weave closes: **Order repaired** | "The operator approves, Səbinə accepts on WhatsApp, the order is whole again." | Press **A** again. |
| **2:25** | anywhere | **T** | Clock jumps to 09:00 next day; order **Arrived in Baku** | "Next morning." | — |
| 2:30 | **B** → Orders → **O-2207** | **Confirm receipt and release payment**, rate the three farmers 5 ★ | Escrow *released to farmers* (simulated); payout messages on the phones | "Payment was held safely until delivery — simulated here — and goes out on receipt. Both sides rate each other." | — |
| 2:45 | Elşən's phone | Type **5** and send | Ledger: *Elşən rated the buyer 5/5* | "Trust builds with every order." | — |
| **2:55** | | Stop | | Closing line | |

Automated rehearsal of exactly this sequence: `npm run demo:rehearse -- --size=all` (about 16 s of app time,
25 interactions; the rest of the 3 minutes is your talking).

## Voice replies

Before going on, click 🔊 on the docked phone so the assistant's voice notes play through the laptop speakers.
In Act 1 the listing card is then *spoken* in Azerbaijani: a strong moment for a digital-inclusion pitch ("farmers who
don't read comfortably hear their listing read back"). Generation takes a few seconds after the text; on a slow
network the text is already there, so keep talking. Rehearse once in LIVE so every demo reply is cached, then even
CACHED mode plays them with no network.

## Optional: show it is a conversation, not a form (+20 s)

After Act 1's card arrives, type on Elşən's phone: **yox, qiymət 1 manat 20 qəpik olsun**. The card comes back
with *Düzəltdim: qiymət 1.20 ₼/kq*, and Intake shows the correction with his words. Then type **hə, düzdür**.
(Keep the price at 1.15 if you want Act 2's numbers to stay 1.33 / 1.23 / 1.38: a different price changes them.)

## Presenter keys (outside text fields)

| Key | Does |
|---|---|
| **?** | Presenter panel and readiness (act, next step, modes, provider errors) |
| **B** / **O** | Buyer / Operator view |
| **A** | Other farmers accept their offers |
| **S** | Səbinə says hello (opens her 24-hour WhatsApp window) |
| **C** | Rauf cancels by voice note (scripted, or `public/demo/rauf-cancel.ogg`) |
| **T** | Jump to the delivery morning, 09:00 |
| **L** | Fallback: Elşən's listing goes live without Act 1 |
| **F** | AI mode: LIVE → CACHED → SIMULATED → LIVE (chip in the header shows it) |
| **W** | WhatsApp: simulator ↔ Twilio (chip shows *WhatsApp live*) |
| **V** | Voice replies on/off (the assistant's Azerbaijani voice notes) |
| **R** | Reset to Act 1 |
| **P** | Hide / show the docked phone |

## When something breaks

Priority: **live → cached → clearly simulated**. Never stop the story; every act works on its own.

| Problem | What you see | Do this |
|---|---|---|
| No internet | AI steps slow, then tagged CACHED/SIMULATED; ledger may show a delivery failure | **F** until the header says CACHED (verified results) or SIMULATED; **W** back to simulator. Fonts and assets are local, nothing else needs the network. |
| DeepSeek / Anthropic down or slow (> 25 s) | Step tagged CACHED or SIMULATED with "Fallback: … failed" | Nothing: the fallback is automatic and labelled. Say "the model is slow on this network, here's the result it produced earlier". |
| ElevenLabs down | Transcribe step CACHED (same recording) or the farmer gets "Səs aydın eşidilmədi" | For the demo recordings the cache answers. For a new live recording: **L**. |
| WhatsApp message not delivered | Phone bubble says *not delivered*; ledger *WhatsApp to … not delivered* with the reason | Usually the 24-hour window: that farmer sends any text first. Or **W** to the simulator and keep going on the docked phone. |
| Tunnel dropped | Real phones get no replies; `npm run demo:tunnel -- status` fails | **W** → simulator. Afterwards `npm run demo:tunnel` (new URL → paste into the sandbox). |
| Recording missing | Transcribe step SIMULATED ("scripted voice note") | Fine for the pitch; it is labelled. |
| Bad / unreadable photo | Inspect step low confidence → Intake shows **Approve listing** | Click **Approve listing** (operator review is part of the product). |
| Browser refresh / closed tab | — | Reopen `localhost:3000`; everything comes back from the server. |
| Server crashed | Page shows "Loading…" | `npm run demo:launch -- --resume` (restores the last state) — about 3 s. |
| Duplicate WhatsApp delivery | — | Handled: each Twilio MessageSid is processed once. |
| Photo before voice, or voice before photo | Phone asks for the missing one | Send the other one; order does not matter. |
| The assistant answers oddly | A chat reply that misses the point | Type the plain version ("1", "qiymət 1.15", "350 kilo"); quick replies never need the AI. |
| Slow network in LIVE | Steps tagged CACHED with "slower than 8 s" | Expected: the verified result is shown. If it keeps happening, **F** once for CACHED. |
| Everything is weird | | **R** (reset) and run the act again, or **L** and jump to Act 2. |

After the pitch: `npm run demo:stop`.

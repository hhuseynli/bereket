# BƏRƏKƏT

Many small farms, woven into one reliable supply. A demo for the YUNEX 2026 Digital Inclusion hackathon.

Farmers sell through WhatsApp in Azerbaijani (voice notes, photos, one-tap replies). Buyers and the
operations team use one web platform with a Buyer / Operator switch. All people and businesses in the demo
data are fictional, and escrow and payouts are simulated: no real money moves.

## Run it

```bash
npm install
cp .env.example .env.local   # optional: add keys
npm run build && npm start   # http://localhost:3000
npm test                     # matching engine + full demo flow, no keys needed
```

Use `npm start` (one server process) for the demo. Live sync between the phone, Buyer and Operator views
uses Server-Sent Events from a single in-memory state.

## The 3-minute demo

The farmer's phone is docked on the left (press **P** to hide it). Press **?** for all presenter keys.

1. **A voice note becomes a listing.** Operator → Intake. In the phone, tap **+** → *Voice note + photo*.
   The pipeline runs: transcript, fields, ripeness from the photo, price check, draft. Tap **Təsdiq**.
2. **Three farms, one order.** Press **B**, open tender T-1042, **Find supply**. Show margin note 2
   (the cheapest lot arrives overripe). **Confirm option i**. Tap **Qəbul** on Elşən's phone, press **A**.
3. **A farmer drops out.** Press **S** (Səbinə says hello, which opens her WhatsApp window), then **C**:
   Rauf cancels by voice, the view jumps to Operator → Live, the weave shows the 80 kg gap.
   **Approve and send offer**, then tap **Qəbul** on Səbinə's phone. The weave closes.
4. **Delivered and trusted.** Press **T** (Thursday 09:00), open the order as Buyer, **Confirm receipt**,
   rate the farmers. Reply **5** from Elşən's phone to rate the buyer.

Fallbacks: **L** puts Elşən's listing live if Act 1 fails. **F** switches the AI to cached or scripted
results if the network dies. **R** resets everything.

Demo numbers (from the real engine, see `src/lib/engine.test.ts`): options at 1.33 / 1.23 / 1.38 ₼/kg,
and 1.35 ₼/kg after Səbinə replaces Rauf.

## Real vs simulated

| Real | Simulated, and labeled |
|---|---|
| Azerbaijani speech-to-text (ElevenLabs `scribe_v2`, `language_code=aze`) | Escrow and payouts |
| Listing extraction and photo ripeness/defects (Claude with vision) | Truck movement and the demo clock |
| Cancellation intent from a voice note | Other farmers' replies when you press **A** |
| Matching, combining farms, routing, cost, re-matching (`src/lib/engine.ts`) | WhatsApp delivery in simulator mode |
| Live sync, order states, ratings | |

Every AI call is cached in `.data/ai-cache/` by input hash, so rehearsals with the same recordings cost
nothing. Without keys the app uses scripted transcripts and an offline Azerbaijani extractor.

## Real WhatsApp (Twilio sandbox)

1. In the Twilio Console, open the WhatsApp sandbox. Each teammate sends `join <code>` to
   +1 415 523 8886 from their phone. Rejoin within 3 days of the demo.
2. Put the keys and `FARMER_PHONES` in `.env.local`.
3. Expose the app: `npx ngrok http 3000` (or any tunnel) and set the sandbox's
   *When a message comes in* URL to `https://<tunnel>/api/twilio` (POST).
4. Press **W** in the app (or set `WHATSAPP_CHANNEL=twilio`). Messages to mapped phones now go out
   through Twilio, and the docked phone mirrors the real conversations.

Sandbox rules to remember: free-form replies only within 24 hours of the farmer's last message (press
**S** or have Səbinə text before Act 3), one message every 3 seconds (sends are queued), and no custom
buttons, so offers ask the farmer to reply 1 or 2.

## Demo assets

Put real recordings and photos in `public/demo/` (names in `public/demo/README.md`). Without them the
demo uses scripted transcripts and SVG placeholders.

## Code map

- `src/lib/engine.ts` matching, aggregation, routing, recovery, and reasons written from the numbers
- `src/lib/flows.ts` WhatsApp conversation, AI listing pipeline, orders, cancellation, presenter controls
- `src/lib/ai.ts` ElevenLabs, Claude, caching, offline extractor
- `src/lib/store.ts` shared state, demo clock, ledger, Twilio sender
- `src/app/buyer`, `src/app/operator` the two perspectives; `src/components/Phone.tsx` the farmer's phone

Before the pitch: check prices against real local wholesale prices, and confirm the fonts render Ə, ğ and ı
on the presentation laptop.

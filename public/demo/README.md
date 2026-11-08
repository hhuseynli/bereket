Demo assets. Drop real files here with these names; the app picks them up automatically. Then run
`npm run demo:assets` (format, length, loudness) and `npm run demo:assets -- --ai` (real transcription and
photo inspection, cached so it costs nothing on stage). Nothing here is ever overwritten: anything the
tools convert or normalise is first moved to `public/demo/originals/`.

| File | What | Script to say (Azerbaijani) |
|---|---|---|
| `elsen-listing.ogg` | Elşən's voice note, 8–20 s | Salam. Mənim yüz səksən kilo Roma pomidorum var, birinci sortdur. Bu gün yığıram. Kilosunu bir manat on beş qəpikdən verirəm. |
| `rauf-cancel.ogg` | Rauf's voice note, 4–10 s | Salam, bağışlayın. Dünən gecə dolu pomidorları vurdu, göndərə bilmirəm. |
| `tomatoes-stage4.jpg` | Real photo of pink (stage 4) Roma tomatoes, in a crate, daylight, under 5 MB | — |
| `tomatoes-stage6.jpg` | Optional: fully red tomatoes (Q&A) | — |
| `tomatoes-spoiled.jpg` | Optional: visibly mouldy or split tomatoes (Q&A: the listing is held) | — |

Easiest way to record: send the voice note to yourself on WhatsApp, then save it (WhatsApp exports `.opus`
or `.ogg`); or use the iPhone Voice Memos app (`.m4a`). `.ogg .mp3 .m4a .webm` play as they are; `.wav .opus
.aac .flac .amr` and `.heic/.png` photos are converted by `npm run demo:assets -- --fix`.

Recording tips: quiet room, phone 20 cm from the mouth, say the numbers clearly as words. Speech-to-text
sometimes writes "100 səksən" for "yüz səksən"; the app copes with that, and any number it cannot find in the
transcript is shown with low confidence and sent to the operator to check instead of being trusted.

Without these files the demo still runs, using the scripted transcripts and the SVG placeholders, and every
such step is labelled SIMULATED on the Intake screen.

// Messages to farmers are written in Azerbaijani with an English twin (text / textEn). For a farmer who chats in
// English, the twin becomes the message, and the two WhatsApp cards (listing, order offer) are translated here.
import { STAGES } from './ripeness';
import type { Message } from './types';

const TITLE: Record<string, string> = { 'Elanınız hazırdır': 'Your listing is ready', 'Yeni sifariş': 'New order' };
const ROW: Record<string, string> = { Məhsul: 'Product', Miqdar: 'Quantity', Qiymət: 'Price', Sort: 'Grade', Yetişmə: 'Ripeness', Təzəlik: 'Freshness', Alıcı: 'Buyer', Məbləğ: 'Total' };
const FRESH: Record<string, string> = { təzə: 'fresh', 'təzəliyini itirməyə başlayıb': 'starting to age', 'köhnə görünür': 'looks old' };
const ACTION: Record<string, string> = { Təsdiq: 'Confirm', Düzəliş: 'Edit', Qəbul: 'Accept', İmtina: 'Decline' };
const PRODUCT: Record<string, string> = { Pomidor: 'Tomato', Xiyar: 'Cucumber', Alma: 'Apple', Kartof: 'Potato', Bibər: 'Pepper', Soğan: 'Onion', Armud: 'Pear', Kələm: 'Cabbage', Yerkökü: 'Carrot', Badımcan: 'Eggplant', Lobya: 'Beans', Heyva: 'Quince', Xurma: 'Persimmon', Fındıq: 'Hazelnut', Qoz: 'Walnut' };

function value(v: string) {
  if (FRESH[v]) return FRESH[v];
  let out = v
    .replace(/\bkq\b/g, 'kg')
    .replace(/\bbu gün\b/g, 'today')
    .replace(/\bsabah\b/g, 'tomorrow')
    .replace(/şəkil gözlənilir/g, 'photo needed');
  for (const s of STAGES) out = out.replace(new RegExp(`\\b${s.az}\\b`), s.name.toLowerCase());
  for (const [az, en] of Object.entries(PRODUCT)) out = out.replace(new RegExp(`^${az}\\b`), en);
  return out;
}

type Out = Omit<Message, 'id' | 'farmerId' | 'dir' | 'at' | 'via'>;

export function forFarmer(msg: Out, lang: 'az' | 'en' | undefined): Out {
  if (lang !== 'en') return msg;
  const out: Out = { ...msg, text: msg.textEn ?? msg.text };
  if (msg.card) {
    const pickup = msg.card.title === 'Yeni sifariş';
    out.card = {
      ...msg.card,
      title: TITLE[msg.card.title] ?? msg.card.title,
      rows: msg.card.rows.map(([k, v]) => [k === 'Yığım' ? (pickup ? 'Pickup' : 'Harvest') : ROW[k] ?? k, value(v)] as [string, string]),
      actions: msg.card.actions?.map((a) => ({ ...a, label: ACTION[a.label] ?? a.label })),
    };
    // The card says it all; the English lead sentence only (textEn also repeats the card in prose).
    out.text = msg.textEn && msg.text ? leadOf(msg.textEn) : '';
  }
  return out;
}

/** "Payment is held… Your listing: …" → the part before the card's prose summary. */
function leadOf(en: string) {
  const cut = en.search(/\b(Your listing:|New order from)/);
  return (cut > 0 ? en.slice(0, cut) : cut === 0 ? '' : en).trim();
}

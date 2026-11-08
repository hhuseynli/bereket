// Scripted demo voice notes and placeholder photos. No Node imports: shared by server and browser.

export const DEMO_VOICE: Record<string, { farmerId: string; label: string; az: string; en: string; file?: string }> = {
  'elsen-listing': {
    farmerId: 'f-elsen',
    label: 'Elşən: tomatoes for sale',
    az: 'Salam. Mənim yüz səksən kilo Roma pomidorum var, birinci sortdur. Bu gün yığıram. Kilosunu bir manat on beş qəpikdən verirəm.',
    en: "Hello. I have 180 kilos of Roma tomatoes, first grade. I'm harvesting today. I sell them at 1 manat 15 qəpik a kilo.",
  },
  'rauf-cancel': {
    farmerId: 'f-rauf',
    label: 'Rauf: hail, cannot deliver',
    az: 'Salam, bağışlayın. Dünən gecə dolu pomidorları vurdu, göndərə bilmirəm.',
    en: "Hello, I'm sorry. Hail hit the tomatoes last night, I can't send them.",
  },
  'sebine-hello': {
    farmerId: 'f-sebine',
    label: 'Səbinə: still have tomatoes',
    az: 'Salam, pomidorlarım hələ satılmayıb. Alıcı olsa, xəbər verin.',
    en: "Hi, my tomatoes aren't sold yet. Let me know if there's a buyer.",
  },
};

export const DEMO_PHOTOS: { id: string; label: string; url: string; stage: number }[] = [
  { id: 'tomatoes-stage4', label: 'Roma tomatoes, pink', url: '/demo/tomatoes-stage4.svg', stage: 4 },
  { id: 'tomatoes-stage6', label: 'Roma tomatoes, red', url: '/demo/tomatoes-stage6.svg', stage: 6 },
  { id: 'tomatoes-spoiled', label: 'Tomatoes, spoiled', url: '/demo/tomatoes-spoiled.svg', stage: 6 },
];


// The six-stage tomato ripeness scale and a simple ambient ripening model.

export const STAGES = [
  { n: 1, name: 'Green', az: 'yaşıl', color: '#5E7F3A' },
  { n: 2, name: 'Breaker', az: 'çalan', color: '#A7A54B' },
  { n: 3, name: 'Turning', az: 'dönən', color: '#D9A441' },
  { n: 4, name: 'Pink', az: 'çəhrayı', color: '#E2805A' },
  { n: 5, name: 'Light red', az: 'açıq qırmızı', color: '#D2513A' },
  { n: 6, name: 'Red', az: 'qırmızı', color: '#B02A22' },
] as const;

/** Produce whose ripeness on arrival is tracked (from the photo) and matched against the buyer's window. */
export const tracksRipeness = (product: string) => product === 'Tomato';

/** Stages advanced per day at ambient temperature (~20 °C) after picking. */
export const RIPEN_PER_DAY = 1.0;

export function stageAt(stageToday: number, hoursAhead: number): number {
  return Math.min(6, stageToday + (RIPEN_PER_DAY * Math.max(0, hoursAhead)) / 24);
}

export function stageInfo(stage: number) {
  const i = Math.max(1, Math.min(6, Math.round(stage))) - 1;
  return STAGES[i];
}

/** Window test on the continuous stage: wanted 4..5 accepts 3.5..5.5. */
export function inWindow(stage: number, min: number, max: number): boolean {
  return stage >= min - 0.5 && stage <= max + 0.5;
}

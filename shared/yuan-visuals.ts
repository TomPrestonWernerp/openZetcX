export interface YuanVisual {
  yuan: string;
  symbol: string;
  moodLabel: string;
  accent: string;
  avatar: string;
}

const FALLBACK_YUAN = "openZetcX";
const OPEN_ZETC_VISUAL: Readonly<YuanVisual> = Object.freeze({
  yuan: FALLBACK_YUAN,
  symbol: "",
  moodLabel: "Ta",
  accent: "#537D96",
  avatar: "openZetcX.png",
});

export const YUAN_VISUALS: Readonly<Record<string, Readonly<YuanVisual>>> = Object.freeze({
  openzetcx: OPEN_ZETC_VISUAL,
});

export function normalizeYuan(_yuan?: string | null): string {
  return "openzetcx";
}

export function getYuanVisual(_yuan?: string | null): Readonly<YuanVisual> {
  return OPEN_ZETC_VISUAL;
}

export function moodLabelForYuan(_yuan?: string | null): string {
  return OPEN_ZETC_VISUAL.moodLabel;
}

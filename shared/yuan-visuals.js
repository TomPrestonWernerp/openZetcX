const FALLBACK_YUAN = "hanako";

export const YUAN_VISUALS = Object.freeze({
  hanako: Object.freeze({
    yuan: "hanako",
    symbol: "✿",
    moodLabel: "MOOD",
    accent: "#537D96",
    avatar: "openZetcX.png",
  }),
  butter: Object.freeze({
    yuan: "butter",
    symbol: "❊",
    moodLabel: "PULSE",
    accent: "#5BA88C",
    avatar: "Butter.png",
  }),
  ming: Object.freeze({
    yuan: "ming",
    symbol: "◈",
    moodLabel: "REFLECT",
    accent: "#8BA4B4",
    avatar: "Ming.png",
  }),
  kong: Object.freeze({
    yuan: "kong",
    symbol: "◇",
    moodLabel: "RAW",
    accent: "#6F8797",
    avatar: "Kong.png",
  }),
  openzetcx: Object.freeze({
    yuan: "hanako",
    symbol: "✿",
    moodLabel: "MOOD",
    accent: "#537D96",
    avatar: "openZetcX.png",
  }),
});

export function normalizeYuan(yuan) {
  const key = String(yuan || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(YUAN_VISUALS, key) ? key : FALLBACK_YUAN;
}

export function getYuanVisual(yuan) {
  return YUAN_VISUALS[normalizeYuan(yuan)];
}

export function moodLabelForYuan(yuan) {
  const visual = getYuanVisual(yuan);
  return `${visual.symbol} ${visual.moodLabel}`;
}

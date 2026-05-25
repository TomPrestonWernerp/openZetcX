import { describe, expect, it } from "vitest";
import { getYuanVisual, moodLabelForYuan, normalizeYuan } from "../shared/yuan-visuals.js";

describe("yuan visuals", () => {
  it("keeps the desktop and CLI yuan symbolism in one place", () => {
    expect(getYuanVisual("hanako")).toMatchObject({
      symbol: "✿",
      moodLabel: "MOOD",
      accent: "#537D96",
      avatar: "openZetcX.png",
    });
    expect(getYuanVisual("butter")).toMatchObject({
      symbol: "❊",
      moodLabel: "PULSE",
      accent: "#5BA88C",
      avatar: "Butter.png",
    });
    expect(getYuanVisual("ming")).toMatchObject({
      symbol: "◈",
      moodLabel: "REFLECT",
      accent: "#8BA4B4",
      avatar: "Ming.png",
    });
    expect(getYuanVisual("kong")).toMatchObject({
      symbol: "◇",
      moodLabel: "RAW",
      accent: "#6F8797",
      avatar: "Kong.png",
    });
    expect(getYuanVisual("openZetcX")).toMatchObject({
      yuan: "hanako",
      avatar: "openZetcX.png",
    });
  });

  it("falls back to hanako for unknown yuan values", () => {
    expect(normalizeYuan("unknown")).toBe("hanako");
    expect(moodLabelForYuan("unknown")).toBe("✿ MOOD");
  });
});

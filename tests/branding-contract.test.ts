import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("enterprise branding contract", () => {
  it("uses the v0.4.2 enterprise slogans and about tagline", () => {
    const locale = JSON.parse(
      fs.readFileSync(path.join(ROOT, "desktop/src/locales/zh.json"), "utf-8"),
    );
    expect(locale.yuan.splash.openZetcX).toEqual(locale.splash.lines);
    expect(locale.settings.about.tagline).toBe("浙江省环境科技 AI Agent 助手");
  });

  it("uses the enterprise logo for the app icon and default avatar", () => {
    const icon = fs.readFileSync(path.join(ROOT, "desktop/src/icon.png"));
    const avatar = fs.readFileSync(path.join(ROOT, "desktop/src/assets/openZetcX.png"));
    expect(avatar.equals(icon)).toBe(true);
  });
});

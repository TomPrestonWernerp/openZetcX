import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const rootDir = path.resolve(import.meta.dirname, "..");

describe("splash loader", () => {
  it("uses a CSS-drawn loader instead of font-dependent glyphs", () => {
    const appSource = fs.readFileSync(
      path.join(rootDir, "desktop", "src", "react", "splash", "SplashApp.tsx"),
      "utf-8",
    );
    const htmlSource = fs.readFileSync(
      path.join(rootDir, "desktop", "src", "splash.html"),
      "utf-8",
    );

    expect(appSource).toContain('className="splash-loader"');
    expect(appSource).not.toContain("visual.symbol");
    expect(appSource).not.toContain("splash-sakura");
    expect(htmlSource).toContain(".splash-loader");
    expect(htmlSource).toContain("border-top-color: currentColor");
  });
});

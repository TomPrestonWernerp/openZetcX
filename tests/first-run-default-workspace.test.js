import fs from "fs";
import os from "os";
import path from "path";
import YAML from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("first run default workspace", () => {
  let tmpDir;
  let homeDir;
  let productDir;
  let openZetcXHome;
  let homedirSpy;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-first-run-workspace-"));
    homeDir = path.join(tmpDir, "home");
    productDir = path.join(tmpDir, "product");
    openZetcXHome = path.join(tmpDir, ".openZetcX");
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(productDir, { recursive: true });
    fs.writeFileSync(
      path.join(productDir, "config.example.yaml"),
      [
        "agent:",
        "  name: openZetcX",
        "  yuan: openZetcX",
        "user:",
        '  name: ""',
        "models:",
        '  chat: ""',
      ].join("\n"),
      "utf-8",
    );
    homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(homeDir);
  });

  afterEach(() => {
    homedirSpy?.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it("seeds openZetcX with the desktop OH-WorkSpace, enabled memory, and disabled patrol defaults", async () => {
    const { ensureFirstRun } = await import("../core/first-run.js");

    ensureFirstRun(openZetcXHome, productDir);

    const workspace = path.join(homeDir, "Desktop", "OH-WorkSpace");
    const cfgPath = path.join(openZetcXHome, "agents", "openZetcX", "config.yaml");
    const cfg = YAML.load(fs.readFileSync(cfgPath, "utf-8"));

    expect(fs.statSync(workspace).isDirectory()).toBe(true);
    expect(cfg.desk.home_folder).toBe(workspace);
    expect(cfg.desk.heartbeat_enabled).toBe(false);
    expect(cfg.desk.heartbeat_interval).toBe(31);
    expect(cfg.memory.enabled).toBe(true);
  });

  it("removes discontinued bundled skills during startup sync", async () => {
    const skillsSrc = path.join(tmpDir, "skills2set");
    const activeSkill = path.join(skillsSrc, "openZetcX-plugin-creator");
    const removedSkill = path.join(openZetcXHome, "skills", "openzetcx-brand-guard");
    fs.mkdirSync(activeSkill, { recursive: true });
    fs.mkdirSync(removedSkill, { recursive: true });
    fs.writeFileSync(path.join(activeSkill, "SKILL.md"), "---\nname: openZetcX-plugin-creator\n---\n", "utf-8");
    fs.writeFileSync(path.join(removedSkill, "SKILL.md"), "---\nname: openzetcx-brand-guard\n---\n", "utf-8");

    const { ensureFirstRun } = await import("../core/first-run.js");
    ensureFirstRun(openZetcXHome, productDir);

    expect(fs.existsSync(path.join(openZetcXHome, "skills", "openZetcX-plugin-creator", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(removedSkill)).toBe(false);
  });
});

import fs from "fs";
import os from "os";
import path from "path";
import YAML from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPENZETCX_DEFAULT_ROLE_PRESETS } from "../shared/openzetcx-role-presets.ts";

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
    fs.mkdirSync(path.join(productDir, "role-avatars"), { recursive: true });
    fs.writeFileSync(
      path.join(productDir, "config.example.yaml"),
      [
        "agent:",
        "  name: Hanako",
        "  yuan: hanako",
        "user:",
        '  name: ""',
        "models:",
        '  chat: ""',
      ].join("\n"),
      "utf-8",
    );
    for (const role of OPENZETCX_DEFAULT_ROLE_PRESETS) {
      fs.writeFileSync(path.join(productDir, "role-avatars", role.avatarFile), `avatar:${role.id}`, "utf-8");
    }
    homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(homeDir);
  });

  afterEach(() => {
    homedirSpy?.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it("seeds the bundled default roles with the desktop OH-WorkSpace and avatars", async () => {
    const { ensureFirstRun } = await import("../core/first-run.ts");

    ensureFirstRun(openZetcXHome, productDir);

    const workspace = path.join(homeDir, "Desktop", "OH-WorkSpace");
    expect(fs.statSync(workspace).isDirectory()).toBe(true);

    for (const role of OPENZETCX_DEFAULT_ROLE_PRESETS) {
      const agentDir = path.join(openZetcXHome, "agents", role.id);
      const cfg = YAML.load(fs.readFileSync(path.join(agentDir, "config.yaml"), "utf-8"));
      const identity = fs.readFileSync(path.join(agentDir, "identity.md"), "utf-8");
      const ishiki = fs.readFileSync(path.join(agentDir, "ishiki.md"), "utf-8");

      expect(cfg.agent.name).toBe(role.name);
      expect(cfg.agent.yuan).toBe("openZetcX");
      expect(cfg.agent.rolePreset).toBe(role.id);
      expect(cfg.desk.home_folder).toBe(workspace);
      expect(cfg.desk.heartbeat_enabled).toBe(false);
      expect(cfg.desk.heartbeat_interval).toBe(31);
      expect(cfg.memory.enabled).toBe(true);
      expect(identity).toContain(`# ${role.name}`);
      expect(identity).not.toContain("{{agentName}}");
      expect(identity).not.toContain("{{userName}}");
      expect(ishiki).toContain("# 工作方式");
      expect(fs.existsSync(path.join(agentDir, "avatars", "agent.png"))).toBe(true);
    }

    const prefs = JSON.parse(fs.readFileSync(path.join(openZetcXHome, "user", "preferences.json"), "utf-8"));
    expect(prefs.primaryAgent).toBe("general");
  });

  it("tops up and refreshes bundled defaults on existing installs", async () => {
    const developer = OPENZETCX_DEFAULT_ROLE_PRESETS.find((role) => role.id === "developer");
    const developerDir = path.join(openZetcXHome, "agents", "developer");
    fs.mkdirSync(path.join(developerDir, "avatars"), { recursive: true });
    fs.writeFileSync(
      path.join(developerDir, "config.yaml"),
      "agent:\n  name: Old Developer\n  yuan: hanako\n",
      "utf-8",
    );
    fs.writeFileSync(path.join(developerDir, "identity.md"), "# old\n", "utf-8");
    fs.writeFileSync(path.join(developerDir, "ishiki.md"), "# old\n", "utf-8");
    fs.writeFileSync(path.join(developerDir, "avatars", "agent.png"), "old-avatar", "utf-8");
    const { ensureFirstRun } = await import("../core/first-run.ts");

    const report = ensureFirstRun(openZetcXHome, productDir);

    expect(report.invalidAgentDirs).toEqual([]);
    for (const role of OPENZETCX_DEFAULT_ROLE_PRESETS) {
      expect(fs.existsSync(path.join(openZetcXHome, "agents", role.id, "config.yaml"))).toBe(true);
    }
    const cfg = YAML.load(fs.readFileSync(path.join(developerDir, "config.yaml"), "utf-8"));
    expect(cfg.agent.name).toBe(developer?.name);
    expect(cfg.agent.yuan).toBe("openZetcX");
    expect(cfg.agent.rolePreset).toBe("developer");
    expect(fs.readFileSync(path.join(developerDir, "identity.md"), "utf-8")).toContain(`# ${developer?.name}`);
    expect(fs.readFileSync(path.join(developerDir, "ishiki.md"), "utf-8")).not.toContain("# old");
    expect(fs.readFileSync(path.join(developerDir, "avatars", "agent.png"), "utf-8")).toBe("avatar:developer");
  });

  it("tops up all bundled defaults on legacy installs that only have old agents", async () => {
    const legacyAgentIds = ["openZetcX", "standard", "xiaohuan", "xiaoshen", "xsheng"];
    for (const agentId of legacyAgentIds) {
      const agentDir = path.join(openZetcXHome, "agents", agentId);
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(
        path.join(agentDir, "config.yaml"),
        `agent:\n  name: ${agentId}\n  yuan: openZetcX\n`,
        "utf-8",
      );
    }
    const { ensureFirstRun } = await import("../core/first-run.ts");

    const report = ensureFirstRun(openZetcXHome, productDir);

    expect(report.invalidAgentDirs).toEqual([]);
    expect(report.repairedDefaultAgent).toBe(true);
    for (const role of OPENZETCX_DEFAULT_ROLE_PRESETS) {
      const agentDir = path.join(openZetcXHome, "agents", role.id);
      const cfg = YAML.load(fs.readFileSync(path.join(agentDir, "config.yaml"), "utf-8"));
      expect(cfg.agent.name).toBe(role.name);
      expect(cfg.agent.yuan).toBe("openZetcX");
      expect(cfg.agent.rolePreset).toBe(role.id);
      expect(fs.readFileSync(path.join(agentDir, "avatars", "agent.png"), "utf-8")).toBe(`avatar:${role.id}`);
    }
    for (const agentId of legacyAgentIds) {
      expect(fs.existsSync(path.join(openZetcXHome, "agents", agentId, "config.yaml"))).toBe(true);
    }
  });

  it("repairs a half-initialized primary default role directory", async () => {
    fs.mkdirSync(path.join(openZetcXHome, "agents", "general", "memory"), { recursive: true });
    const { ensureFirstRun } = await import("../core/first-run.ts");

    ensureFirstRun(openZetcXHome, productDir);

    const cfgPath = path.join(openZetcXHome, "agents", "general", "config.yaml");
    const cfg = YAML.load(fs.readFileSync(cfgPath, "utf-8"));
    expect(cfg.agent.name).toBe("通用助手");
    expect(fs.statSync(path.join(openZetcXHome, "agents", "general", "sessions")).isDirectory()).toBe(true);
    expect(fs.existsSync(path.join(openZetcXHome, "agents", "developer", "config.yaml"))).toBe(true);
  });

  it("keeps startup alive and reports non-default agent directories without config.yaml", async () => {
    fs.mkdirSync(path.join(openZetcXHome, "agents", "kon", "phone", "conversations"), { recursive: true });
    const { ensureFirstRun } = await import("../core/first-run.ts");

    const report = ensureFirstRun(openZetcXHome, productDir);

    expect(report.invalidAgentDirs).toEqual([
      { id: "kon", reason: "config_missing" },
    ]);
    expect(fs.existsSync(path.join(openZetcXHome, "agents", "general", "config.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(openZetcXHome, "agents", "kon", "pinned.md"))).toBe(false);
    expect(fs.existsSync(path.join(openZetcXHome, "agents", "general", "pinned.md"))).toBe(true);
  });

  it("keeps startup alive and reports non-default agent directories with unreadable config.yaml", async () => {
    const brokenDir = path.join(openZetcXHome, "agents", "broken-agent");
    fs.mkdirSync(brokenDir, { recursive: true });
    fs.writeFileSync(path.join(brokenDir, "config.yaml"), "agent: [unclosed\n", "utf-8");
    const { ensureFirstRun } = await import("../core/first-run.ts");

    const report = ensureFirstRun(openZetcXHome, productDir);

    expect(report.invalidAgentDirs).toHaveLength(1);
    expect(report.invalidAgentDirs[0].id).toBe("broken-agent");
    expect(report.invalidAgentDirs[0].reason).toBe("config_unreadable");
    expect(fs.readFileSync(path.join(brokenDir, "config.yaml"), "utf-8")).toBe("agent: [unclosed\n");
    expect(fs.existsSync(path.join(openZetcXHome, "agents", "general", "config.yaml"))).toBe(true);
  });

  it("backs up an unreadable primary default config before reseeding", async () => {
    const generalDir = path.join(openZetcXHome, "agents", "general");
    fs.mkdirSync(generalDir, { recursive: true });
    fs.writeFileSync(path.join(generalDir, "config.yaml"), "agent: [unclosed\n", "utf-8");
    const { ensureFirstRun } = await import("../core/first-run.ts");

    const report = ensureFirstRun(openZetcXHome, productDir);

    const cfg = YAML.load(fs.readFileSync(path.join(generalDir, "config.yaml"), "utf-8"));
    expect(cfg.agent.name).toBe("通用助手");
    expect(report.repairedDefaultAgent).toBe(true);
    const backups = fs.readdirSync(generalDir).filter((name) => name.startsWith("config.yaml.broken-"));
    expect(backups).toHaveLength(1);
    expect(fs.readFileSync(path.join(generalDir, backups[0]), "utf-8")).toBe("agent: [unclosed\n");
  });

  it("does not report valid or tombstoned agent directories as invalid", async () => {
    const validDir = path.join(openZetcXHome, "agents", "custom-agent");
    fs.mkdirSync(validDir, { recursive: true });
    fs.writeFileSync(path.join(validDir, "config.yaml"), "agent:\n  name: Custom\n", "utf-8");
    const tombstoneDir = path.join(openZetcXHome, "agents", "deleted-agent");
    fs.mkdirSync(tombstoneDir, { recursive: true });
    fs.writeFileSync(path.join(tombstoneDir, "config.yaml"), "agent:\n  name: Gone\n", "utf-8");
    fs.writeFileSync(path.join(tombstoneDir, ".deleted-agent.json"), JSON.stringify({ version: 1 }), "utf-8");
    const { ensureFirstRun } = await import("../core/first-run.ts");

    const report = ensureFirstRun(openZetcXHome, productDir);

    expect(report.invalidAgentDirs).toEqual([]);
    expect(fs.existsSync(path.join(openZetcXHome, "agents", "general", "config.yaml"))).toBe(true);
  });
});

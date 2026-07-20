import fs from "fs";
import os from "os";
import path from "path";
import YAML from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deepMerge } from "../lib/memory/config-loader.ts";

// ── Mocks ──────────────────────────────────────────────────────
//
// We mock Agent entirely. Real Agent.init() exercises memory/session/desk/bridge
// init which we don't care about here. The mock only implements the minimum
// for createAgent's flow: init (read config.yaml), updateConfig (merge + write),
// and no-op setters.
vi.mock("../core/agent.js", () => ({
  Agent: vi.fn().mockImplementation(function (opts) {
    // 对齐真实 Agent 构造：id 是唯一信源，agentDir 从 agentsDir + id 派生
    this.id = opts.id;
    this.agentsDir = opts.agentsDir;
    this.agentDir = path.join(opts.agentsDir, opts.id);
    this.config = {};
    this.init = async () => {
      const cfgPath = path.join(this.agentDir, "config.yaml");
      if (fs.existsSync(cfgPath)) {
        this.config = YAML.load(fs.readFileSync(cfgPath, "utf-8")) || {};
      }
    };
    this.updateConfig = (partial) => {
      const cfgPath = path.join(this.agentDir, "config.yaml");
      const existing = fs.existsSync(cfgPath)
        ? YAML.load(fs.readFileSync(cfgPath, "utf-8")) || {}
        : {};
      const merged = deepMerge(existing, partial);
      fs.writeFileSync(cfgPath, YAML.dump(merged));
      this.config = merged;
    };
    this.setGetOwnerIds = vi.fn();
    this.setCallbacks = vi.fn();
    this.setOnInstallCallback = vi.fn();
    this.setNotifyHandler = vi.fn();
    this.setDescriptionRefreshHandler = vi.fn();
    this.dispose = vi.fn();
  }),
}));

vi.mock("../lib/debug-log.js", () => ({
  createModuleLogger: () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("../lib/desk/activity-store.js", () => ({
  ActivityStore: vi.fn(),
}));

vi.mock("../lib/memory/config-loader.js", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, clearConfigCache: vi.fn() };
});

vi.mock("../core/llm-utils.js", () => ({
  generateAgentId: vi.fn().mockImplementation(async (_u: any, name: any) => `agent-${name.toLowerCase()}`),
  generateDescription: vi.fn(),
}));

// Import AFTER vi.mock calls so the mocks take effect.
import { AgentManager } from "../core/agent-manager.ts";

// ── Test suite ─────────────────────────────────────────────────
describe("AgentManager.createAgent default skills.enabled", () => {
  let tempDir;
  let agentsDir;
  let productDir;
  let mgr;
  let skillsMock;

  function seedTemplate(enabledLiteral = '["skill-creator"]') {
    fs.mkdirSync(path.join(productDir, "yuan"), { recursive: true });
    fs.writeFileSync(path.join(productDir, "yuan", "openZetcX.md"), "openZetcX yuan\n", "utf-8");
    fs.writeFileSync(
      path.join(productDir, "config.example.yaml"),
      [
        "agent:",
        "  name: openZetcX",
        "  yuan: openZetcX",
        "user:",
        '  name: ""',
        "api:",
        '  provider: ""',
        "models:",
        '  chat: ""',
        "skills:",
        `  enabled: ${enabledLiteral}`,
      ].join("\n"),
    );
  }

  function makeMgr() {
    return new AgentManager({
      agentsDir,
      productDir,
      userDir: tempDir,
      channelsDir: tempDir,
      getPrefs: () => ({
        getPrimaryAgent: () => null,
        getPreferences: () => ({}),
        savePrimaryAgent: vi.fn(),
      }),
      getModels: () => ({
        resolveModelWithCredentials: vi.fn(),
        defaultModel: { id: "test-model", provider: "test-provider" },
        availableModels: [],
      }),
      getHub: () => ({
        scheduler: {
          startAgentCron: vi.fn(),
          startAgentHeartbeat: vi.fn(),
        },
        dmRouter: null,
      }),
      getSkills: () => skillsMock,
      getSearchConfig: () => ({}),
      resolveUtilityConfig: () => ({}),
      getSharedModels: () => ({}),
      getChannelManager: () => ({
        setupChannelsForNewAgent: vi.fn(),
        cleanupAgentFromChannels: vi.fn(),
      }),
      getSessionCoordinator: () => ({}),
    });
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-create-defaults-"));
    agentsDir = path.join(tempDir, "agents");
    productDir = tempDir;
    fs.mkdirSync(agentsDir);
    seedTemplate();

    skillsMock = {
      _allSkills: [],
      computeDefaultEnabledForNewAgent() {
        return this._allSkills
          .filter((s) => s.source !== "external" && s.defaultEnabled !== false)
          .map((s) => s.name);
      },
      syncAgentSkills: vi.fn(),
    };

    mgr = makeMgr();
  });

  afterEach(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  it("writes snapshot of installed user skills to new agent config.yaml", async () => {
    skillsMock._allSkills = [
      { name: "pdf", source: "user" },
      { name: "docx", source: "user" },
      { name: "migrated-one", source: "user", defaultEnabled: false },
      { name: "ext-one", source: "external" },
    ];

    const { id: newId } = await mgr.createAgent({ name: "TestAgent", yuan: "hanako" });

    const cfgPath = path.join(agentsDir, newId, "config.yaml");
    const cfg = YAML.load(fs.readFileSync(cfgPath, "utf-8"));
    expect(cfg.skills.enabled).toEqual(["pdf", "docx"]);
  });

  it("falls back to seeded template default when snapshot is empty", async () => {
    skillsMock._allSkills = [];

    const { id: newId } = await mgr.createAgent({ name: "EmptyAgent", yuan: "hanako" });

    const cfgPath = path.join(agentsDir, newId, "config.yaml");
    const cfg = YAML.load(fs.readFileSync(cfgPath, "utf-8"));
    // The test seeds the template literally with ["skill-creator"], so that's
    // what should remain when our new fill code doesn't execute.
    expect(cfg.skills.enabled).toEqual(["skill-creator"]);
  });

  it("does not touch existing agents' config.yaml (regression for #419)", async () => {
    skillsMock._allSkills = [{ name: "pdf", source: "user" }];

    const { id: firstId } = await mgr.createAgent({ name: "First", yuan: "hanako" });
    const firstCfgPath = path.join(agentsDir, firstId, "config.yaml");
    const mtimeBefore = fs.statSync(firstCfgPath).mtimeMs;

    // Wait 20ms so filesystem mtime resolution can distinguish any write
    await new Promise((r) => setTimeout(r, 20));

    await mgr.createAgent({ name: "Second", yuan: "hanako" });

    const mtimeAfter = fs.statSync(firstCfgPath).mtimeMs;
    expect(mtimeAfter).toBe(mtimeBefore);
  });

  it("persists models.chat as composite ref for newly created agents", async () => {
    skillsMock._allSkills = [];

    const { id: newId } = await mgr.createAgent({ name: "CompositeAgent", yuan: "hanako" });

    const cfgPath = path.join(agentsDir, newId, "config.yaml");
    const cfg = YAML.load(fs.readFileSync(cfgPath, "utf-8"));
    expect(cfg.models.chat).toEqual({ id: "test-model", provider: "test-provider" });
  });

  it("renders identity template placeholders for newly created agents", async () => {
    fs.mkdirSync(path.join(productDir, "identity-templates"), { recursive: true });
    fs.writeFileSync(
      path.join(productDir, "identity-templates", "openZetcX.md"),
      "# {{agentName}}\n\n{{userName}}的个人助手。\n",
      "utf-8",
    );

    const { id: newId } = await mgr.createAgent({ name: "TemplateAgent", yuan: "hanako" });

    const identity = fs.readFileSync(path.join(agentsDir, newId, "identity.md"), "utf-8");
    expect(identity).toContain("# TemplateAgent");
    expect(identity).toContain("用户的个人助手");
    expect(identity).not.toContain("{{agentName}}");
    expect(identity).not.toContain("{{userName}}");
  });

  it("applies openZetcX role presets without changing the Ta template", async () => {
    const { id: newId } = await mgr.createAgent({
      name: "DevAgent",
      yuan: "openZetcX",
      rolePreset: "developer",
    } as any);

    const cfgPath = path.join(agentsDir, newId, "config.yaml");
    const cfg = YAML.load(fs.readFileSync(cfgPath, "utf-8"));
    const identity = fs.readFileSync(path.join(agentsDir, newId, "identity.md"), "utf-8");
    const ishiki = fs.readFileSync(path.join(agentsDir, newId, "ishiki.md"), "utf-8");

    expect(cfg.agent.yuan).toBe("openZetcX");
    expect(cfg.agent.rolePreset).toBe("developer");
    expect(identity).toContain("# DevAgent");
    expect(identity).toContain("openZetcX");
    expect(identity).toContain("程序员助手");
    expect(ishiki).toContain("现有架构");
  });

  it("defaults patrol to disabled with a 31 minute interval for newly created agents", async () => {
    skillsMock._allSkills = [];

    const { id: newId } = await mgr.createAgent({ name: "DeskAgent", yuan: "hanako" });

    const cfgPath = path.join(agentsDir, newId, "config.yaml");
    const cfg = YAML.load(fs.readFileSync(cfgPath, "utf-8"));
    expect(cfg.desk.heartbeat_enabled).toBe(false);
    expect(cfg.desk.heartbeat_interval).toBe(31);
  });

  it("defaults the memory master switch to enabled for newly created agents", async () => {
    skillsMock._allSkills = [];

    const { id: newId } = await mgr.createAgent({ name: "QuietMemoryAgent", yuan: "hanako" });

    const cfgPath = path.join(agentsDir, newId, "config.yaml");
    const cfg = YAML.load(fs.readFileSync(cfgPath, "utf-8"));
    expect(cfg.memory.enabled).toBe(true);
  });

  it("uses an explicit skills.enabled override for imported character-card agents", async () => {
    skillsMock._allSkills = [
      { name: "global-one", source: "user" },
      { name: "global-two", source: "user" },
    ];

    const { id: newId } = await mgr.createAgent({
      name: "ImportedAgent",
      yuan: "ming",
      enabledSkills: ["card-skill"],
      initialFiles: {
        identity: "Imported identity",
        ishiki: "Imported ishiki",
        publicIshiki: "Imported public ishiki",
      },
      initialMemory: {
        compiled: {
          facts: "用户喜欢短句。",
          today: "今天迁移角色卡。",
          week: "本周迁移 Project Hana。",
          longterm: "用户长期关注本地优先迁移。",
        },
        sourceId: "character-card-import-test",
        sourcePackage: "imported-package.zip",
      },
    });

    const cfgPath = path.join(agentsDir, newId, "config.yaml");
    const memoryDir = path.join(agentsDir, newId, "memory");
    const seed = JSON.parse(fs.readFileSync(path.join(memoryDir, "summaries", "character-card-import-test.json"), "utf-8"));
    const cfg = YAML.load(fs.readFileSync(cfgPath, "utf-8"));
    expect(cfg.skills.enabled).toEqual(["card-skill"]);
    expect(fs.readFileSync(path.join(agentsDir, newId, "identity.md"), "utf-8")).toBe("Imported identity");
    expect(fs.readFileSync(path.join(agentsDir, newId, "ishiki.md"), "utf-8")).toBe("Imported ishiki");
    expect(fs.readFileSync(path.join(agentsDir, newId, "public-ishiki.md"), "utf-8")).toBe("Imported public ishiki");
    expect(fs.readFileSync(path.join(memoryDir, "today.md"), "utf-8")).toBe("今天迁移角色卡。");
    expect(fs.readFileSync(path.join(memoryDir, "memory.md"), "utf-8")).toContain("用户长期关注本地优先迁移。");
    expect(seed.imported.packageName).toBe("imported-package.zip");
    expect(seed.snapshot).toBe(seed.summary);
    expect(skillsMock.syncAgentSkills).toHaveBeenCalled();
  });

  it("includes each agent memory master state in the agent list", async () => {
    fs.mkdirSync(path.join(agentsDir, "memory-off"), { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, "memory-off", "config.yaml"),
      [
        "agent:",
        "  name: Memory Off",
        "memory:",
        "  enabled: false",
      ].join("\n"),
    );
    fs.mkdirSync(path.join(agentsDir, "memory-on"), { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, "memory-on", "config.yaml"),
      [
        "agent:",
        "  name: Memory On",
        "memory:",
        "  enabled: true",
      ].join("\n"),
    );

    const agents = mgr.listAgents();

    expect(agents.find(a => a.id === "memory-off").memoryMasterEnabled).toBe(false);
    expect(agents.find(a => a.id === "memory-on").memoryMasterEnabled).toBe(true);
  });

  it("normalizes legacy yuan keys when reading agent metadata", async () => {
    fs.mkdirSync(path.join(agentsDir, "legacy-list"), { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, "legacy-list", "config.yaml"),
      [
        "agent:",
        "  name: Legacy List",
        "  yuan: butter",
      ].join("\n"),
    );
    fs.mkdirSync(path.join(agentsDir, "legacy-deleted"), { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, "legacy-deleted", "config.yaml"),
      [
        "agent:",
        "  name: Legacy Deleted",
        "  yuan: butter",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(agentsDir, "legacy-deleted", ".deleted-agent.json"),
      JSON.stringify({ agentName: "Legacy Deleted", yuan: "butter", deletedAt: "2026-06-29T00:00:00.000Z" }),
    );

    const agents = mgr.listAgents();

    expect(agents.find(a => a.id === "legacy-list").yuan).toBe("openZetcX");
    expect(mgr.getDeletedAgentInfo("legacy-deleted").yuan).toBe("openZetcX");
  });
});

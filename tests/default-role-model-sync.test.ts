import fs from "fs";
import os from "os";
import path from "path";
import YAML from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncOpenZetcXRolePresetChatModels } from "../core/default-role-model-sync.ts";

describe("default role model sync", () => {
  let root: string;
  let agentsDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "openzetcx-role-model-"));
    agentsDir = path.join(root, "agents");
    fs.mkdirSync(agentsDir);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeConfig(agentId: string, config: Record<string, unknown>) {
    const dir = path.join(agentsDir, agentId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "config.yaml"), YAML.dump(config), "utf-8");
  }

  it("copies the primary model to built-in role presets only", () => {
    writeConfig("general", {
      agent: { name: "通用助手", rolePreset: "general" },
      models: { chat: { id: "glm-5", provider: "zhipu" } },
    });
    writeConfig("developer", {
      agent: { name: "程序员", rolePreset: "developer" },
      models: { chat: "" },
    });
    writeConfig("custom", {
      agent: { name: "自定义助手" },
      models: { chat: { id: "custom-model", provider: "custom" } },
    });

    expect(syncOpenZetcXRolePresetChatModels(agentsDir, "general")).toEqual(["developer"]);

    const developer = YAML.load(
      fs.readFileSync(path.join(agentsDir, "developer", "config.yaml"), "utf-8"),
    ) as any;
    const custom = YAML.load(
      fs.readFileSync(path.join(agentsDir, "custom", "config.yaml"), "utf-8"),
    ) as any;
    expect(developer.models.chat).toEqual({ id: "glm-5", provider: "zhipu" });
    expect(custom.models.chat).toEqual({ id: "custom-model", provider: "custom" });
  });
});

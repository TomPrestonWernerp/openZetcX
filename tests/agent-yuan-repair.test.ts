import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Agent } from "../core/agent.ts";

function writeAgentConfig(agentDir, yuan) {
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, "config.yaml"),
    [
      "agent:",
      "  name: Repair Test",
      `  yuan: ${yuan}`,
      "user:",
      "  name: Tester",
      "locale: zh-CN",
    ].join("\n"),
    "utf-8",
  );
}

describe("Agent yuan repair state", () => {
  let tmpDir;
  let agentsDir;
  let productDir;
  let userDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-yuan-repair-"));
    agentsDir = path.join(tmpDir, "agents");
    productDir = path.join(tmpDir, "product");
    userDir = path.join(tmpDir, "user");
    fs.mkdirSync(path.join(productDir, "yuan"), { recursive: true });
    fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(path.join(productDir, "yuan", "openZetcX.md"), "valid yuan\n", "utf-8");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("marks an unknown persisted yuan as repair-needed while preserving the original value", () => {
    writeAgentConfig(path.join(agentsDir, "broken"), "pm-assistant");
    const agent = new Agent({
      id: "broken",
      agentsDir,
      productDir,
      userDir,
    } as any);

    agent.loadConfigOnly();

    expect(agent.config.agent.yuan).toBe("pm-assistant");
    expect(agent.needsRepair).toBe(true);
    expect(agent.repairState).toMatchObject({
      reason: "invalid_yuan",
      field: "agent.yuan",
      value: "pm-assistant",
    });
  });

  it("leaves a valid persisted yuan healthy", () => {
    writeAgentConfig(path.join(agentsDir, "healthy"), "openZetcX");
    const agent = new Agent({
      id: "healthy",
      agentsDir,
      productDir,
      userDir,
    } as any);

    agent.loadConfigOnly();

    expect(agent.needsRepair).toBe(false);
    expect(agent.repairState).toBeNull();
  });

  it("normalizes legacy persisted yuan aliases for runtime use", () => {
    const agentDir = path.join(agentsDir, "legacy");
    writeAgentConfig(agentDir, "butter");
    const agent = new Agent({
      id: "legacy",
      agentsDir,
      productDir,
      userDir,
    } as any);

    agent.loadConfigOnly();

    expect(agent.config.agent.yuan).toBe("openZetcX");
    expect(agent.needsRepair).toBe(false);
    expect(agent.repairState).toBeNull();
    expect(fs.readFileSync(path.join(agentDir, "config.yaml"), "utf-8")).toContain("yuan: openZetcX");
  });

  it("builds runtime prompts for legacy aliases through the openZetcX template", () => {
    writeAgentConfig(path.join(agentsDir, "legacy-runtime"), "butter");
    const agent = new Agent({
      id: "legacy-runtime",
      agentsDir,
      productDir,
      userDir,
    } as any);

    agent.loadConfigOnly();

    expect(() => agent.buildSystemPrompt({ forceMemoryEnabled: false })).not.toThrow();
    expect(agent.buildSystemPrompt({ forceMemoryEnabled: false })).toContain("valid yuan");
  });
});

import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncYuxiAgent, syncYuxiSkill } from "../lib/yuxi/sync.ts";

describe("Yuxi skill synchronization", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openzetc-yuxi-sync-"));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("materializes an accessible Yuxi skill as an atomic local user skill", async () => {
    const files: Record<string, string> = {
      "SKILL.md": "---\nname: remote-name\ndescription: Remote skill\n---\n\n# Remote",
      "references/guide.md": "Use the approved workflow.",
    };
    const client = {
      getSession: () => ({
        baseUrl: "http://127.0.0.1:5050",
        user: { uid: "u-alice" },
      }),
      getSkillTree: vi.fn(async () => ({
        data: [
          { path: "SKILL.md", is_dir: false },
          {
            path: "references",
            is_dir: true,
            children: [{ path: "references/guide.md", is_dir: false }],
          },
        ],
      })),
      getSkillFile: vi.fn(async (_slug: string, relativePath: string) => ({
        data: { path: relativePath, content: files[relativePath] },
      })),
    };
    const userSkillsDir = path.join(tempRoot, "skills");
    const engine = {
      openZetcXHome: tempRoot,
      userSkillsDir,
      reloadSkills: vi.fn(async () => {}),
    };

    const result = await syncYuxiSkill({
      client: client as any,
      engine,
      slug: "research-helper",
    });

    expect(result).toMatchObject({
      name: "research-helper",
      skippedFiles: [],
      source: {
        provider: "yuxi",
        baseUrl: "http://127.0.0.1:5050",
        userUid: "u-alice",
      },
    });
    expect(engine.reloadSkills).toHaveBeenCalledOnce();
    expect(fs.readFileSync(path.join(userSkillsDir, "research-helper", "SKILL.md"), "utf-8")).toContain(
      "name: research-helper",
    );
    expect(fs.readFileSync(path.join(userSkillsDir, "research-helper", "references", "guide.md"), "utf-8")).toBe(
      files["references/guide.md"],
    );
    expect(
      JSON.parse(fs.readFileSync(path.join(userSkillsDir, "research-helper", ".openzetc-yuxi-source.json"), "utf-8")),
    ).toMatchObject({
      provider: "yuxi",
      userUid: "u-alice",
      yuxiSkillSlug: "research-helper",
    });
    expect(fs.existsSync(path.join(tempRoot, ".ephemeral", "yuxi-skill-imports"))).toBe(true);
    expect(fs.readdirSync(path.join(tempRoot, ".ephemeral", "yuxi-skill-imports"))).toEqual([]);
  });

  it("maps a Yuxi agent prompt and source identity to a deterministic local agent", async () => {
    const agentsDir = path.join(tempRoot, "agents");
    const client = {
      getSession: () => ({
        baseUrl: "http://127.0.0.1:5050",
        user: { uid: "u-alice" },
      }),
      getAgent: vi.fn(async () => ({
        agent: {
          slug: "policy-agent",
          name: "Policy Agent",
          backend_id: "ChatbotAgent",
          config_json: {
            context: {
              system_prompt: "# Policy Agent\n\nAnswer from approved policies.",
              skills: [],
            },
          },
        },
      })),
    };
    const createAgent = vi.fn(async ({ id, name, initialFiles }: any) => {
      const agentDir = path.join(agentsDir, id);
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(path.join(agentDir, "identity.md"), initialFiles.identity, "utf-8");
      return { id, name };
    });
    const engine = {
      openZetcXHome: tempRoot,
      agentsDir,
      createAgent,
    };

    const result = await syncYuxiAgent({
      client: client as any,
      engine,
      slug: "policy-agent",
    });

    expect(result).toMatchObject({
      created: true,
      agent: { id: "yuxi-policy-agent", name: "Policy Agent" },
      installedSkills: [],
      skillErrors: [],
    });
    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "yuxi-policy-agent",
        name: "Policy Agent",
        enabledSkills: [],
      }),
    );
    expect(fs.readFileSync(path.join(agentsDir, "yuxi-policy-agent", "identity.md"), "utf-8")).toContain(
      "Answer from approved policies.",
    );
    expect(
      JSON.parse(fs.readFileSync(path.join(agentsDir, "yuxi-policy-agent", ".yuxi-source.json"), "utf-8")),
    ).toMatchObject({
      schemaVersion: 2,
      provider: "yuxi",
      userUid: "u-alice",
      yuxiAgentSlug: "policy-agent",
      yuxiBackendId: "ChatbotAgent",
      managed: {
        name: "Policy Agent",
      },
    });
  });

  it("preserves local agent customizations and conversations when the Web resource is refreshed", async () => {
    const agentsDir = path.join(tempRoot, "agents");
    let remoteRevision = 1;
    const client = {
      getSession: () => ({
        baseUrl: "http://127.0.0.1:5050",
        user: { uid: "u-alice" },
      }),
      getAgent: vi.fn(async () => ({
        agent: {
          slug: "policy-agent",
          name: `Policy Agent v${remoteRevision}`,
          backend_id: "ChatbotAgent",
          config_json: {
            context: {
              system_prompt: `# Policy Agent v${remoteRevision}\n\nRemote revision ${remoteRevision}.`,
              skills: [],
            },
          },
        },
      })),
    };
    const createAgent = vi.fn(async ({ id, name, initialFiles }: any) => {
      const agentDir = path.join(agentsDir, id);
      fs.mkdirSync(path.join(agentDir, "sessions"), { recursive: true });
      fs.writeFileSync(
        path.join(agentDir, "config.yaml"),
        `agent:\n  name: ${name}\nskills:\n  enabled: []\n`,
        "utf-8",
      );
      fs.writeFileSync(path.join(agentDir, "identity.md"), initialFiles.identity, "utf-8");
      return { id, name };
    });
    const updateConfig = vi.fn(async () => {});
    const engine = {
      openZetcXHome: tempRoot,
      agentsDir,
      createAgent,
      updateConfig,
      invalidateAgentListCache: vi.fn(),
    };

    await syncYuxiAgent({
      client: client as any,
      engine,
      slug: "policy-agent",
    });
    const agentDir = path.join(agentsDir, "yuxi-policy-agent");
    remoteRevision = 2;
    const managedRefresh = await syncYuxiAgent({ client: client as any, engine, slug: "policy-agent" });
    expect(managedRefresh.preservedCustomizations).toEqual({ identity: false, name: false });
    expect(fs.readFileSync(path.join(agentDir, "identity.md"), "utf-8")).toContain("Remote revision 2.");

    fs.writeFileSync(path.join(agentDir, "identity.md"), "# 我的个性身份\n", "utf-8");
    fs.writeFileSync(
      path.join(agentDir, "config.yaml"),
      "agent:\n  name: 我的政策助手\nskills:\n  enabled:\n    - local-skill\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(agentDir, "sessions", "private-conversation.jsonl"),
      '{"type":"message","content":"不可覆盖的本地对话"}\n',
      "utf-8",
    );

    remoteRevision = 3;
    const result = await syncYuxiAgent({
      client: client as any,
      engine,
      slug: "policy-agent",
    });

    expect(result.created).toBe(false);
    expect(result.preservedCustomizations).toEqual({
      identity: true,
      name: true,
    });
    expect(fs.readFileSync(path.join(agentDir, "identity.md"), "utf-8")).toBe("# 我的个性身份\n");
    expect(fs.readFileSync(path.join(agentDir, "sessions", "private-conversation.jsonl"), "utf-8")).toContain(
      "不可覆盖的本地对话",
    );
    expect(updateConfig).toHaveBeenCalledWith(
      { skills: { enabled: ["local-skill"] } },
      { agentId: "yuxi-policy-agent", refreshDescription: false },
    );
  });
});

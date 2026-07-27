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
    expect(fs.readFileSync(path.join(userSkillsDir, "research-helper", "SKILL.md"), "utf-8"))
      .toContain("name: research-helper");
    expect(fs.readFileSync(path.join(userSkillsDir, "research-helper", "references", "guide.md"), "utf-8"))
      .toBe(files["references/guide.md"]);
    expect(JSON.parse(fs.readFileSync(
      path.join(userSkillsDir, "research-helper", ".openzetc-yuxi-source.json"),
      "utf-8",
    ))).toMatchObject({
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
    expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({
      id: "yuxi-policy-agent",
      name: "Policy Agent",
      enabledSkills: [],
    }));
    expect(fs.readFileSync(path.join(agentsDir, "yuxi-policy-agent", "identity.md"), "utf-8"))
      .toContain("Answer from approved policies.");
    expect(JSON.parse(fs.readFileSync(
      path.join(agentsDir, "yuxi-policy-agent", ".yuxi-source.json"),
      "utf-8",
    ))).toMatchObject({
      provider: "yuxi",
      userUid: "u-alice",
      yuxiAgentSlug: "policy-agent",
      yuxiBackendId: "ChatbotAgent",
    });
  });
});

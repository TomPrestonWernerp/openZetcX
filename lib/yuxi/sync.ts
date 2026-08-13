import crypto from "crypto";
import fs from "fs";
import path from "path";
import YAML from "js-yaml";
import { atomicWriteSync } from "../../shared/safe-fs.ts";
import { installSkillPackageFromDirectory, rewriteSkillInstallMetadata } from "../skills/skill-package-installer.ts";
import { YuxiClient, YuxiClientError } from "./client.ts";

const MAX_SKILL_FILES = 500;
const MAX_SKILL_TEXT_BYTES = 5 * 1024 * 1024;
const AGENT_SOURCE_FILE = ".yuxi-source.json";
const SKILL_SOURCE_FILE = ".openzetc-yuxi-source.json";

type SkillTreeNode = {
  name?: string;
  path?: string;
  is_dir?: boolean;
  children?: SkillTreeNode[];
};

function safeSlug(value: unknown, label: string): string {
  const slug = String(value || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(slug)) {
    throw new YuxiClientError(`${label} 标识无效`, {
      status: 400,
      code: "YUXI_SLUG_INVALID",
    });
  }
  return slug;
}

function safeRelativePath(value: unknown): string {
  const normalized = String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new YuxiClientError("线上 Skill 包含非法路径", {
      status: 400,
      code: "YUXI_SKILL_PATH_INVALID",
    });
  }
  return normalized;
}

function flattenFiles(nodes: SkillTreeNode[], result: string[] = []): string[] {
  for (const node of nodes || []) {
    if (node?.is_dir) {
      flattenFiles(Array.isArray(node.children) ? node.children : [], result);
    } else {
      result.push(safeRelativePath(node?.path));
      if (result.length > MAX_SKILL_FILES) {
        throw new YuxiClientError(`线上 Skill 文件数超过 ${MAX_SKILL_FILES}`, {
          status: 400,
          code: "YUXI_SKILL_TOO_MANY_FILES",
        });
      }
    }
  }
  return result;
}

function sourceIdentity(client: YuxiClient) {
  const session = client.getSession();
  return {
    provider: "yuxi",
    baseUrl: session.baseUrl,
    userUid: session.user?.uid || null,
  };
}

async function materializeSkill(client: YuxiClient, openZetcXHome: string, slug: string) {
  const treeResponse = await client.getSkillTree(slug);
  const files = flattenFiles(treeResponse?.data || []);
  if (!files.includes("SKILL.md")) {
    throw new YuxiClientError("线上 Skill 缺少 SKILL.md", {
      status: 400,
      code: "YUXI_SKILL_MD_MISSING",
    });
  }

  const stagingRoot = path.join(openZetcXHome, ".ephemeral", "yuxi-skill-imports");
  const stagingDir = path.join(stagingRoot, `${slug}-${crypto.randomUUID()}`);
  const skillDir = path.join(stagingDir, slug);
  fs.mkdirSync(skillDir, { recursive: true });

  const skippedFiles: string[] = [];
  let totalBytes = 0;
  try {
    for (const relativePath of files) {
      let response;
      try {
        response = await client.getSkillFile(slug, relativePath);
      } catch (error) {
        if (relativePath !== "SKILL.md" && error instanceof YuxiClientError && error.status === 400) {
          skippedFiles.push(relativePath);
          continue;
        }
        throw error;
      }
      let content = response?.data?.content;
      if (typeof content !== "string") {
        throw new YuxiClientError(`线上 Skill 文件内容无效：${relativePath}`, {
          status: 502,
          code: "YUXI_SKILL_FILE_INVALID",
        });
      }
      if (relativePath === "SKILL.md") {
        content = rewriteSkillInstallMetadata(content, slug);
      }
      totalBytes += Buffer.byteLength(content, "utf-8");
      if (totalBytes > MAX_SKILL_TEXT_BYTES) {
        throw new YuxiClientError("线上 Skill 文本内容超过 5MB", {
          status: 400,
          code: "YUXI_SKILL_TOO_LARGE",
        });
      }
      const target = path.join(skillDir, ...relativePath.split("/"));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, "utf-8");
    }

    fs.writeFileSync(
      path.join(skillDir, SKILL_SOURCE_FILE),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          ...sourceIdentity(client),
          yuxiSkillSlug: slug,
          syncedAt: new Date().toISOString(),
          skippedFiles,
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
    return { stagingDir, skillDir, skippedFiles };
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

export async function syncYuxiSkill({
  client,
  engine,
  slug: rawSlug,
  agentId,
}: {
  client: YuxiClient;
  engine: any;
  slug: string;
  agentId?: string | null;
}) {
  const slug = safeSlug(rawSlug, "Skill");
  const materialized = await materializeSkill(client, engine.openZetcXHome, slug);
  try {
    const installed = installSkillPackageFromDirectory({
      sourceDir: materialized.skillDir,
      installDir: engine.userSkillsDir,
      owner: "user",
    });
    await engine.reloadSkills();
    if (agentId) {
      const agent = engine.getAgent(agentId);
      if (!agent) {
        throw new YuxiClientError("目标 Agent 不存在", {
          status: 404,
          code: "YUXI_LOCAL_AGENT_NOT_FOUND",
        });
      }
      const enabled = new Set(agent.config?.skills?.enabled || []);
      enabled.add(installed.name);
      await engine.updateConfig({ skills: { enabled: [...enabled] } }, { agentId });
    }
    return {
      name: installed.name,
      dir: installed.dir,
      skippedFiles: materialized.skippedFiles,
      source: sourceIdentity(client),
    };
  } finally {
    fs.rmSync(materialized.stagingDir, { recursive: true, force: true });
  }
}

function localAgentIdForSlug(slug: string): string {
  return `yuxi-${slug}`.slice(0, 120);
}

function agentIdentity(agent: any): string {
  const context = agent?.config_json?.context || {};
  const systemPrompt = typeof context.system_prompt === "string" ? context.system_prompt.trim() : "";
  const description = typeof agent?.description === "string" ? agent.description.trim() : "";
  if (systemPrompt) return systemPrompt;
  if (description) return `# ${agent.name || agent.slug}\n\n${description}\n`;
  return `# ${agent?.name || agent?.slug || "Online Agent"}\n`;
}

function readAgentSource(sourcePath: string) {
  try {
    return JSON.parse(fs.readFileSync(sourcePath, "utf-8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw error;
  }
}

function sha256Text(value: string): string {
  return crypto.createHash("sha256").update(value, "utf-8").digest("hex");
}

function readWholeText(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw error;
  }
}

export async function syncYuxiAgent({
  client,
  engine,
  slug: rawSlug,
}: {
  client: YuxiClient;
  engine: any;
  slug: string;
}) {
  const slug = safeSlug(rawSlug, "Agent");
  const response = await client.getAgent(slug);
  const remoteAgent = response?.agent;
  if (!remoteAgent) {
    throw new YuxiClientError("线上 Agent 不存在", {
      status: 404,
      code: "YUXI_AGENT_NOT_FOUND",
    });
  }

  const localAgentId = localAgentIdForSlug(slug);
  const localAgentDir = path.join(engine.agentsDir, localAgentId);
  const sourcePath = path.join(localAgentDir, AGENT_SOURCE_FILE);
  if (fs.existsSync(localAgentDir)) {
    const existingSource = readAgentSource(sourcePath);
    if (existingSource?.provider !== "yuxi" || existingSource?.yuxiAgentSlug !== slug) {
      throw new YuxiClientError(`本地 Agent 标识冲突：${localAgentId}`, {
        status: 409,
        code: "YUXI_AGENT_ID_CONFLICT",
      });
    }
  }

  const requestedSkills = Array.isArray(remoteAgent?.config_json?.context?.skills)
    ? remoteAgent.config_json.context.skills.filter((item: unknown) => typeof item === "string")
    : [];
  const installedSkills: string[] = [];
  const skillErrors: Array<{ slug: string; error: string }> = [];
  for (const requestedSkill of requestedSkills) {
    try {
      const result = await syncYuxiSkill({
        client,
        engine,
        slug: requestedSkill,
      });
      installedSkills.push(result.name);
    } catch (error) {
      skillErrors.push({
        slug: requestedSkill,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const name = String(remoteAgent.name || slug).trim() || slug;
  const identity = agentIdentity(remoteAgent);
  let created = false;
  let identityUpdated = false;
  let nameUpdated = false;
  let preservedCustomIdentity = false;
  let preservedCustomName = false;
  if (fs.existsSync(localAgentDir)) {
    const existingSource = readAgentSource(sourcePath);
    const managed = existingSource?.managed && typeof existingSource.managed === "object" ? existingSource.managed : {};
    const identityPath = path.join(localAgentDir, "identity.md");
    const currentIdentity = readWholeText(identityPath);
    const identityStillManaged =
      currentIdentity === null ||
      (typeof managed.identitySha256 === "string" && sha256Text(currentIdentity) === managed.identitySha256);
    if (identityStillManaged) {
      fs.writeFileSync(identityPath, identity, "utf-8");
      identityUpdated = true;
    } else {
      preservedCustomIdentity = true;
    }

    const configPath = path.join(localAgentDir, "config.yaml");
    const currentConfig = (YAML.load(fs.readFileSync(configPath, "utf-8")) || {}) as any;
    const currentName = typeof currentConfig?.agent?.name === "string" ? currentConfig.agent.name : "";
    const nameStillManaged = !currentName || (typeof managed.name === "string" && currentName === managed.name);
    nameUpdated = nameStillManaged;
    preservedCustomName = !nameStillManaged;

    // 线上 Agent 刷新只能补充依赖 Skill，不能移除用户后来启用的 Skill。
    const currentSkills = Array.isArray(currentConfig?.skills?.enabled)
      ? currentConfig.skills.enabled.filter((item: unknown) => typeof item === "string")
      : [];
    const enabledSkills = [...new Set([...currentSkills, ...installedSkills])];
    await engine.updateConfig(
      {
        ...(nameStillManaged ? { agent: { name } } : {}),
        skills: { enabled: enabledSkills },
      },
      {
        agentId: localAgentId,
        refreshDescription: identityUpdated || nameUpdated,
      },
    );
    engine.invalidateAgentListCache?.();
  } else {
    await engine.createAgent({
      name,
      id: localAgentId,
      yuan: "openZetcX",
      enabledSkills: installedSkills,
      initialFiles: { identity },
    });
    created = true;
    identityUpdated = true;
    nameUpdated = true;
  }

  const source = {
    schemaVersion: 2,
    ...sourceIdentity(client),
    yuxiAgentSlug: slug,
    yuxiBackendId: remoteAgent.backend_id || null,
    skillSlugs: requestedSkills,
    managed: {
      identitySha256: sha256Text(identity),
      name,
    },
    syncedAt: new Date().toISOString(),
  };
  atomicWriteSync(sourcePath, `${JSON.stringify(source, null, 2)}\n`, {
    mode: 0o600,
  });

  return {
    created,
    agent: {
      id: localAgentId,
      name,
      source,
    },
    installedSkills,
    skillErrors,
    preservedCustomizations: {
      identity: preservedCustomIdentity,
      name: preservedCustomName,
    },
  };
}

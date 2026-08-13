/**
 * first-run.js — 首次运行播种
 *
 * 在 server/engine 启动之前调用，确保 ~/.openZetcX/ 结构存在。
 * 如果是全新安装（agents/ 为空），自动创建默认 agent。
 */

import fs from "fs";
import path from "path";
import YAML from "js-yaml";
import { safeCopyDir } from "../shared/safe-fs.ts";
import { AppError } from "../shared/errors.ts";
import { errorBus } from "../shared/error-bus.ts";
import { DEFAULT_HEARTBEAT_INTERVAL_MINUTES, ensureDefaultWorkspace } from "../shared/default-workspace.ts";
import { OPENZETCX_DEFAULT_ROLE_PRESETS, OPENZETCX_PRIMARY_DEFAULT_ROLE_ID } from "../shared/openzetcx-role-presets.ts";
import { createModuleLogger } from "../lib/debug-log.ts";
import { USER_PROFILE_FILENAME } from "../lib/user-profile-store.ts";

const log = createModuleLogger("first-run");

const DEFAULT_AGENT_ID = OPENZETCX_PRIMARY_DEFAULT_ROLE_ID;
const DEFAULT_YUAN_ID = "openZetcX";

export interface InvalidAgentDirReport {
  id: string;
  reason: "config_missing" | "config_unreadable";
}

export interface FirstRunReport {
  /** 缺失/损坏 config.yaml 而被跳过的非默认 agent 目录（用户数据原样保留） */
  invalidAgentDirs: InvalidAgentDirReport[];
  /** 本次是否播种/修复了默认 agent */
  repairedDefaultAgent: boolean;
  /** 默认 agent config 损坏时的备份文件路径 */
  defaultConfigBackupPath: string | null;
}

/**
 * 确保 ~/.openZetcX/ 数据目录就绪
 *
 * 对 agent 目录采用"分类处置"而不是 fail-fast：
 * - 默认 agent（general/openZetc）缺 config → 播种修复；config 损坏 → 先备份再播种
 * - 非默认目录缺/坏 config → 跳过并记入诊断报告，不阻断启动、不动用户数据
 * 历史上脏目录有多个来源（旧版物理删除残留、phone projection 复活、半截创建），
 * 启动链路必须容忍它们，运行时扫描（AgentManager）本来就会跳过这类目录。
 *
 * @param {string} openZetcXHome - ~/.openZetcX 绝对路径
 * @param {string} productDir - 产品模板目录（lib/）
 */
export function ensureFirstRun(openZetcXHome, productDir): FirstRunReport {
  // 1. 确保目录结构存在
  fs.mkdirSync(path.join(openZetcXHome, "agents"), { recursive: true });
  fs.mkdirSync(path.join(openZetcXHome, "user"), { recursive: true });

  // 2. 分类每个 agent 目录；没有任何可用 agent → 播种默认 agent
  const agentsDir = path.join(openZetcXHome, "agents");
  const agentEntries = fs
    .readdirSync(agentsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."));

  const invalidAgentDirs: InvalidAgentDirReport[] = [];
  const validAgentIds = new Set<string>();
  const defaultRoleIds = new Set(OPENZETCX_DEFAULT_ROLE_PRESETS.map((role) => role.id));
  let defaultAgentState: "valid" | "config_missing" | "config_unreadable" | null = null;
  for (const entry of agentEntries) {
    const cls = classifyAgentDirectoryForStartup(agentsDir, entry.name);
    if (entry.name === DEFAULT_AGENT_ID) {
      defaultAgentState = cls.status === "valid" ? "valid" : cls.reason;
      if (cls.status === "valid") validAgentIds.add(entry.name);
      continue;
    }
    if (cls.status === "valid") {
      validAgentIds.add(entry.name);
      continue;
    }
    if (defaultRoleIds.has(entry.name)) {
      continue;
    }
    invalidAgentDirs.push({ id: entry.name, reason: cls.reason });
    log.warn(
      `invalid agent directory "${entry.name}": ` +
        (cls.reason === "config_missing" ? "config.yaml missing" : `config.yaml is not readable: ${cls.detail}`) +
        "（已跳过，不阻断启动；目录内容保留，请手动确认后清理）",
    );
  }

  const hasAgent = validAgentIds.size > 0;
  const missingDefaultRoles = OPENZETCX_DEFAULT_ROLE_PRESETS.filter((role) => !validAgentIds.has(role.id));
  const needsDefaultAgentRepair = defaultAgentState === "config_missing" || defaultAgentState === "config_unreadable";

  let repairedDefaultAgent = false;
  let defaultConfigBackupPath: string | null = null;
  if (!hasAgent || needsDefaultAgentRepair) {
    if (defaultAgentState === "config_unreadable") {
      defaultConfigBackupPath = backupUnreadableDefaultConfig(agentsDir);
      log.warn(`默认助手 config.yaml 无法解析，已备份到 ${defaultConfigBackupPath}`);
    }
    log.log(needsDefaultAgentRepair ? "默认角色数据不完整，正在补齐..." : "首次启动，正在创建默认角色...");
    const rolesToSeed = hasAgent ? missingDefaultRoles : OPENZETCX_DEFAULT_ROLE_PRESETS;
    const seededAgentIds = seedDefaultAgents(agentsDir, productDir, rolesToSeed);
    repairedDefaultAgent = true;
    for (const agentId of seededAgentIds) validAgentIds.add(agentId);
  } else if (missingDefaultRoles.length > 0) {
    log.log("检测到缺少系统默认角色，正在补齐...");
    const seededAgentIds = seedDefaultAgents(agentsDir, productDir, missingDefaultRoles);
    repairedDefaultAgent = true;
    for (const agentId of seededAgentIds) validAgentIds.add(agentId);
  }
  syncDefaultRoleMetadata(agentsDir, productDir, validAgentIds);

  // 3. 同步 skills：从 skills2set/ 复制到 ~/.openZetcX/skills/
  const skillsSrc = path.join(productDir, "..", "skills2set");
  const skillsDst = path.join(openZetcXHome, "skills");
  fs.mkdirSync(skillsDst, { recursive: true });
  if (fs.existsSync(skillsSrc)) {
    syncSkills(skillsSrc, skillsDst);
  }

  // 4. 确保可选文件存在（老用户升级 + 新 agent 都覆盖）。
  // 只补有效 agent 目录：往无效目录里写 pinned.md 会把垃圾目录越喂越像 agent 目录。
  const touchIfMissing = (p) => {
    if (!fs.existsSync(p)) fs.writeFileSync(p, "", "utf-8");
  };
  touchIfMissing(path.join(openZetcXHome, "user", USER_PROFILE_FILENAME));
  for (const agentId of validAgentIds) {
    touchIfMissing(path.join(agentsDir, agentId, "pinned.md"));
  }

  // 5. 确保 user/preferences.json 存在
  const prefsPath = path.join(openZetcXHome, "user", "preferences.json");
  if (!fs.existsSync(prefsPath)) {
    fs.writeFileSync(
      prefsPath,
      JSON.stringify(
        {
          primaryAgent: DEFAULT_AGENT_ID,
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    );
  }
  return { invalidAgentDirs, repairedDefaultAgent, defaultConfigBackupPath };
}

type AgentDirClassification =
  | { status: "valid" }
  | {
      status: "invalid";
      reason: "config_missing" | "config_unreadable";
      detail?: string;
    };

function classifyAgentDirectoryForStartup(agentsDir, agentId): AgentDirClassification {
  const cfgPath = path.join(agentsDir, agentId, "config.yaml");
  if (!fs.existsSync(cfgPath)) {
    return { status: "invalid", reason: "config_missing" };
  }
  try {
    void YAML.load(fs.readFileSync(cfgPath, "utf-8"));
    return { status: "valid" };
  } catch (err) {
    return {
      status: "invalid",
      reason: "config_unreadable",
      detail: err?.message || String(err),
    };
  }
}

/** 默认 agent 的 config 解析失败时，把原文件改名备份，让播种写出干净的新 config */
function backupUnreadableDefaultConfig(agentsDir): string {
  const cfgPath = path.join(agentsDir, DEFAULT_AGENT_ID, "config.yaml");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${cfgPath}.broken-${stamp}`;
  fs.renameSync(cfgPath, backupPath);
  return backupPath;
}

function seedDefaultAgents(agentsDir, productDir, rolePresets = OPENZETCX_DEFAULT_ROLE_PRESETS): string[] {
  const seededAgentIds: string[] = [];
  for (const rolePreset of rolePresets) {
    seedDefaultAgent(agentsDir, productDir, rolePreset);
    seededAgentIds.push(rolePreset.id);
  }
  return seededAgentIds;
}

/**
 * 从当前内置基础预设播种默认 agent（与 engine.createAgent 相同逻辑，但纯同步、无依赖）。
 * 0.6.1 的职业角色不再进入此列表；升级时其目录和会话会被当作普通用户 Agent 原样保留。
 */
function seedDefaultAgent(agentsDir, productDir, rolePreset) {
  const agentId = rolePreset.id;
  const agentDir = path.join(agentsDir, agentId);

  // 创建目录结构
  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(path.join(agentDir, "memory"), { recursive: true });
  fs.mkdirSync(path.join(agentDir, "sessions"), { recursive: true });
  fs.mkdirSync(path.join(agentDir, "avatars"), { recursive: true });
  fs.mkdirSync(path.join(agentDir, "desk"), { recursive: true });

  // config.yaml（保持模板默认值：name=Hanako, yuan=hanako）
  const cfgDest = path.join(agentDir, "config.yaml");
  const configSrc = path.join(productDir, "config.example.yaml");
  if (!fs.existsSync(configSrc)) {
    throw new Error(`first-run template missing: ${configSrc}`);
  }
  fs.copyFileSync(configSrc, cfgDest);
  // 写入默认工作台（per-agent，不存全局）
  const raw = fs.existsSync(cfgDest) ? YAML.load(fs.readFileSync(cfgDest, "utf-8")) || {} : {};
  raw.agent = {
    ...(raw.agent || {}),
    name: rolePreset.name,
    yuan: DEFAULT_YUAN_ID,
    rolePreset: rolePreset.id,
  };
  raw.desk = {
    ...(raw.desk || {}),
    home_folder: ensureDefaultWorkspace(),
    heartbeat_enabled: false,
    heartbeat_interval: DEFAULT_HEARTBEAT_INTERVAL_MINUTES,
  };
  raw.memory = {
    ...(raw.memory || {}),
    enabled: true,
  };
  fs.writeFileSync(
    cfgDest,
    YAML.dump(raw, {
      indent: 2,
      lineWidth: -1,
      sortKeys: false,
      quotingType: '"',
    }),
    "utf-8",
  );

  const firstExisting = (paths) => paths.find((p) => fs.existsSync(p));

  fs.writeFileSync(
    path.join(agentDir, "identity.md"),
    renderDefaultRoleTemplate(rolePreset.identity, raw, agentId),
    "utf-8",
  );

  // yuan 由 buildSystemPrompt 实时从 lib/yuan/ 读取，无需复制

  fs.writeFileSync(
    path.join(agentDir, "ishiki.md"),
    renderDefaultRoleTemplate(rolePreset.ishiki, raw, agentId),
    "utf-8",
  );

  // public-ishiki.md（对外意识模板）
  const publicIshikiSrc = firstExisting([path.join(productDir, "public-ishiki-templates", `${DEFAULT_YUAN_ID}.md`)]);
  if (publicIshikiSrc) {
    fs.copyFileSync(publicIshikiSrc, path.join(agentDir, "public-ishiki.md"));
  }
  copyDefaultRoleAvatar(productDir, rolePreset, agentDir);

  log.log(`默认角色 "${rolePreset.name}" (${agentId}) 已创建`);
}

function syncDefaultRoleMetadata(agentsDir, productDir, validAgentIds: Set<string>) {
  for (const rolePreset of OPENZETCX_DEFAULT_ROLE_PRESETS) {
    if (!validAgentIds.has(rolePreset.id)) continue;
    const agentDir = path.join(agentsDir, rolePreset.id);
    const cfgPath = path.join(agentDir, "config.yaml");
    const raw = fs.existsSync(cfgPath) ? YAML.load(fs.readFileSync(cfgPath, "utf-8")) || {} : {};
    const nextAgent = {
      ...(raw.agent || {}),
      name: raw.agent?.name || rolePreset.name,
      yuan: raw.agent?.yuan || DEFAULT_YUAN_ID,
      rolePreset: raw.agent?.rolePreset || rolePreset.id,
    };
    if (JSON.stringify(nextAgent) !== JSON.stringify(raw.agent || {})) {
      raw.agent = nextAgent;
      fs.writeFileSync(
        cfgPath,
        YAML.dump(raw, {
          indent: 2,
          lineWidth: -1,
          sortKeys: false,
          quotingType: '"',
        }),
        "utf-8",
      );
    }
    const identityPath = path.join(agentDir, "identity.md");
    if (!fs.existsSync(identityPath)) {
      fs.writeFileSync(identityPath, renderDefaultRoleTemplate(rolePreset.identity, raw, rolePreset.id), "utf-8");
    }
    const ishikiPath = path.join(agentDir, "ishiki.md");
    if (!fs.existsSync(ishikiPath)) {
      fs.writeFileSync(ishikiPath, renderDefaultRoleTemplate(rolePreset.ishiki, raw, rolePreset.id), "utf-8");
    }
    fs.mkdirSync(path.join(agentDir, "avatars"), { recursive: true });
    const avatarDir = path.join(agentDir, "avatars");
    if (!fs.readdirSync(avatarDir).some((name) => name.startsWith("agent."))) {
      copyDefaultRoleAvatar(productDir, rolePreset, agentDir);
    }
  }
}

function renderDefaultRoleTemplate(content, config, agentId) {
  const agentName = config?.agent?.name || agentId;
  const userName = config?.user?.name || "用户";
  return String(content || "")
    .replace(/\{\{userName\}\}/g, userName)
    .replace(/\{\{agentName\}\}/g, agentName)
    .replace(/\{\{agentId\}\}/g, agentId);
}

function copyDefaultRoleAvatar(productDir, rolePreset, agentDir) {
  const avatarSrc = path.join(productDir, "role-avatars", rolePreset.avatarFile);
  if (!fs.existsSync(avatarSrc)) {
    log.warn(`默认角色头像缺失：${avatarSrc}`);
    return;
  }
  const ext = path.extname(rolePreset.avatarFile).toLowerCase() || ".png";
  const normalizedExt = ext === ".jpeg" ? ".jpg" : ext;
  fs.copyFileSync(avatarSrc, path.join(agentDir, "avatars", `agent${normalizedExt}`));
}

/**
 * 同步 skills2set/ → ~/.openZetcX/skills/
 * 每次启动都跑，确保新增/更新的 skill 能同步到用户目录
 */
function syncSkills(srcDir, dstDir) {
  fs.mkdirSync(dstDir, { recursive: true });

  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

    const skillSrc = path.join(srcDir, entry.name);
    const skillDst = path.join(dstDir, entry.name);

    // 只要源里有 SKILL.md 就同步整个目录
    if (!fs.existsSync(path.join(skillSrc, "SKILL.md"))) continue;

    try {
      safeCopyDir(skillSrc, skillDst);
    } catch (err) {
      errorBus.report(
        new AppError("SKILL_SYNC_FAILED", {
          cause: err instanceof Error ? err : new Error(String(err)),
          context: { skill: entry.name },
        }),
      );
      // Continue with other skills, don't abort
    }
  }
}

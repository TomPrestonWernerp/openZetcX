import fs from "fs";
import path from "path";
import YAML from "js-yaml";
import { getOpenZetcXRolePreset } from "../shared/openzetcx-role-presets.ts";

export interface ChatModelRef {
  id: string;
  provider: string;
}

function normalizeChatModelRef(value: unknown): ChatModelRef | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const ref = value as { id?: unknown; provider?: unknown };
  const id = typeof ref.id === "string" ? ref.id.trim() : "";
  const provider = typeof ref.provider === "string" ? ref.provider.trim() : "";
  return id && provider ? { id, provider } : null;
}

function readAgentConfig(agentsDir: string, agentId: string): Record<string, any> | null {
  const configPath = path.join(agentsDir, agentId, "config.yaml");
  if (!fs.existsSync(configPath)) return null;
  try {
    const parsed = YAML.load(fs.readFileSync(configPath, "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, any>
      : null;
  } catch {
    return null;
  }
}

/**
 * Keep every built-in role preset on the primary assistant's configured chat
 * model. The preset screens therefore expose one system default instead of
 * asking users to configure the same model repeatedly.
 */
export function syncOpenZetcXRolePresetChatModels(
  agentsDir: string,
  sourceAgentId: string,
  sourceModel?: unknown,
): string[] {
  const sourceConfig = readAgentConfig(agentsDir, sourceAgentId);
  const modelRef = normalizeChatModelRef(
    sourceModel === undefined ? sourceConfig?.models?.chat : sourceModel,
  );
  if (!modelRef || !fs.existsSync(agentsDir)) return [];

  const updatedAgentIds: string[] = [];
  for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === sourceAgentId || entry.name.startsWith(".")) continue;
    const config = readAgentConfig(agentsDir, entry.name);
    if (!config || !getOpenZetcXRolePreset(config.agent?.rolePreset)) continue;

    const current = normalizeChatModelRef(config.models?.chat);
    if (current?.id === modelRef.id && current.provider === modelRef.provider) continue;

    config.models = {
      ...(config.models && typeof config.models === "object" && !Array.isArray(config.models)
        ? config.models
        : {}),
      chat: { ...modelRef },
    };
    fs.writeFileSync(
      path.join(agentsDir, entry.name, "config.yaml"),
      YAML.dump(config, { indent: 2, lineWidth: -1, sortKeys: false, quotingType: '"' }),
      "utf-8",
    );
    updatedAgentIds.push(entry.name);
  }
  return updatedAgentIds;
}


export interface OpenZetcXRolePreset {
  id: string;
  name: string;
  shortDescription: string;
  avatarFile: string;
  identity: string;
  ishiki: string;
}

/**
 * openZetcX only ships one neutral foundation role. Domain-specific agents are
 * installed from openZetcWeb or created by users from this foundation.
 */
// Keep the stable on-disk id so 0.6.1 upgrades do not seed a duplicate role.
export const OPENZETCX_PRIMARY_DEFAULT_ROLE_ID = "general";

export const OPENZETCX_DEFAULT_ROLE_PRESETS: OpenZetcXRolePreset[] = [
  {
    id: "general",
    name: "openZetc",
    shortDescription: "均衡的助手",
    avatarFile: "general.png",
    identity: "# {{agentName}}\n\n{{userName}}正在使用的 openZetc 均衡助手。Ta 会结合目标、上下文和约束，在分析、写作、执行与协作之间取得平衡。",
    ishiki: "# 工作方式\n\n- 先理解目标、边界和期望交付物\n- 能直接完成的任务主动推进，需要补充信息时只询问关键问题\n- 区分事实、推断与建议，输出准确、清晰且可执行\n- 保护用户数据，并确保不同 Agent 的配置和会话彼此独立",
  },
];

export const OPENZETCX_ROLE_PRESET_BY_ID: Record<string, OpenZetcXRolePreset> =
  OPENZETCX_DEFAULT_ROLE_PRESETS.reduce((acc, preset) => {
    acc[preset.id] = preset;
    return acc;
  }, {} as Record<string, OpenZetcXRolePreset>);

export function getOpenZetcXRolePreset(value: unknown): OpenZetcXRolePreset | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return OPENZETCX_ROLE_PRESET_BY_ID[value.trim()] || null;
}

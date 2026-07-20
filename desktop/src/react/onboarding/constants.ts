/**
 * constants.ts — Onboarding wizard constants
 */

import { API_PROVIDER_PRESETS } from '../utils/provider-presets';
import type { ProviderPreset } from '../utils/provider-presets';
import registry, { type ThemeId } from '../../shared/theme-registry';

export type { ProviderPreset } from '../utils/provider-presets';

export const AGENT_ID = 'openZetcX';
export const TOTAL_STEPS = 7;

export const LOCALES = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'ja',    label: '日本語' },
  { value: 'ko',    label: '한국어' },
  { value: 'en',    label: 'English' },
] as const;

export const PROVIDER_PRESETS: ProviderPreset[] = [
  ...API_PROVIDER_PRESETS,
  { value: '_custom',     label: '',                     url: '',  api: 'openai-completions', custom: true },
];

const ONBOARDING_THEME_ORDER = [
  'warm-paper', 'coral', 'midnight', 'auto', 'high-contrast', 'grass-aroma',
  'contemplation', 'absolutely', 'delve', 'deep-think',
] as const;

export const OB_THEMES = ONBOARDING_THEME_ORDER.filter(
  id => id === registry.AUTO_OPTION.id || !registry.HIDDEN_THEME_IDS.includes(id as ThemeId),
);

export function themeKey(id: string): string {
  return id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

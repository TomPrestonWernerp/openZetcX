/**
 * @vitest-environment jsdom
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '../../store';
import { PluginMarketplaceTab } from '../PluginMarketplaceTab';

const mockHanaFetch = vi.fn();
const showToast = vi.fn();

vi.mock('../../api', () => ({
  hanaFetch: (...args: unknown[]) => mockHanaFetch(...args),
}));

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as Response;
}

describe('PluginMarketplaceTab Yuxi Skill marketplace', () => {
  beforeEach(() => {
    mockHanaFetch.mockReset();
    showToast.mockReset();
    useSettingsStore.setState({ showToast } as never);
    window.i18n = {
      locale: 'zh-CN',
      load: vi.fn(async () => {}),
      t: (key: string) => key,
    } as unknown as typeof window.i18n;
    window.t = ((key: string) => key) as typeof window.t;
  });

  afterEach(() => {
    cleanup();
  });

  it('loads account-scoped Yuxi Skills and installs the selected Skill locally', async () => {
    mockHanaFetch
      .mockResolvedValueOnce(jsonResponse({
        authenticated: true,
        user: { username: 'openzetc_admin', department_name: '默认部门' },
        access: { permissions: { 'skill.view': 'global' } },
      }))
      .mockResolvedValueOnce(jsonResponse({
        skills: [
          {
            slug: 'knowledge-base',
            name: 'knowledge-base',
            description: '使用 Yuxi 知识库进行检索。',
            version: '2026.06.24',
            created_by: 'system',
            source_type: 'builtin',
            tool_dependencies: ['query_kb'],
            share_config: { access_level: 'global' },
            is_builtin: true,
          },
          {
            slug: 'deep-research',
            name: 'deep-research',
            description: '深度研究编排。',
            share_config: { access_level: 'department' },
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        skill: { name: 'knowledge-base' },
      }));

    render(<PluginMarketplaceTab />);

    expect(await screen.findAllByText('knowledge-base')).not.toHaveLength(0);
    expect(screen.getByText('2 个 Skill · openzetc_admin')).toBeInTheDocument();
    expect(screen.getByText('Tool · query_kb')).toBeInTheDocument();
    expect(mockHanaFetch).toHaveBeenCalledWith('/api/yuxi/skills');

    fireEvent.click(screen.getByRole('button', { name: '安装 / 同步到本地' }));

    await waitFor(() => {
      expect(mockHanaFetch).toHaveBeenCalledWith(
        '/api/yuxi/skills/knowledge-base/install',
        expect.objectContaining({ method: 'POST', body: '{}' }),
      );
    });
    expect(await screen.findByRole('button', { name: '重新同步到本地' })).toBeInTheDocument();
    expect(showToast).toHaveBeenCalledWith(
      'Skill“knowledge-base”已安装 / 同步到本地',
      'success',
    );
  });

  it('offers Yuxi sign-in instead of calling the broken legacy marketplace', async () => {
    mockHanaFetch.mockResolvedValueOnce(jsonResponse({
      authenticated: false,
      user: null,
    }));

    render(<PluginMarketplaceTab />);

    expect(await screen.findByText('请先完成线上登录')).toBeInTheDocument();
    expect(mockHanaFetch).toHaveBeenCalledWith('/api/yuxi/session?verify=1', { timeout: 8_000 });
    expect(mockHanaFetch).not.toHaveBeenCalledWith('/api/plugins/marketplace');
  });
});

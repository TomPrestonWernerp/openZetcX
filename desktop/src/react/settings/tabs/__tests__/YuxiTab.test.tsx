/**
 * @vitest-environment jsdom
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hanaFetch = vi.fn();

vi.mock('../../api', () => ({
  hanaFetch: (...args: unknown[]) => hanaFetch(...args),
}));

import { YuxiTab } from '../YuxiTab';

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as Response;
}

describe('YuxiTab', () => {
  beforeEach(() => {
    hanaFetch.mockReset();
    window.i18n = {
      locale: 'zh-CN',
      load: vi.fn(async () => {}),
      t: (key: string) => key,
    } as unknown as typeof window.i18n;
  });

  afterEach(() => {
    cleanup();
  });

  it('only renders the unified account for an authenticated session', async () => {
    hanaFetch.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/yuxi/session')) {
        return jsonResponse({
          authenticated: true,
          baseUrl: 'http://127.0.0.1:15050',
          requireLogin: true,
          user: { username: 'openzetc_admin', department_name: '默认部门' },
          access: {
            roles: [{ id: 1, code: 'superadmin', name: '超级管理员' }],
            permissions: {
              'agent.view': 'global',
              'skill.view': 'global',
              'knowledge.view': 'global',
              'mcp.view': 'global',
              'resource_submission.submit': 'global',
            },
          },
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<YuxiTab />);

    expect(await screen.findByRole('heading', { name: '统一账号' })).toBeInTheDocument();
    expect(screen.getByText('openzetc_admin')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '云端资源' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '本地资源投稿' })).not.toBeInTheDocument();
    await waitFor(() => expect(hanaFetch).toHaveBeenCalledTimes(1));
    expect(hanaFetch).toHaveBeenCalledWith('/api/yuxi/session?verify=1', { timeout: 8_000 });
  });

  it('keeps the account sign-in form when the session is unauthenticated', async () => {
    hanaFetch.mockResolvedValue(jsonResponse({
      authenticated: false,
      baseUrl: 'http://127.0.0.1:15050',
      requireLogin: true,
      user: null,
      access: null,
    }));

    render(<YuxiTab />);

    expect(await screen.findByRole('heading', { name: '统一账号' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument();
    expect(screen.getByText('账号 / 用户 ID / 手机号')).toBeInTheDocument();
    expect(screen.queryByText('云端资源')).not.toBeInTheDocument();
    expect(screen.queryByText('本地资源投稿')).not.toBeInTheDocument();
  });
});

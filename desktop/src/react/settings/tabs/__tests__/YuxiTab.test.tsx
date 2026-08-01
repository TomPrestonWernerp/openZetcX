/**
 * @vitest-environment jsdom
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    hanaFetch.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/yuxi/session')) {
        return jsonResponse({
          authenticated: true,
          baseUrl: 'http://127.0.0.1:15050',
          requireLogin: true,
          user: { username: 'openzetc_admin' },
          access: {
            roles: [{ id: 1, code: 'superadmin', name: '超级管理员' }],
            permissions: {
              'agent.view': 'global',
              'skill.view': 'global',
              'knowledge.view': 'global',
              'mcp.view': 'global',
            },
          },
        });
      }
      if (path === '/api/yuxi/agents') return jsonResponse({ agents: [{ slug: 'assistant', name: '助手' }] });
      if (path === '/api/yuxi/skills') return jsonResponse({ skills: [{ slug: 'search', name: '检索' }] });
      if (path === '/api/yuxi/knowledge-bases') {
        return jsonResponse({ knowledgeBases: [{ kb_id: 'kb-standard', name: '国家标准' }] });
      }
      if (path === '/api/yuxi/mcp-servers') throw new Error('Not Found');
      throw new Error(`Unexpected request: ${path}`);
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps successful catalogs visible when one resource endpoint fails', async () => {
    render(<YuxiTab />);

    expect(await screen.findByText('助手')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('部分资源暂时无法加载：MCP（Not Found）');
    expect(screen.getByRole('tab', { name: /Agent 商店/ })).toHaveTextContent('1');
    expect(screen.getByRole('tab', { name: /Skill 商店/ })).toHaveTextContent('1');
    expect(screen.getByRole('tab', { name: /知识库/ })).toHaveTextContent('1');

    fireEvent.click(screen.getByRole('tab', { name: /知识库/ }));
    expect(await screen.findByText('国家标准')).toBeInTheDocument();
    await waitFor(() => expect(hanaFetch).toHaveBeenCalledWith('/api/yuxi/mcp-servers'));
  });
});

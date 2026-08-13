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
    fireEvent.click(screen.getByRole('button', { name: '查看' }));
    expect(screen.getByRole('dialog', { name: '助手' })).toBeInTheDocument();
    expect(screen.getByText('assistant')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('部分资源暂时无法加载：MCP（Not Found）');
    expect(screen.getByRole('tab', { name: /Agent 商店/ })).toHaveTextContent('1');
    expect(screen.getByRole('tab', { name: /Skill 商店/ })).toHaveTextContent('1');
    expect(screen.getByRole('tab', { name: /知识库/ })).toHaveTextContent('1');

    fireEvent.click(screen.getByRole('tab', { name: /知识库/ }));
    expect(await screen.findByText('国家标准')).toBeInTheDocument();
    await waitFor(() => expect(hanaFetch).toHaveBeenCalledWith('/api/yuxi/mcp-servers'));
  });

  it('shows local agent install state and updates it immediately after installation', async () => {
    window.i18n = {
      locale: 'en-US',
      load: vi.fn(async () => {}),
      t: (key: string) => key,
    } as unknown as typeof window.i18n;
    hanaFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/api/yuxi/session')) {
        return jsonResponse({
          authenticated: true,
          baseUrl: 'http://127.0.0.1:15050',
          requireLogin: true,
          user: { username: 'alice' },
          access: {
            roles: [],
            permissions: { 'agent.view': 'global' },
          },
        });
      }
      if (path === '/api/yuxi/agents') {
        return jsonResponse({
          agents: [
            { slug: 'deep-research', name: 'Deep Research', installed: true, local_agent_id: 'yuxi-deep-research' },
            { slug: 'writer', name: 'Writer', installed: false, local_agent_id: null },
          ],
        });
      }
      if (path === '/api/yuxi/agents/writer/install' && init?.method === 'POST') {
        return jsonResponse({
          ok: true,
          created: true,
          agent: { id: 'yuxi-writer', name: 'Writer' },
          installedSkills: [],
          skillErrors: [],
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<YuxiTab />);

    const installedButton = await screen.findByRole('button', { name: 'Installed' });
    expect(installedButton).toBeDisabled();

    const installButton = screen.getByRole('button', { name: 'Install locally' });
    fireEvent.click(installButton);

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Installed' })).toHaveLength(2));
    expect(screen.getAllByRole('button', { name: 'Installed' })[1]).toBeDisabled();
  });

  it('submits a local resource and renders its pending review state', async () => {
    window.i18n = {
      locale: 'en-US',
      load: vi.fn(async () => {}),
      t: (key: string) => key,
    } as unknown as typeof window.i18n;
    hanaFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/api/yuxi/session')) {
        return jsonResponse({
          authenticated: true,
          baseUrl: 'http://127.0.0.1:15050',
          requireLogin: true,
          user: { username: 'alice' },
          access: {
            roles: [{ id: 2, code: 'system.member', name: 'Member' }],
            permissions: { 'resource_submission.submit': 'own' },
          },
        });
      }
      if (path === '/api/yuxi/local-resources') {
        return jsonResponse({
          resources: [{
            type: 'skill',
            sourceId: 'weekly-report',
            slug: 'weekly-report',
            name: 'Weekly Report',
            description: 'Summarizes weekly work.',
          }],
        });
      }
      if (path === '/api/yuxi/resource-submissions') return jsonResponse({ submissions: [] });
      if (path === '/api/yuxi/local-resources/skill/weekly-report/submit' && init?.method === 'POST') {
        return jsonResponse({
          data: {
            submission_id: 'sub-1',
            resource_type: 'skill',
            slug: 'weekly-report',
            name: 'Weekly Report',
            status: 'pending',
            manifest: { source_id: 'weekly-report' },
          },
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<YuxiTab />);

    expect(await screen.findByText('Submit local resources')).toBeInTheDocument();
    const cloudResources = screen.getByRole('heading', { name: 'Cloud resources' }).closest('section');
    const localSubmissions = screen.getByText('Submit local resources').closest('section');
    expect(cloudResources?.className).toContain('cloudResourceSection');
    expect(localSubmissions?.className).toContain('submissionSection');
    expect(screen.getByRole('tablist', { name: 'Cloud resource type' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Agent (0)' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Skill (1)' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'MCP (0)' })).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(screen.getByRole('tab', { name: 'Skill (1)' }));
    expect(screen.getByText('Weekly Report')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(screen.getByRole('dialog', { name: 'Weekly Report' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }));

    expect(await screen.findByText('Pending review')).toBeInTheDocument();
    await waitFor(() => expect(hanaFetch).toHaveBeenCalledWith(
      '/api/yuxi/local-resources/skill/weekly-report/submit',
      { method: 'POST', timeout: 120_000 },
    ));
  });
});

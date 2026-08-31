/**
 * @vitest-environment jsdom
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalServerConnection } from '../../services/server-connection';
import { useSettingsStore } from '../../settings/store';
import { YuxiTab } from '../../settings/tabs/YuxiTab';

const mockHanaFetch = vi.fn();

vi.mock('../../settings/api', () => ({
  hanaFetch: (...args: unknown[]) => mockHanaFetch(...args),
}));

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

const AUTHENTICATED_SESSION = {
  authenticated: true,
  baseUrl: 'http://127.0.0.1:5050',
  requireLogin: true,
  user: {
    username: 'openzetc_admin',
    role: 'superadmin',
    department_name: '默认部门',
  },
  access: {
    roles: [{ id: 1, code: 'system.superadmin', name: '超级管理员' }],
    permissions: { 'role.view': 'global' },
  },
};

const SIGNED_OUT_SESSION = {
  authenticated: false,
  baseUrl: 'http://127.0.0.1:5050',
  requireLogin: true,
  user: null,
  access: null,
};

const LOCAL_CONNECTION = createLocalServerConnection({
  serverPort: 62950,
  serverToken: 'test-token',
});

describe('YuxiTab', () => {
  beforeEach(() => {
    mockHanaFetch.mockReset();
    mockHanaFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/yuxi/logout' && init?.method === 'POST') {
        return jsonResponse(SIGNED_OUT_SESSION);
      }
      if (url === '/api/yuxi/login' && init?.method === 'POST') {
        return jsonResponse({
          ...AUTHENTICATED_SESSION,
          baseUrl: 'https://openzetc.zjshjkj.com',
        });
      }
      return jsonResponse(AUTHENTICATED_SESSION);
    });
    window.i18n = {
      locale: 'zh-CN',
      load: vi.fn(async () => {}),
      t: (key: string) => key,
    } as unknown as typeof window.i18n;
    useSettingsStore.setState({
      serverPort: 62950,
      serverToken: 'test-token',
      serverConnections: LOCAL_CONNECTION ? { [LOCAL_CONNECTION.connectionId]: LOCAL_CONNECTION } : {},
      activeServerConnectionId: LOCAL_CONNECTION?.connectionId ?? null,
      activeServerConnection: LOCAL_CONNECTION,
      ready: true,
    });
  });

  afterEach(() => {
    cleanup();
    useSettingsStore.setState({
      serverPort: null,
      serverToken: null,
      serverConnections: {},
      activeServerConnectionId: null,
      activeServerConnection: null,
      ready: false,
    });
  });

  it('waits for the local service connection before checking the session', async () => {
    useSettingsStore.setState({
      serverPort: null,
      serverToken: null,
      serverConnections: {},
      activeServerConnectionId: null,
      activeServerConnection: null,
      ready: false,
    });

    render(<YuxiTab />);

    expect(screen.getByText('正在检查账号登录状态…')).toBeInTheDocument();
    expect(mockHanaFetch).not.toHaveBeenCalled();

    useSettingsStore.setState({
      serverPort: 62950,
      serverToken: 'test-token',
      serverConnections: LOCAL_CONNECTION ? { [LOCAL_CONNECTION.connectionId]: LOCAL_CONNECTION } : {},
      activeServerConnectionId: LOCAL_CONNECTION?.connectionId ?? null,
      activeServerConnection: LOCAL_CONNECTION,
    });

    expect(await screen.findByText('openzetc_admin')).toBeInTheDocument();
    expect(mockHanaFetch).toHaveBeenCalledWith('/api/yuxi/session?verify=1', { timeout: 8_000 });
  });

  it('shows a friendly message instead of requesting without a connection', () => {
    useSettingsStore.setState({
      serverPort: null,
      serverToken: null,
      serverConnections: {},
      activeServerConnectionId: null,
      activeServerConnection: null,
      ready: true,
    });

    render(<YuxiTab />);

    expect(screen.getByText('本地服务连接未就绪，请稍后重试…')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mockHanaFetch).not.toHaveBeenCalled();
  });

  it('uses the production endpoint when signing in again from the resource center', async () => {
    render(<YuxiTab />);

    expect(await screen.findByText('openzetc_admin')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }));

    expect(await screen.findByRole('button', { name: '登录' })).toBeInTheDocument();
    expect(screen.queryByText('线上服务地址')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('账号 / 用户 ID / 手机号'), {
      target: { value: 'openzetc_admin' },
    });
    fireEvent.change(screen.getByLabelText('密码'), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    await waitFor(() => {
      const loginCall = mockHanaFetch.mock.calls.find(([url]) => url === '/api/yuxi/login');
      expect(loginCall).toBeDefined();
      expect(JSON.parse(loginCall?.[1]?.body as string)).toEqual({
        baseUrl: 'https://openzetc.zjshjkj.com',
        username: 'openzetc_admin',
        password: 'secret',
        requireLogin: true,
      });
    });
  });
});

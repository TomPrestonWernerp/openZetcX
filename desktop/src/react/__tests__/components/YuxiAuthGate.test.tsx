/**
 * @vitest-environment jsdom
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YuxiAuthGate } from '../../components/YuxiAuthGate';

const { mockHanaFetch, storeState } = vi.hoisted(() => ({
  mockHanaFetch: vi.fn(),
  storeState: { connected: true, locale: 'zh-CN' },
}));

vi.mock('../../hooks/use-hana-fetch', () => ({
  hanaFetch: (...args: unknown[]) => mockHanaFetch(...args),
}));

vi.mock('../../stores', () => {
  const useStore = Object.assign(
    (selector: (state: typeof storeState) => unknown) => selector(storeState),
    { getState: () => storeState },
  );
  return { useStore };
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

describe('YuxiAuthGate', () => {
  beforeEach(() => {
    mockHanaFetch.mockReset();
    mockHanaFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/yuxi/login' && init?.method === 'POST') {
        return jsonResponse({
          authenticated: true,
          baseUrl: 'https://openzetc.zjshjkj.com',
          requireLogin: true,
          user: { username: 'openzetc_admin' },
        });
      }
      return jsonResponse({
        authenticated: false,
        baseUrl: 'http://127.0.0.1:5050',
        requireLogin: true,
        user: null,
      });
    });
    window.i18n = {
      locale: 'zh-CN',
      load: vi.fn(async () => {}),
      t: (key: string) => key,
    } as unknown as typeof window.i18n;
  });

  afterEach(() => {
    cleanup();
  });

  it('hides the service URL and always logs in through the production endpoint', async () => {
    render(<YuxiAuthGate><div>已进入应用</div></YuxiAuthGate>);

    expect(await screen.findByText('登录以继续')).toBeInTheDocument();
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

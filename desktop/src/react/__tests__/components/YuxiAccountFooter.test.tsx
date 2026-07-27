/**
 * @vitest-environment jsdom
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YuxiAccountFooter } from '../../components/app/YuxiAccountFooter';

const mockHanaFetch = vi.fn();
const mockOpenSettingsModal = vi.fn();
const mockAutoUpdateCheck = vi.fn();

vi.mock('../../hooks/use-hana-fetch', () => ({
  hanaFetch: (...args: unknown[]) => mockHanaFetch(...args),
}));

vi.mock('../../stores/settings-modal-actions', () => ({
  openSettingsModal: (...args: unknown[]) => mockOpenSettingsModal(...args),
}));

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as Response;
}

describe('YuxiAccountFooter', () => {
  beforeEach(() => {
    mockHanaFetch.mockReset();
    mockOpenSettingsModal.mockReset();
    mockAutoUpdateCheck.mockReset();
    mockHanaFetch.mockResolvedValue(jsonResponse({
      authenticated: true,
      user: {
        username: 'openzetc_admin',
        department_name: '默认部门',
        role: 'superadmin',
      },
    }));
    mockAutoUpdateCheck.mockResolvedValue({
      status: 'latest',
      version: null,
      releaseNotes: null,
      releaseUrl: null,
      downloadUrl: null,
      progress: null,
      error: null,
    });
    window.i18n = {
      locale: 'zh-CN',
      load: vi.fn(async () => {}),
      t: (key: string) => key,
    } as unknown as typeof window.i18n;
    window.hana = {
      autoUpdateCheck: mockAutoUpdateCheck,
    } as unknown as typeof window.hana;
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the verified Yuxi identity and opens its settings page', async () => {
    render(<YuxiAccountFooter />);

    expect(await screen.findByText('openzetc_admin')).toBeInTheDocument();
    expect(screen.getByText('默认部门 · superadmin')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('打开 Yuxi 账号与资源中心'));
    expect(mockOpenSettingsModal).toHaveBeenCalledWith('yuxi');
  });

  it('checks both the Yuxi session and application updates', async () => {
    render(<YuxiAccountFooter />);
    await screen.findByText('openzetc_admin');

    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));

    await waitFor(() => {
      expect(mockAutoUpdateCheck).toHaveBeenCalledTimes(1);
      expect(mockHanaFetch).toHaveBeenCalledWith('/api/yuxi/session?verify=1', { timeout: 8_000 });
    });
    expect(screen.getAllByText('已是最新版本').length).toBeGreaterThan(0);
  });
});

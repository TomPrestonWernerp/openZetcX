/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hanaFetch: vi.fn(),
  showToast: vi.fn(),
  switchToAgent: vi.fn(),
  openSettingsModal: vi.fn(),
}));

vi.mock('../../settings/store', () => ({
  useSettingsStore: (selector: (state: { showToast: typeof mocks.showToast }) => unknown) =>
    selector({ showToast: mocks.showToast }),
}));

vi.mock('../../settings/api', () => ({
  hanaFetch: (...args: unknown[]) => mocks.hanaFetch(...args),
}));

vi.mock('../../settings/actions', () => ({
  switchToAgent: (...args: unknown[]) => mocks.switchToAgent(...args),
}));

vi.mock('../../stores/settings-modal-actions', () => ({
  openSettingsModal: (...args: unknown[]) => mocks.openSettingsModal(...args),
}));

vi.mock('../../settings/helpers', () => ({
  t: (key: string, variables?: { name?: string }) => {
    const labels: Record<string, string> = {
      'settings.agent.createTitle': '新建助手',
      'settings.agent.namePlaceholder': '起个名字',
      'settings.agent.nameRequired': '请输入助手名称',
      'settings.agent.created': `已创建 ${variables?.name || ''}`,
      'settings.agent.createFailed': '创建失败',
      'settings.agent.cancel': '取消',
      'settings.agent.confirm': '创建',
      'settings.agent.creating': '正在创建',
    };
    return labels[key] || key;
  },
}));

vi.mock('../../ui', () => ({
  Overlay: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
}));

describe('AgentCreateOverlay role presets', () => {
  beforeEach(() => {
    mocks.hanaFetch.mockReset();
    mocks.showToast.mockReset();
    mocks.switchToAgent.mockReset();
    mocks.openSettingsModal.mockReset();
    mocks.hanaFetch.mockResolvedValue({
      json: async () => ({ id: 'custom-writer', name: '自定义角色' }),
    });
    mocks.switchToAgent.mockResolvedValue(undefined);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows only the openZetc foundation and creates an isolated agent from it', async () => {
    const { AgentCreateOverlay } = await import('../../settings/overlays/AgentCreateOverlay');
    render(<AgentCreateOverlay />);

    act(() => {
      window.dispatchEvent(new Event('hana-show-agent-create'));
    });

    const presetGrid = screen.getByLabelText('role preset');
    expect(within(presetGrid).getAllByRole('button')).toHaveLength(1);
    expect(presetGrid.querySelectorAll('img')).toHaveLength(1);
    const openZetcCard = screen.getByRole('button', { name: /openZetc：均衡的助手/ });
    expect(openZetcCard).toBePressed();
    expect(openZetcCard).toHaveClass('yuan-chip', 'selected');
    const nameInput = screen.getByPlaceholderText('起个名字');
    expect(nameInput).toHaveValue('');
    expect(screen.getByText('均衡的助手')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '从 Web 获取 Agent' }));
    expect(mocks.openSettingsModal).toHaveBeenCalledWith('yuxi');

    act(() => window.dispatchEvent(new Event('hana-show-agent-create')));

    const reopenedNameInput = screen.getByPlaceholderText('起个名字');
    fireEvent.change(reopenedNameInput, { target: { value: '自定义角色' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    expect(mocks.hanaFetch).toHaveBeenCalledWith('/api/agents', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        name: '自定义角色',
        yuan: 'openZetcX',
        rolePreset: 'general',
      }),
    }));
    await waitFor(() => {
      expect(mocks.switchToAgent).toHaveBeenCalledWith('custom-writer');
    });
  });
});

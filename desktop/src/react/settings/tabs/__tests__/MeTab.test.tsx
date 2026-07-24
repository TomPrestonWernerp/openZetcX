/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const hanaFetch = vi.fn();
const invalidateConfigCache = vi.fn();
const loadSettingsConfig = vi.fn();
const mainStoreSetState = vi.fn();

vi.mock('../../api', () => ({
  hanaFetch: (...args: unknown[]) => hanaFetch(...args),
}));

vi.mock('../../../hooks/use-config', () => ({
  invalidateConfigCache: (...args: unknown[]) => invalidateConfigCache(...args),
}));

vi.mock('../../helpers', () => ({
  t: (key: string) => key,
}));

vi.mock('../../actions', () => ({
  loadSettingsConfig: (...args: unknown[]) => loadSettingsConfig(...args),
}));

vi.mock('../../../stores', () => ({
  useStore: {
    setState: (...args: unknown[]) => mainStoreSetState(...args),
  },
}));

import { MeTab } from '../MeTab';
import { useSettingsStore } from '../../store';

beforeEach(() => {
  hanaFetch.mockResolvedValue({ ok: true, json: vi.fn(async () => ({ ok: true })) });
  loadSettingsConfig.mockResolvedValue(undefined);
  useSettingsStore.setState({
    currentAgentId: 'focus-agent',
    settingsAgentId: 'general',
    userName: 'Old name',
    settingsConfig: {
      user: { name: 'Old name' },
      _userProfile: '',
    },
    homeFolder: 'C:\\Users\\tester',
    toastMessage: '',
    toastType: '',
    toastVisible: false,
  });
});

afterEach(() => {
  cleanup();
  hanaFetch.mockReset();
  invalidateConfigCache.mockReset();
  loadSettingsConfig.mockReset();
  mainStoreSetState.mockReset();
});

describe('MeTab', () => {
  it('saves the name to the selected settings agent and updates the chat store', async () => {
    render(<MeTab />);

    const textboxes = screen.getAllByRole('textbox');
    fireEvent.change(textboxes[0], { target: { value: '  周一好  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'settings.save' }));

    await waitFor(() => {
      expect(hanaFetch).toHaveBeenCalledWith('/api/agents/general/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: { name: '周一好' } }),
      });
      expect(useSettingsStore.getState().userName).toBe('周一好');
    });
    expect(mainStoreSetState).toHaveBeenCalledWith({ userName: '周一好' });
    expect(invalidateConfigCache).toHaveBeenCalled();
    expect(loadSettingsConfig).toHaveBeenCalled();
  });
});

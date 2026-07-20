/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutoUpdateState, PlatformApi } from '../../types';

let mockState: AutoUpdateState | null = null;

vi.mock('../../hooks/use-auto-update-state', () => ({
  useAutoUpdateState: () => mockState,
}));

import { SidebarUpdateAction } from '../../components/notices/SidebarUpdateAction';

function updateState(status: AutoUpdateState['status']): AutoUpdateState {
  return {
    status,
    version: '0.5.1',
    releaseNotes: null,
    releaseUrl: null,
    downloadUrl: null,
    progress: null,
    error: null,
  };
}

describe('SidebarUpdateAction', () => {
  const autoUpdateInstall = vi.fn().mockResolvedValue(true);

  beforeEach(() => {
    mockState = null;
    autoUpdateInstall.mockClear();
    window.t = ((key: string) => ({
      'settings.about.updateInstall': '重启更新',
      'settings.about.updateAction': '更新',
    }[key] || key)) as typeof window.t;
    window.hana = { autoUpdateInstall } as unknown as PlatformApi;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('appears only after the update has downloaded', () => {
    const { container, rerender } = render(<SidebarUpdateAction />);
    expect(container).toBeEmptyDOMElement();

    mockState = updateState('downloading');
    rerender(<SidebarUpdateAction />);
    expect(container).toBeEmptyDOMElement();

    mockState = updateState('downloaded');
    rerender(<SidebarUpdateAction />);
    expect(screen.getByRole('button', { name: '重启更新' })).toBeInTheDocument();
    expect(screen.getByText('更新')).toBeInTheDocument();
  });

  it('installs the downloaded update after user confirmation', () => {
    mockState = updateState('downloaded');
    render(<SidebarUpdateAction />);

    fireEvent.click(screen.getByRole('button', { name: '重启更新' }));

    expect(autoUpdateInstall).toHaveBeenCalledTimes(1);
  });
});

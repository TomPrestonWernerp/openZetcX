// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelInput, ChannelMembers, requestChannelComposerFocus } from '../../components/ChannelsPanel';
import { hanaFetch } from '../../hooks/use-hana-fetch';
import { useStore } from '../../stores';

const deskActionMocks = vi.hoisted(() => ({
  activateWorkspaceDesk: vi.fn(async () => undefined),
  deskUploadFiles: vi.fn(async () => undefined),
  deskUploadBrowserFilesToSubdir: vi.fn(async () => true),
}));

vi.mock('../../hooks/use-hana-fetch', () => ({
  hanaFetch: vi.fn(),
}));

vi.mock('../../stores/desk-actions', () => deskActionMocks);

function seedChannelState() {
  useStore.setState({
    currentChannel: 'ch_crew',
    channels: [{
      id: 'ch_crew',
      name: 'Crew',
      members: ['alice', 'bob', 'carol'],
      lastMessage: '',
      lastSender: '',
      lastTimestamp: '',
      newMessageCount: 0,
      isDM: false,
    }],
    channelMembers: ['alice', 'bob', 'carol'],
    channelIsDM: false,
    agents: [
      { id: 'alice', name: 'Alice', yuan: '', isPrimary: false },
      { id: 'bob', name: 'Bob', yuan: '', isPrimary: false },
      { id: 'carol', name: 'Carol', yuan: '', isPrimary: false },
    ],
    userName: 'User',
    userAvatarUrl: '',
    currentAgentId: 'alice',
    homeFolder: '/home',
    selectedFolder: '/home',
    channelWorkspaceById: {},
    channelWorkspaceRoot: '',
  } as never);
}

describe('ChannelInput focus restoration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deskActionMocks.activateWorkspaceDesk.mockClear();
    deskActionMocks.deskUploadFiles.mockClear();
    deskActionMocks.deskUploadBrowserFilesToSubdir.mockClear();
    window.t = ((key: string) => key) as typeof window.t;
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('alert', vi.fn());
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    seedChannelState();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('focuses the channel composer only for the active channel', async () => {
    render(<ChannelInput />);
    const input = screen.getByPlaceholderText('channel.inputPlaceholder') as HTMLTextAreaElement;

    requestChannelComposerFocus('other_channel');
    expect(document.activeElement).not.toBe(input);

    requestChannelComposerFocus('ch_crew');

    await waitFor(() => {
      expect(input).toHaveFocus();
    });
  });

  it('returns focus to the composer after removing a channel member', async () => {
    vi.mocked(hanaFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, members: ['bob', 'carol'] }),
    } as Response);

    render(
      <>
        <ChannelMembers />
        <ChannelInput />
      </>,
    );

    const input = screen.getByPlaceholderText('channel.inputPlaceholder') as HTMLTextAreaElement;
    const removeButtons = screen.getAllByTitle('channel.removeMember');
    fireEvent.click(removeButtons[0]);

    await waitFor(() => {
      expect(hanaFetch).toHaveBeenCalledWith('/api/channels/ch_crew/members/alice', { method: 'DELETE' });
      expect(input).toHaveFocus();
    });
  });

  it('uploads selected files to the active channel workspace', async () => {
    useStore.setState({
      channelWorkspaceById: {
        ch_crew: { workspaceRoot: '/home/OH-Works/Crew' },
      },
    } as never);
    vi.mocked(hanaFetch).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ ok: true }),
    } as Response);
    (window as any).platform = {
      selectFiles: vi.fn(async () => ['/tmp/report.docx']),
    };

    render(<ChannelInput />);
    fireEvent.click(screen.getByLabelText('input.attach'));

    await waitFor(() => {
      expect(deskActionMocks.activateWorkspaceDesk).toHaveBeenCalledWith('/home/OH-Works/Crew', { mountId: null });
      expect(deskActionMocks.deskUploadFiles).toHaveBeenCalledWith(['/tmp/report.docx']);
    });
  });

  it('falls back to the absolute channel workspace when a saved workspaceRoot is relative', async () => {
    useStore.setState({
      channels: [{
        id: 'ch_crew',
        name: 'Crew',
        members: ['alice', 'bob', 'carol'],
        lastMessage: '',
        lastSender: '',
        lastTimestamp: '',
        newMessageCount: 0,
        isDM: false,
        workspaceRoot: 'Crew',
      }],
    } as never);
    vi.mocked(hanaFetch).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ ok: true }),
    } as Response);
    (window as any).platform = {
      selectFiles: vi.fn(async () => ['/tmp/report.docx']),
    };

    render(<ChannelInput />);
    fireEvent.click(screen.getByLabelText('input.attach'));

    await waitFor(() => {
      expect(deskActionMocks.activateWorkspaceDesk).toHaveBeenCalledWith('/home/OH-Works/Crew', { mountId: null });
      expect(hanaFetch).toHaveBeenCalledWith('/api/channels/ch_crew/workspace', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ workspaceRoot: '/home/OH-Works/Crew' }),
      }));
      expect(deskActionMocks.deskUploadFiles).toHaveBeenCalledWith(['/tmp/report.docx']);
    });
  });
});

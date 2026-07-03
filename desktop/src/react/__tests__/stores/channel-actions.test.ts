/**
 * channel-actions 鍩虹嚎娴嬭瘯
 *
 * 娴嬭瘯绾€昏緫閮ㄥ垎锛堜笉娑夊強缃戠粶璇锋眰鐨勫嚱鏁帮級锛?
 * 浠ュ強 store 鐘舵€佸彉鍖栫殑姝ｇ‘鎬с€?
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock store
const mockState: Record<string, unknown> = {
  serverPort: '3210',
  channels: [],
  currentChannel: null,
  channelMessages: [],
  channelMessageCache: {},
  channelMessageCacheDirty: {},
  channelTotalUnread: 0,
  channelsEnabled: true,
  userName: 'testuser',
  channelMembers: [],
  channelHeaderName: '',
  channelHeaderMembersText: '',
  channelIsDM: false,
  channelInfoName: '',
  channelAgentActivities: {},
  channelAgentPhoneToolMode: 'read_only',
  channelAgentReplyMinChars: null,
  channelAgentReplyMaxChars: null,
  channelAgentProactiveEnabled: true,
  channelAgentReminderIntervalMinutes: 31,
  channelAgentGuardLimit: 36,
  channelAgentModelOverrideEnabled: false,
  channelAgentModelOverrideModel: null,
  channelWorkspaceRoot: null,
  channelWorkspacePermissionMode: 'auto',
  channelWorkspaceById: {},
};

const setStateCalls: Array<Record<string, unknown>> = [];

vi.mock('../../stores', () => ({
  useStore: {
    getState: () => ({ ...mockState }),
    setState: (patch: Record<string, unknown>) => {
      setStateCalls.push(patch);
      Object.assign(mockState, patch);
    },
  },
}));

vi.mock('../../hooks/use-hana-fetch', () => ({
  hanaFetch: vi.fn(),
}));

vi.mock('../../stores/desk-actions', () => ({
  activateWorkspaceDesk: vi.fn(),
}));

import { hanaFetch } from '../../hooks/use-hana-fetch';
import { activateWorkspaceDesk } from '../../stores/desk-actions';

const mockFetch = vi.mocked(hanaFetch);
const mockActivateWorkspaceDesk = vi.mocked(activateWorkspaceDesk);

describe('channel-actions', () => {
  beforeEach(() => {
    setStateCalls.length = 0;
    mockState.channels = [];
    mockState.currentChannel = null;
    mockState.channelMessages = [];
    mockState.channelMessageCache = {};
    mockState.channelMessageCacheDirty = {};
    mockState.channelTotalUnread = 0;
    mockState.channelsEnabled = true;
    mockState.channelAgentPhoneToolMode = 'read_only';
    mockState.channelAgentReplyMinChars = null;
    mockState.channelAgentReplyMaxChars = null;
    mockState.channelAgentProactiveEnabled = true;
    mockState.channelAgentReminderIntervalMinutes = 31;
    mockState.channelAgentGuardLimit = 36;
    mockState.channelAgentModelOverrideEnabled = false;
    mockState.channelAgentModelOverrideModel = null;
    mockState.channelWorkspaceRoot = null;
    mockState.channelWorkspacePermissionMode = 'auto';
    mockState.channelWorkspaceById = {};
    mockState.homeFolder = null;
    mockState.selectedFolder = null;
    mockState.deskWorkspaceMountId = null;
    mockFetch.mockReset();
    mockActivateWorkspaceDesk.mockReset();
  });

  describe('loadChannels', () => {
    it('loads channels and DM list', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ channels: [{ id: 'ch1', name: 'general', newMessageCount: 2 }] }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ ownerAgentId: 'hana', dms: [{ ownerAgentId: 'hana', peerId: 'agent1', peerName: 'Agent 1', messageCount: 5 }] }),
        } as Response);

      const { loadChannels } = await import('../../stores/channel-actions');
      await loadChannels();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      // 妫€鏌?setState 琚皟鐢紝鍖呭惈鍚堝苟鐨?channels
      const lastPatch = setStateCalls[setStateCalls.length - 1];
      expect(lastPatch.channels).toBeDefined();
      const channels = lastPatch.channels as Array<{ id: string; isDM: boolean; dmOwnerId?: string }>;
      expect(channels.length).toBe(2);
      expect(channels[0].isDM).toBe(false);
      expect(channels[1].isDM).toBe(true);
      expect(channels[1].id).toBe('dm:agent1');
      expect(channels[1].dmOwnerId).toBe('hana');
    });

    it('does not request when serverPort is empty', async () => {
      mockState.serverPort = '';
      const { loadChannels } = await import('../../stores/channel-actions');
      await loadChannels();
      expect(mockFetch).not.toHaveBeenCalled();
      mockState.serverPort = '3210';
    });

    it('activates a configured group workspace as the final shared root', async () => {
      vi.stubGlobal('window', { t: (key: string) => key });
      mockState.channelWorkspaceById = {
        ch1: { workspaceRoot: '/clusters/group-one' },
      };
      mockState.channels = [{
        id: 'ch1',
        name: 'Group Test',
        members: ['hana'],
        lastMessage: '',
        lastSender: '',
        lastTimestamp: '',
        newMessageCount: 0,
        isDM: false,
      }];
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            name: 'Group Test',
            members: ['hana'],
            messages: [],
          }),
        } as Response)
        .mockResolvedValue({
          ok: true,
          json: async () => ({ activities: [], mode: 'read_only' }),
        } as Response);

      const { openChannel } = await import('../../stores/channel-actions');
      await openChannel('ch1', false);
      await Promise.resolve();

      expect(mockFetch).toHaveBeenCalledWith('/api/desk/files', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          action: 'mkdir',
          dir: '/clusters',
          subdir: '',
          name: 'group-one',
        }),
      }));
      expect(mockActivateWorkspaceDesk).toHaveBeenCalledWith('/clusters/group-one', { mountId: null });
    });

    it('activates the current group workspace even when channel messages are already cached', async () => {
      mockState.currentChannel = 'ch1';
      mockState.channelIsDM = false;
      mockState.channelInfoName = 'Group Test';
      mockState.selectedFolder = 'D:/workspace';
      mockState.channels = [{
        id: 'ch1',
        name: 'Group Test',
        members: ['open'],
        lastMessage: '',
        lastSender: '',
        lastTimestamp: '',
        newMessageCount: 0,
        isDM: false,
      }];
      mockState.channelMessageCache = {
        ch1: [{ sender: 'open', timestamp: '2026-07-01T12:00:00.000Z', body: 'cached' }],
      };
      mockState.channelMessageCacheDirty = { ch1: false };
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) } as Response);

      const { hydrateCurrentChannelIfNeeded } = await import('../../stores/channel-actions');
      await hydrateCurrentChannelIfNeeded();

      expect(mockState.channelMessages).toEqual([
        { sender: 'open', timestamp: '2026-07-01T12:00:00.000Z', body: 'cached' },
      ]);
      expect(mockActivateWorkspaceDesk).toHaveBeenCalledWith(
        expect.stringMatching(/D:[/\\]workspace[/\\]OH-Works[/\\]Group Test/),
        { mountId: null },
      );
      expect(mockState.channelWorkspaceById).toMatchObject({
        ch1: {
          workspaceRoot: expect.stringMatching(/D:[/\\]workspace[/\\]OH-Works[/\\]Group Test/),
        },
      });
    });
  });

  describe('openChannel', () => {
    it('opens DM history with the stored owner agent id', async () => {
      vi.stubGlobal('window', { t: (key: string) => key });
      mockState.channels = [{
        id: 'dm:agent1',
        name: 'Agent 1',
        members: ['agent1'],
        lastMessage: '',
        lastSender: '',
        lastTimestamp: '',
        newMessageCount: 0,
        isDM: true,
        peerId: 'agent1',
        peerName: 'Agent 1',
        dmOwnerId: 'hana',
      }];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ownerAgentId: 'hana',
          peerId: 'agent1',
          peerName: 'Agent 1',
          messages: [{ sender: 'agent1', timestamp: '2026-05-19 12:00:00', body: 'hello' }],
        }),
      } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ activities: [] }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ mode: 'read_only' }),
        } as Response);

      const { openChannel } = await import('../../stores/channel-actions');
      await openChannel('dm:agent1', true);

      expect(mockFetch).toHaveBeenCalledWith('/api/dm/agent1?agentId=hana');
      expect(mockState.channelMessages).toEqual([
        { sender: 'agent1', timestamp: '2026-05-19 12:00:00', body: 'hello' },
      ]);
    });
  });

  describe('loadConversationAgentActivities', () => {
    it('loads and keys agent phone activities by conversation and agent', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          activities: [{
            conversationId: 'ch1',
            conversationType: 'channel',
            agentId: 'hana',
            state: 'idle',
            summary: 'replied',
            timestamp: '2026-05-12T12:00:00.000Z',
          }],
        }),
      } as Response);

      const { loadConversationAgentActivities } = await import('../../stores/channel-actions');
      await loadConversationAgentActivities('ch1');

      expect(mockFetch).toHaveBeenCalledWith('/api/conversations/ch1/agent-activities');
      expect((mockState.channelAgentActivities as any).ch1.hana[0]).toMatchObject({
        state: 'idle',
        summary: 'replied',
      });
    });
  });

  describe('DM phone settings owner', () => {
    it('loads DM phone settings with the stored owner agent id', async () => {
      mockState.channels = [{
        id: 'dm:agent1',
        name: 'Agent 1',
        members: ['agent1'],
        lastMessage: '',
        lastSender: '',
        lastTimestamp: '',
        newMessageCount: 0,
        isDM: true,
        peerId: 'agent1',
        peerName: 'Agent 1',
        dmOwnerId: 'hana',
      }];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ mode: 'write', replyMinChars: 10, replyMaxChars: 80 }),
      } as Response);

      const { loadConversationAgentPhoneSettings } = await import('../../stores/channel-actions');
      await loadConversationAgentPhoneSettings('dm:agent1');

      expect(mockFetch).toHaveBeenCalledWith('/api/conversations/dm%3Aagent1/agent-phone-settings?agentId=hana');
      expect(mockState.channelAgentPhoneToolMode).toBe('write');
      expect(mockState.channelAgentReplyMinChars).toBe(10);
      expect(mockState.channelAgentReplyMaxChars).toBe(80);
    });

    it('saves DM phone settings with the stored owner agent id', async () => {
      mockState.currentChannel = 'dm:agent1';
      mockState.channels = [{
        id: 'dm:agent1',
        name: 'Agent 1',
        members: ['agent1'],
        lastMessage: '',
        lastSender: '',
        lastTimestamp: '',
        newMessageCount: 0,
        isDM: true,
        peerId: 'agent1',
        peerName: 'Agent 1',
        dmOwnerId: 'hana',
      }];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ mode: 'write', replyMinChars: 20, replyMaxChars: 90 }),
      } as Response);

      const { saveConversationAgentPhoneSettings } = await import('../../stores/channel-actions');
      await saveConversationAgentPhoneSettings({ mode: 'write', replyMinChars: 20, replyMaxChars: 90 });

      expect(mockFetch).toHaveBeenCalledWith('/api/conversations/dm%3Aagent1/agent-phone-settings?agentId=hana', expect.objectContaining({
        method: 'POST',
      }));
      expect(mockState.channelAgentPhoneToolMode).toBe('write');
    });
  });

  describe('setConversationAgentPhoneToolMode', () => {
    it('persists and updates the current conversation phone tool mode', async () => {
      mockState.currentChannel = 'ch1';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, mode: 'write' }),
      } as Response);

      const { setConversationAgentPhoneToolMode } = await import('../../stores/channel-actions');
      await setConversationAgentPhoneToolMode('write');

      expect(mockFetch).toHaveBeenCalledWith('/api/conversations/ch1/agent-phone-settings', expect.objectContaining({
        method: 'POST',
      }));
      expect(mockState.channelAgentPhoneToolMode).toBe('write');
    });

    it('persists reply range settings without changing API output budget', async () => {
      mockState.currentChannel = 'ch1';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          mode: 'read_only',
          replyMinChars: 20,
          replyMaxChars: 80,
          proactiveEnabled: false,
          reminderIntervalMinutes: 45,
          guardLimit: 9,
          modelOverrideEnabled: true,
          modelOverrideModel: { id: 'deepseek-v4-flash', provider: 'deepseek' },
        }),
      } as Response);

      const { saveConversationAgentPhoneSettings } = await import('../../stores/channel-actions');
      await saveConversationAgentPhoneSettings({
        replyMinChars: 20,
        replyMaxChars: 80,
        proactiveEnabled: false,
        reminderIntervalMinutes: 45,
        guardLimit: 9,
        modelOverrideEnabled: true,
        modelOverrideModel: { id: 'deepseek-v4-flash', provider: 'deepseek' },
      });

      const [, init] = mockFetch.mock.calls[0];
      expect(mockFetch.mock.calls[0][0]).toBe('/api/conversations/ch1/agent-phone-settings');
      const body = JSON.parse(String((init as RequestInit).body));
      expect(body).toMatchObject({
        replyMinChars: 20,
        replyMaxChars: 80,
        proactiveEnabled: false,
        reminderIntervalMinutes: 45,
        guardLimit: 9,
        modelOverrideEnabled: true,
        modelOverrideModel: { id: 'deepseek-v4-flash', provider: 'deepseek' },
      });
      expect(body).not.toHaveProperty('replyInstructions');
      expect(body).not.toHaveProperty('maxTokens');
      expect(mockState.channelAgentReplyMinChars).toBe(20);
      expect(mockState.channelAgentReplyMaxChars).toBe(80);
      expect(mockState.channelAgentProactiveEnabled).toBe(false);
      expect(mockState.channelAgentReminderIntervalMinutes).toBe(45);
      expect(mockState.channelAgentGuardLimit).toBe(9);
      expect(mockState.channelAgentModelOverrideEnabled).toBe(true);
      expect(mockState.channelAgentModelOverrideModel).toEqual({ id: 'deepseek-v4-flash', provider: 'deepseek' });
    });
  });

  describe('channel member management', () => {
    it('adds a member and updates the current channel projection', async () => {
      mockState.currentChannel = 'ch1';
      mockState.userName = 'testuser';
      mockState.channelMembers = ['hana', 'butter'];
      mockState.channels = [{
        id: 'ch1',
        name: 'general',
        members: ['hana', 'butter'],
        lastMessage: '',
        lastSender: '',
        lastTimestamp: '',
        newMessageCount: 0,
      }];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, members: ['hana', 'butter', 'ming'] }),
      } as Response);

      const { addChannelMember } = await import('../../stores/channel-actions');
      await addChannelMember('ch1', 'ming');

      expect(mockFetch).toHaveBeenCalledWith('/api/channels/ch1/members', expect.objectContaining({
        method: 'POST',
      }));
      expect(mockState.channelMembers).toEqual(['hana', 'butter', 'ming']);
      expect((mockState.channels as any[])[0].members).toEqual(['hana', 'butter', 'ming']);
      expect(mockState.channelHeaderMembersText).toBe('4 channel.membersCount');
    });

    it('surfaces backend member removal errors without mutating local members', async () => {
      mockState.currentChannel = 'ch1';
      mockState.channelMembers = ['hana', 'butter'];
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'channel requires at least 2 agent members' }),
      } as Response);

      const { removeChannelMember } = await import('../../stores/channel-actions');
      await expect(removeChannelMember('ch1', 'butter')).rejects.toThrow(/at least 2/i);
      expect(mockState.channelMembers).toEqual(['hana', 'butter']);
    });
  });

  describe('sendChannelMessage', () => {
    it('does not send empty messages', async () => {
      mockState.currentChannel = 'ch1';
      const { sendChannelMessage } = await import('../../stores/channel-actions');
      await sendChannelMessage('   ');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('does not send without a current channel', async () => {
      mockState.currentChannel = null;
      const { sendChannelMessage } = await import('../../stores/channel-actions');
      await sendChannelMessage('hello');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('appends the sent message to store after success', async () => {
      mockState.currentChannel = 'ch1';
      mockState.channelMessages = [];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, timestamp: '2026-03-22T00:00:00Z' }),
      } as Response);

      const { sendChannelMessage } = await import('../../stores/channel-actions');
      await sendChannelMessage('hello world');

      const msgPatch = setStateCalls.find(p => p.channelMessages);
      expect(msgPatch).toBeDefined();
      const msgs = msgPatch!.channelMessages as Array<{ sender: string; body: string }>;
      expect(msgs[msgs.length - 1].body).toBe('hello world');
      expect(msgs[msgs.length - 1].sender).toBe('testuser');
    });

    it('syncs cache and channel list for the channel active at send start', async () => {
      mockState.currentChannel = 'ch1';
      mockState.channelMessages = [
        { sender: 'hanako', timestamp: '2026-05-07 17:00:00', body: 'old ch1' },
      ];
      mockState.channelMessageCache = {
        ch1: mockState.channelMessages,
        ch2: [{ sender: 'ming', timestamp: '2026-05-07 16:00:00', body: 'old ch2' }],
      };
      mockState.channelMessageCacheDirty = { ch1: false, ch2: false };
      mockState.channels = [{
        id: 'ch1',
        name: 'general',
        members: [],
        lastMessage: 'old ch1',
        lastSender: 'hanako',
        lastTimestamp: '2026-05-07 17:00:00',
        messageCount: 1,
        newMessageCount: 0,
        isDM: false,
      }, {
        id: 'ch2',
        name: 'random',
        members: [],
        lastMessage: 'old ch2',
        lastSender: 'ming',
        lastTimestamp: '2026-05-07 16:00:00',
        messageCount: 1,
        newMessageCount: 0,
        isDM: false,
      }];

      let resolveSend!: (value: Response) => void;
      mockFetch.mockReturnValueOnce(new Promise<Response>((resolve) => {
        resolveSend = resolve;
      }));

      const { sendChannelMessage } = await import('../../stores/channel-actions');
      const pendingSend = sendChannelMessage('hello from me');

      mockState.currentChannel = 'ch2';
      mockState.channelMessages = (mockState.channelMessageCache as any).ch2;
      resolveSend({
        ok: true,
        json: async () => ({ ok: true, timestamp: '2026-05-07 17:01:00' }),
      } as Response);
      await pendingSend;

      expect(mockFetch).toHaveBeenCalledWith('/api/channels/ch1/messages', expect.objectContaining({
        method: 'POST',
      }));
      expect(mockState.channelMessages).toEqual([
        { sender: 'ming', timestamp: '2026-05-07 16:00:00', body: 'old ch2' },
      ]);
      expect((mockState.channelMessageCache as any).ch1).toEqual([
        { sender: 'hanako', timestamp: '2026-05-07 17:00:00', body: 'old ch1' },
        { sender: 'testuser', timestamp: '2026-05-07 17:01:00', body: 'hello from me' },
      ]);
      expect((mockState.channelMessageCacheDirty as any).ch1).toBe(false);
      expect((mockState.channels as any[])[0]).toMatchObject({
        id: 'ch1',
        lastMessage: 'hello from me',
        lastSender: 'testuser',
        lastTimestamp: '2026-05-07 17:01:00',
        messageCount: 2,
        newMessageCount: 0,
      });
    });
  });

  describe('appendChannelMessage', () => {
    it('appends current channel messages and refreshes preview without clearing history', async () => {
      mockState.currentTab = 'channels';
      mockState.currentChannel = 'ch1';
      mockState.channelMessages = [
        { sender: 'testuser', timestamp: '2026-05-07 17:00:00', body: 'old' },
      ];
      mockState.channels = [{
        id: 'ch1',
        name: 'general',
        members: [],
        lastMessage: 'old',
        lastSender: 'testuser',
        lastTimestamp: '2026-05-07 17:00:00',
        newMessageCount: 3,
        isDM: false,
      }];
      mockState.channelTotalUnread = 3;

      const { appendChannelMessage } = await import('../../stores/channel-actions');
      appendChannelMessage('ch1', {
        sender: 'hanako',
        timestamp: '2026-05-07 17:01:00',
        body: 'new reply',
      });

      expect(mockState.channelMessages).toEqual([
        { sender: 'testuser', timestamp: '2026-05-07 17:00:00', body: 'old' },
        { sender: 'hanako', timestamp: '2026-05-07 17:01:00', body: 'new reply' },
      ]);
      expect((mockState.channels as Array<{ lastMessage: string; newMessageCount: number }>)[0]).toMatchObject({
        lastMessage: 'new reply',
        newMessageCount: 0,
      });
      expect(mockState.channelTotalUnread).toBe(0);
    });

    it('updates the current channel body cache while chat tab is active without marking read', async () => {
      mockState.currentTab = 'chat';
      mockState.currentChannel = 'ch1';
      mockState.channelMessages = [
        { sender: 'testuser', timestamp: '2026-05-07 17:00:00', body: 'old' },
      ];
      mockState.channels = [{
        id: 'ch1',
        name: 'general',
        members: [],
        lastMessage: 'old',
        lastSender: 'testuser',
        lastTimestamp: '2026-05-07 17:00:00',
        newMessageCount: 0,
        isDM: false,
      }];

      const { appendChannelMessage, hydrateCurrentChannelIfNeeded } = await import('../../stores/channel-actions');
      appendChannelMessage('ch1', {
        sender: 'hanako',
        timestamp: '2026-05-07 17:01:00',
        body: 'new reply',
      }, { markRead: false });

      expect(mockState.channelMessages).toEqual([
        { sender: 'testuser', timestamp: '2026-05-07 17:00:00', body: 'old' },
        { sender: 'hanako', timestamp: '2026-05-07 17:01:00', body: 'new reply' },
      ]);
      expect((mockState.channelMessageCache as any).ch1).toEqual(mockState.channelMessages);
      expect((mockState.channels as Array<{ newMessageCount: number }>)[0].newMessageCount).toBe(1);
      expect(mockFetch).not.toHaveBeenCalledWith('/api/channels/ch1/read', expect.anything());

      mockState.currentTab = 'channels';
      await hydrateCurrentChannelIfNeeded();

      expect(mockFetch).not.toHaveBeenCalledWith('/api/channels/ch1', expect.anything());
      expect(mockState.channelMessages).toEqual((mockState.channelMessageCache as any).ch1);
    });

    it('does not mark the current channel as read when the document is hidden', async () => {
      mockState.currentTab = 'channels';
      mockState.currentChannel = 'ch1';
      mockState.channelMessages = [];
      mockState.channels = [{
        id: 'ch1',
        name: 'general',
        members: [],
        lastMessage: '',
        lastSender: '',
        lastTimestamp: '',
        newMessageCount: 0,
        isDM: false,
      }];

      const { appendChannelMessage } = await import('../../stores/channel-actions');
      appendChannelMessage('ch1', {
        sender: 'hanako',
        timestamp: '2026-05-07 17:01:00',
        body: 'hidden reply',
      }, { markRead: false });

      expect((mockState.channels as Array<{ newMessageCount: number }>)[0].newMessageCount).toBe(1);
      expect(mockFetch).not.toHaveBeenCalledWith('/api/channels/ch1/read', expect.anything());
    });

    it('reloads the active channel when a message-less event marked its cache dirty', async () => {
      vi.stubGlobal('window', { t: (key: string) => key });
      mockState.currentTab = 'channels';
      mockState.currentChannel = 'ch1';
      mockState.channelMessages = [
        { sender: 'testuser', timestamp: '2026-05-07 17:00:00', body: 'old' },
      ];
      mockState.channelMessageCache = {
        ch1: mockState.channelMessages,
      };
      mockState.channels = [{
        id: 'ch1',
        name: 'general',
        members: ['hanako', 'yui'],
        lastMessage: 'old',
        lastSender: 'testuser',
        lastTimestamp: '2026-05-07 17:00:00',
        newMessageCount: 0,
        isDM: false,
      }];
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            name: 'general',
            members: ['hanako', 'yui'],
            messages: [
              { sender: 'testuser', timestamp: '2026-05-07 17:00:00', body: 'old' },
              { sender: 'hanako', timestamp: '2026-05-07 17:01:00', body: 'reloaded reply' },
            ],
          }),
        } as Response)
        .mockResolvedValue({
          ok: true,
          json: async () => ({ activities: [] }),
        } as Response);

      const { markChannelMessagesDirty, hydrateCurrentChannelIfNeeded } = await import('../../stores/channel-actions');
      markChannelMessagesDirty('ch1');
      expect((mockState.channelMessageCacheDirty as any).ch1).toBe(true);

      await hydrateCurrentChannelIfNeeded();

      expect(mockFetch).toHaveBeenCalledWith('/api/channels/ch1');
      expect(mockState.channelMessages).toEqual([
        { sender: 'testuser', timestamp: '2026-05-07 17:00:00', body: 'old' },
        { sender: 'hanako', timestamp: '2026-05-07 17:01:00', body: 'reloaded reply' },
      ]);
      expect((mockState.channelMessageCacheDirty as any).ch1).toBe(false);
    });
  });

  describe('createChannel', () => {
    it('sends the selected workspace root when creating a channel', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          name: 'mixed',
          members: ['alice', 'bob'],
          workspaceRoot: '/workspace/group',
        }),
      } as Response);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          channels: [
            { id: 'ch_mixed', name: 'mixed', members: ['alice', 'bob'], workspaceRoot: '/workspace/group' },
          ],
        }),
      } as Response);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ dms: [] }),
      } as Response);
      const { createChannel } = await import('../../stores/channel-actions');

      await createChannel('mixed', ['alice', 'bob'], undefined, '/workspace/group');

      expect(mockFetch).toHaveBeenCalledWith('/api/channels', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'mixed',
          members: ['alice', 'bob'],
          intro: undefined,
          workspaceRoot: '/workspace/group',
        }),
      }));
    });

    it('reads backend JSON errors instead of losing them to the fetch wrapper', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({
          code: 'CHANNEL_AGENT_NOT_FOUND',
          error: 'Agent not found: ghost',
        }),
      } as Response);

      const { createChannel } = await import('../../stores/channel-actions');

      await expect(createChannel('mixed', ['alice', 'ghost'])).rejects.toThrow('Agent not found: ghost');
      expect(mockFetch).toHaveBeenCalledWith('/api/channels', expect.objectContaining({
        method: 'POST',
        throwOnHttpError: false,
      }));
    });
  });

  describe('toggleChannelsEnabled', () => {
    it('does not guess the next value when channel enabled state is unknown', async () => {
      mockState.channelsEnabled = undefined;

      const { toggleChannelsEnabled } = await import('../../stores/channel-actions');
      const result = await toggleChannelsEnabled();

      expect(result).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(setStateCalls).toEqual([]);
    });

    it('toggles the channel switch state', async () => {
      mockState.channelsEnabled = true;

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ channels: [] }),
      } as Response);

      const { toggleChannelsEnabled } = await import('../../stores/channel-actions');
      const result = await toggleChannelsEnabled();

      expect(result).toBe(false); // toggled from true to false
      // 鐘舵€侀€氳繃鍚庣 /api/channels/toggle 鎸佷箙鍖栵紝涓嶅啀鐢?localStorage
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/channels/toggle'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('enables the backend before loading channels when turning channels on', async () => {
      mockState.channelsEnabled = false;
      mockFetch.mockImplementation(async (url: string) => {
        if (url === '/api/channels/toggle') {
          return {
            ok: true,
            json: async () => ({ ok: true, enabled: true }),
          } as Response;
        }
        if (url === '/api/channels') {
          return {
            ok: true,
            json: async () => ({ channels: [{ id: 'ch1', name: 'general', newMessageCount: 0 }] }),
          } as Response;
        }
        if (url === '/api/dm') {
          return {
            ok: true,
            json: async () => ({ dms: [] }),
          } as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      });

      const { toggleChannelsEnabled } = await import('../../stores/channel-actions');
      const result = await toggleChannelsEnabled();

      expect(result).toBe(true);
      expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([
        '/api/channels/toggle',
        '/api/channels',
        '/api/dm',
      ]);
      expect(mockState.channelsEnabled).toBe(true);
      expect(mockState.channels).toEqual([
        expect.objectContaining({ id: 'ch1', isDM: false }),
      ]);
    });
  });
});

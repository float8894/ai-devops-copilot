import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../lib/database.js', () => ({
  query: vi.fn(),
}));

import { conversationService } from './conversation.service.js';
import { query } from '../lib/database.js';
import { DatabaseError } from '../errors/index.js';
import { makeTestConversation } from '../test/helpers.js';

const mockQuery = vi.mocked(query);

describe('ConversationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // createConversation
  // ---------------------------------------------------------------------------

  describe('createConversation', () => {
    it('inserts and returns a UUID string', async () => {
      mockQuery.mockResolvedValue([]);

      const id = await conversationService.createConversation('user-1');

      expect(mockQuery).toHaveBeenCalledOnce();
      expect(typeof id).toBe('string');
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('passes the userId to the INSERT query', async () => {
      mockQuery.mockResolvedValue([]);

      await conversationService.createConversation('owner-id');

      const callArgs = mockQuery.mock.calls[0];
      const params = callArgs?.[1] as unknown[];
      expect(params?.[1]).toBe('owner-id');
    });

    it('wraps DB error in DatabaseError("Failed to create conversation")', async () => {
      mockQuery.mockRejectedValue(new Error('DB gone'));

      await expect(
        conversationService.createConversation('u'),
      ).rejects.toMatchObject({
        message: 'Failed to create conversation',
      });
      await expect(
        conversationService.createConversation('u'),
      ).rejects.toBeInstanceOf(DatabaseError);
    });
  });

  // ---------------------------------------------------------------------------
  // getConversation
  // ---------------------------------------------------------------------------

  describe('getConversation', () => {
    it('returns the conversation row when found', async () => {
      const row = makeTestConversation();
      mockQuery.mockResolvedValue([row]);

      const result = await conversationService.getConversation(
        'test-conv-id-456',
        'test-user-id-123',
      );

      expect(result).toEqual(row);
    });

    it('returns null when not found (ownership check or missing)', async () => {
      mockQuery.mockResolvedValue([]);

      expect(
        await conversationService.getConversation('missing', 'user-1'),
      ).toBeNull();
    });

    it('passes both id and userId to enforce ownership', async () => {
      mockQuery.mockResolvedValue([]);

      await conversationService.getConversation('conv-id', 'owner-id');

      const callArgs = mockQuery.mock.calls[0];
      const params = callArgs?.[1] as unknown[];
      expect(params).toContain('conv-id');
      expect(params).toContain('owner-id');
    });

    it('wraps DB error in DatabaseError', async () => {
      mockQuery.mockRejectedValue(new Error('timeout'));

      await expect(
        conversationService.getConversation('c', 'u'),
      ).rejects.toBeInstanceOf(DatabaseError);
    });
  });

  // ---------------------------------------------------------------------------
  // addMessage
  // ---------------------------------------------------------------------------

  describe('addMessage', () => {
    it('calls query twice — once for INSERT, once for timestamp UPDATE', async () => {
      mockQuery.mockResolvedValue([]);

      await conversationService.addMessage('conv-1', 'user', 'Hello', [
        'tool_a',
      ]);

      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it('passes toolsUsed array to the INSERT call', async () => {
      mockQuery.mockResolvedValue([]);

      await conversationService.addMessage('conv-1', 'assistant', 'Hi', [
        'tool_x',
        'tool_y',
      ]);

      const callArgs = mockQuery.mock.calls[0];
      const params = callArgs?.[1] as unknown[];
      expect(params?.[3]).toEqual(['tool_x', 'tool_y']);
    });

    it('passes null when toolsUsed is omitted', async () => {
      mockQuery.mockResolvedValue([]);

      await conversationService.addMessage('conv-1', 'user', 'Hello');

      const callArgs = mockQuery.mock.calls[0];
      const params = callArgs?.[1] as unknown[];
      expect(params?.[3]).toBeNull();
    });

    it('wraps DB error in DatabaseError', async () => {
      mockQuery.mockRejectedValue(new Error('DB down'));

      await expect(
        conversationService.addMessage('c', 'user', 'x'),
      ).rejects.toBeInstanceOf(DatabaseError);
    });
  });

  // ---------------------------------------------------------------------------
  // getHistory
  // ---------------------------------------------------------------------------

  describe('getHistory', () => {
    it('returns messages as role/content pairs in order', async () => {
      mockQuery.mockResolvedValue([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ]);

      const history = await conversationService.getHistory('conv-1');

      expect(history).toHaveLength(2);
      expect(history[0]).toEqual({ role: 'user', content: 'Hello' });
      expect(history[1]).toEqual({ role: 'assistant', content: 'Hi there' });
    });

    it('returns empty array when no messages exist', async () => {
      mockQuery.mockResolvedValue([]);

      expect(await conversationService.getHistory('conv-1')).toEqual([]);
    });

    it('wraps DB error in DatabaseError', async () => {
      mockQuery.mockRejectedValue(new Error('fail'));

      await expect(conversationService.getHistory('c')).rejects.toBeInstanceOf(
        DatabaseError,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // listRecentConversations
  // ---------------------------------------------------------------------------

  describe('listRecentConversations', () => {
    it('returns conversations for the given user', async () => {
      const rows = [
        makeTestConversation(),
        makeTestConversation({ id: 'other-id' }),
      ];
      mockQuery.mockResolvedValue(rows);

      const result =
        await conversationService.listRecentConversations('user-1');

      expect(result).toHaveLength(2);
    });

    it('passes the limit parameter to the query', async () => {
      mockQuery.mockResolvedValue([]);

      await conversationService.listRecentConversations('user-1', 5);

      const callArgs = mockQuery.mock.calls[0];
      const params = callArgs?.[1] as unknown[];
      expect(params?.[1]).toBe(5);
    });

    it('uses default limit of 20 when not provided', async () => {
      mockQuery.mockResolvedValue([]);

      await conversationService.listRecentConversations('user-1');

      const callArgs = mockQuery.mock.calls[0];
      const params = callArgs?.[1] as unknown[];
      expect(params?.[1]).toBe(20);
    });

    it('wraps DB error in DatabaseError', async () => {
      mockQuery.mockRejectedValue(new Error('fail'));

      await expect(
        conversationService.listRecentConversations('u'),
      ).rejects.toBeInstanceOf(DatabaseError);
    });
  });

  // ---------------------------------------------------------------------------
  // deleteConversation
  // ---------------------------------------------------------------------------

  describe('deleteConversation', () => {
    it('calls query with both id and userId', async () => {
      mockQuery.mockResolvedValue([]);

      await conversationService.deleteConversation('conv-1', 'user-1');

      expect(mockQuery).toHaveBeenCalledOnce();
      const callArgs = mockQuery.mock.calls[0];
      const params = callArgs?.[1] as unknown[];
      expect(params).toContain('conv-1');
      expect(params).toContain('user-1');
    });

    it('wraps DB error in DatabaseError', async () => {
      mockQuery.mockRejectedValue(new Error('fail'));

      await expect(
        conversationService.deleteConversation('c', 'u'),
      ).rejects.toBeInstanceOf(DatabaseError);
    });
  });
});

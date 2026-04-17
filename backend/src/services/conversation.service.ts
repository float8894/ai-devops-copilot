import { randomUUID } from 'node:crypto';
import { query } from '../lib/database.js';
import type { ConversationRow, MessageRow } from '../models/job.js';
import type Anthropic from '@anthropic-ai/sdk';

type Message = Anthropic.MessageParam;

export class ConversationService {
  /**
   * Create a new conversation owned by the given user
   */
  async createConversation(userId: string): Promise<string> {
    const id = randomUUID();
    await query(
      'INSERT INTO conversations (id, user_id, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())',
      [id, userId],
    );
    return id;
  }

  /**
   * Get conversation by ID — returns null if not found or not owned by userId
   */
  async getConversation(id: string, userId: string): Promise<ConversationRow | null> {
    const rows = await query<ConversationRow>(
      'SELECT id, user_id, created_at, updated_at FROM conversations WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    return rows[0] ?? null;
  }

  /**
   * Add a message to a conversation
   */
  async addMessage(
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    toolsUsed?: string[],
  ): Promise<void> {
    await query(
      `INSERT INTO messages (conversation_id, role, content, tools_used, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [conversationId, role, content, toolsUsed ?? null],
    );

    // Update conversation updated_at timestamp
    await query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [
      conversationId,
    ]);
  }

  /**
   * Get conversation history formatted for Claude API
   */
  async getHistory(conversationId: string): Promise<Message[]> {
    const rows = await query<MessageRow>(
      `SELECT role, content FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      [conversationId],
    );

    return rows.map((row) => ({
      role: row.role,
      content: row.content,
    }));
  }

  /**
   * Get recent conversations for a specific user
   */
  async listRecentConversations(userId: string, limit = 20): Promise<ConversationRow[]> {
    return query<ConversationRow>(
      `SELECT id, user_id, created_at, updated_at
       FROM conversations
       WHERE user_id = $1
       ORDER BY updated_at DESC
       LIMIT $2`,
      [userId, limit],
    );
  }

  /**
   * Delete a conversation — silently no-ops if not owned by userId
   */
  async deleteConversation(id: string, userId: string): Promise<void> {
    await query('DELETE FROM conversations WHERE id = $1 AND user_id = $2', [id, userId]);
  }
}

export const conversationService = new ConversationService();

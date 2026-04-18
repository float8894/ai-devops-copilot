import { randomUUID } from 'node:crypto';
import { query } from '../lib/database.js';
import { DatabaseError } from '../errors/index.js';
import type { ConversationRow, MessageRow } from '../models/job.js';
import type Anthropic from '@anthropic-ai/sdk';

type Message = Anthropic.MessageParam;

export class ConversationService {
  /**
   * Create a new anonymous conversation
   */
  async createConversation(): Promise<string> {
    const id = randomUUID();
    try {
      await query(
        'INSERT INTO conversations (id, created_at, updated_at) VALUES ($1, NOW(), NOW())',
        [id],
      );
    } catch (err) {
      throw new DatabaseError('Failed to create conversation', err);
    }
    return id;
  }

  /**
   * Get conversation by ID — returns null if not found
   */
  async getConversation(id: string): Promise<ConversationRow | null> {
    try {
      const rows = await query<ConversationRow>(
        'SELECT id, created_at, updated_at FROM conversations WHERE id = $1',
        [id],
      );
      return rows[0] ?? null;
    } catch (err) {
      throw new DatabaseError('Failed to get conversation', err);
    }
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
    try {
      await query(
        `INSERT INTO messages (conversation_id, role, content, tools_used, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [conversationId, role, content, toolsUsed ?? null],
      );

      // Update conversation updated_at timestamp
      await query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [
        conversationId,
      ]);
    } catch (err) {
      throw new DatabaseError('Failed to add message', err);
    }
  }

  /**
   * Get conversation history formatted for Claude API
   */
  async getHistory(conversationId: string): Promise<Message[]> {
    try {
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
    } catch (err) {
      throw new DatabaseError('Failed to get conversation history', err);
    }
  }

  /**
   * Get recent conversations
   */
  async listRecentConversations(limit = 20): Promise<ConversationRow[]> {
    try {
      return await query<ConversationRow>(
        `SELECT id, created_at, updated_at
         FROM conversations
         ORDER BY updated_at DESC
         LIMIT $1`,
        [limit],
      );
    } catch (err) {
      throw new DatabaseError('Failed to list conversations', err);
    }
  }

  /**
   * Delete a conversation and all its messages (cascade)
   */
  async deleteConversation(id: string): Promise<void> {
    try {
      await query('DELETE FROM conversations WHERE id = $1', [id]);
    } catch (err) {
      throw new DatabaseError('Failed to delete conversation', err);
    }
  }
}

export const conversationService = new ConversationService();

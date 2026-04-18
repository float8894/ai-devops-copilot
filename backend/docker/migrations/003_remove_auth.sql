-- Migration 003: Remove authentication and AWS account management
-- Drops users, aws_accounts tables and the user_id column from conversations.

DROP TABLE IF EXISTS aws_accounts CASCADE;
DROP TABLE IF EXISTS users CASCADE;

ALTER TABLE conversations DROP COLUMN IF EXISTS user_id;

DROP INDEX IF EXISTS idx_conversations_user_id;

CREATE INDEX IF NOT EXISTS idx_conversations_updated
  ON conversations (updated_at DESC);

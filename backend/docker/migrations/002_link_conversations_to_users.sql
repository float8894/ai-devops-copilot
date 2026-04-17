-- Migration 002: Link conversations to their owning user
-- Adds user_id FK to conversations for per-user access control.
--
-- Safety strategy for existing databases:
--   1. Add column nullable (required before we can enforce NOT NULL)
--   2. Purge orphaned rows (no user can claim them — their id is unknown)
--   3. Enforce NOT NULL now that no NULL rows remain
--   4. Replace the global updated_at index with a per-user composite index
--      that supports both WHERE user_id = $1 and ORDER BY updated_at DESC

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;

DELETE FROM conversations WHERE user_id IS NULL;

ALTER TABLE conversations ALTER COLUMN user_id SET NOT NULL;

DROP INDEX IF EXISTS idx_conversations_updated;

CREATE INDEX IF NOT EXISTS idx_conversations_user_id
  ON conversations (user_id, updated_at DESC);

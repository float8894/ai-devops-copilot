-- Jobs table for background job tracking
CREATE TABLE IF NOT EXISTS jobs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(255) NOT NULL,
  status      VARCHAR(50)  NOT NULL CHECK (status IN ('pending','running','failed','completed')),
  error_message TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_created
  ON jobs (status, created_at DESC);

-- Conversations table for chat history persistence
CREATE TABLE IF NOT EXISTS conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_updated
  ON conversations (updated_at DESC);

-- Messages table for individual chat messages
CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  tools_used      TEXT[], -- Array of tool names used in this turn
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON messages (conversation_id, created_at ASC);

-- Seed some realistic failed jobs for dev/testing
INSERT INTO jobs (name, status, error_message, created_at) VALUES
  ('send-invoice-emails',  'failed', 'SMTP connection refused: connect ECONNREFUSED 10.0.0.5:587', NOW() - INTERVAL '2 hours'),
  ('sync-stripe-webhooks', 'failed', 'Stripe API rate limit exceeded (429)', NOW() - INTERVAL '5 hours'),
  ('generate-pdf-reports', 'failed', 'Out of memory: Killed process 1842', NOW() - INTERVAL '8 hours'),
  ('backup-user-data',     'failed', 'S3 PutObject: Access Denied (403)', NOW() - INTERVAL '12 hours'),
  ('process-csv-import',   'failed', 'CSV parse error at row 1042: unexpected EOF', NOW() - INTERVAL '1 day'),
  ('send-invoice-emails',  'completed', NULL, NOW() - INTERVAL '30 minutes'),
  ('sync-stripe-webhooks', 'completed', NULL, NOW() - INTERVAL '1 hour'),
  ('health-check',         'completed', NULL, NOW() - INTERVAL '5 minutes');

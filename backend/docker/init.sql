-- Users table for authentication (defined first — conversations and aws_accounts reference it)
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

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
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Composite index: supports WHERE user_id = $1 ORDER BY updated_at DESC
CREATE INDEX IF NOT EXISTS idx_conversations_user_id
  ON conversations (user_id, updated_at DESC);

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

-- AWS accounts table — stores IAM Role ARNs per user (no long-lived credentials)
CREATE TABLE IF NOT EXISTS aws_accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  role_arn    TEXT NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name)
);

-- Only one default account per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_aws_accounts_default
  ON aws_accounts (user_id) WHERE is_default = true;

CREATE INDEX IF NOT EXISTS idx_aws_accounts_user
  ON aws_accounts (user_id);

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

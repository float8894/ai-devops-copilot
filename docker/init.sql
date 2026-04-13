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
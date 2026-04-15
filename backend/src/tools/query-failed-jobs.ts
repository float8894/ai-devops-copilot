import { query } from '../lib/database.js';
import type { JobRow, TimeRange } from '../models/job.js';

export const intervalMap: Record<TimeRange, string> = {
  '1h': '1 hour',
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
};

export interface QueryFailedJobsInput {
  time_range?: TimeRange | undefined;
  limit?: number | undefined;
}

export interface QueryFailedJobsResult {
  jobs: JobRow[];
  count: number;
  time_range: TimeRange;
  error_patterns: Record<string, number>;
}

export async function queryFailedJobs(
  input: QueryFailedJobsInput,
): Promise<QueryFailedJobsResult> {
  const time_range = input.time_range ?? '24h';
  const limit = input.limit ?? 20;

  const rows = await query<JobRow>(
    `SELECT id, name, status, error_message, created_at
     FROM jobs
     WHERE status = 'failed'
       AND created_at > NOW() - $1::interval
     ORDER BY created_at DESC
     LIMIT $2`,
    [intervalMap[time_range], limit],
  );

  const errorPatterns: Record<string, number> = {};
  for (const row of rows) {
    const key = row.error_message ?? 'Unknown error';
    errorPatterns[key] = (errorPatterns[key] ?? 0) + 1;
  }

  return {
    jobs: rows,
    count: rows.length,
    time_range,
    error_patterns: errorPatterns,
  };
}

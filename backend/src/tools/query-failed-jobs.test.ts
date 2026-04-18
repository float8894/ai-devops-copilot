import { describe, it, expect, vi } from 'vitest';

// Mock database before importing the tool
vi.mock('../lib/database.js', () => ({
  query: vi.fn(),
}));

import { query } from '../lib/database.js';
import { queryFailedJobs, intervalMap } from './query-failed-jobs.js';
import type { JobRow } from '../models/job.js';

const mockQuery = vi.mocked(query);

const makeJob = (overrides: Partial<JobRow> = {}): JobRow => ({
  id: 'job-1',
  name: 'test-job',
  status: 'failed',
  error_message: 'Connection timeout',
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
});

describe('intervalMap', () => {
  it('maps all time_range keys to correct INTERVAL strings', () => {
    expect(intervalMap['1h']).toBe('1 hour');
    expect(intervalMap['24h']).toBe('24 hours');
    expect(intervalMap['7d']).toBe('7 days');
    expect(intervalMap['30d']).toBe('30 days');
  });
});

describe('queryFailedJobs', () => {
  it('returns jobs with count and error_patterns', async () => {
    const jobs: JobRow[] = [
      makeJob({ error_message: 'Timeout' }),
      makeJob({ id: 'job-2', error_message: 'Timeout' }),
      makeJob({ id: 'job-3', error_message: 'OOM' }),
    ];
    mockQuery.mockResolvedValueOnce(jobs);

    const result = await queryFailedJobs({ time_range: '24h', limit: 20 });

    expect(result.count).toBe(3);
    expect(result.time_range).toBe('24h');
    expect(result.jobs).toHaveLength(3);
    expect(result.error_patterns['Timeout']).toBe(2);
    expect(result.error_patterns['OOM']).toBe(1);
  });

  it('defaults to 24h and limit 20 when not specified', async () => {
    mockQuery.mockResolvedValueOnce([]);

    await queryFailedJobs({});

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('$1::interval'),
      ['24 hours', 20],
    );
  });

  it('uses correct interval for each time_range', async () => {
    for (const [range, interval] of Object.entries(intervalMap)) {
      mockQuery.mockResolvedValueOnce([]);
      await queryFailedJobs({
        time_range: range as '1h' | '24h' | '7d' | '30d',
      });
      expect(mockQuery).toHaveBeenLastCalledWith(expect.any(String), [
        interval,
        20,
      ]);
    }
  });

  it('returns empty result with no jobs when DB returns empty array', async () => {
    mockQuery.mockResolvedValueOnce([]);

    const result = await queryFailedJobs({ time_range: '7d' });

    expect(result.count).toBe(0);
    expect(result.jobs).toEqual([]);
    expect(result.error_patterns).toEqual({});
  });

  it('uses "Unknown error" key for null error_message', async () => {
    mockQuery.mockResolvedValueOnce([makeJob({ error_message: null })]);

    const result = await queryFailedJobs({});

    expect(result.error_patterns['Unknown error']).toBe(1);
  });

  it('propagates DatabaseError on query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB connection lost'));

    await expect(queryFailedJobs({ time_range: '24h' })).rejects.toThrow(
      'DB connection lost',
    );
  });
});

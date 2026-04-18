import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/database.js', () => ({
  query: vi.fn(),
}));

import { query } from '../lib/database.js';
import { getDbSchema } from './get-db-schema.js';
import { DatabaseError } from '../errors/index.js';

const mockQuery = vi.mocked(query);

interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  is_pk: boolean;
}

interface FkRow {
  table_name: string;
  column_name: string;
  ref_table: string;
  ref_column: string;
}

describe('getDbSchema', () => {
  it('returns tables with columns mapped correctly', async () => {
    const columnRows: ColumnRow[] = [
      {
        table_name: 'jobs',
        column_name: 'id',
        data_type: 'uuid',
        is_nullable: 'NO',
        is_pk: true,
      },
      {
        table_name: 'jobs',
        column_name: 'name',
        data_type: 'text',
        is_nullable: 'NO',
        is_pk: false,
      },
      {
        table_name: 'jobs',
        column_name: 'status',
        data_type: 'text',
        is_nullable: 'NO',
        is_pk: false,
      },
      {
        table_name: 'users',
        column_name: 'id',
        data_type: 'uuid',
        is_nullable: 'NO',
        is_pk: true,
      },
      {
        table_name: 'users',
        column_name: 'email',
        data_type: 'text',
        is_nullable: 'NO',
        is_pk: false,
      },
    ];
    const fkRows: FkRow[] = [];

    mockQuery.mockResolvedValueOnce(columnRows).mockResolvedValueOnce(fkRows);

    const result = await getDbSchema();

    expect(result.tableCount).toBe(2);
    expect(result.tables).toHaveLength(2);

    const jobsTable = result.tables.find((t) => t.name === 'jobs');
    expect(jobsTable).toBeDefined();
    expect(jobsTable?.columns).toHaveLength(3);

    const idCol = jobsTable?.columns.find((c) => c.name === 'id');
    expect(idCol?.isPrimaryKey).toBe(true);
    expect(idCol?.nullable).toBe(false);
    expect(idCol?.type).toBe('uuid');
  });

  it('populates isForeignKey and references when FK exists', async () => {
    const columnRows: ColumnRow[] = [
      {
        table_name: 'jobs',
        column_name: 'user_id',
        data_type: 'uuid',
        is_nullable: 'YES',
        is_pk: false,
      },
    ];
    const fkRows: FkRow[] = [
      {
        table_name: 'jobs',
        column_name: 'user_id',
        ref_table: 'users',
        ref_column: 'id',
      },
    ];

    mockQuery.mockResolvedValueOnce(columnRows).mockResolvedValueOnce(fkRows);

    const result = await getDbSchema();
    const col = result.tables[0]?.columns[0];

    expect(col?.isForeignKey).toBe(true);
    expect(col?.references).toEqual({ table: 'users', column: 'id' });
  });

  it('sets isForeignKey=false and no references for non-FK columns', async () => {
    const columnRows: ColumnRow[] = [
      {
        table_name: 'jobs',
        column_name: 'name',
        data_type: 'text',
        is_nullable: 'NO',
        is_pk: false,
      },
    ];

    mockQuery.mockResolvedValueOnce(columnRows).mockResolvedValueOnce([]);

    const result = await getDbSchema();
    const col = result.tables[0]?.columns[0];

    expect(col?.isForeignKey).toBe(false);
    expect(col?.references).toBeUndefined();
  });

  it('returns empty tables array when schema has no tables', async () => {
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const result = await getDbSchema();

    expect(result.tableCount).toBe(0);
    expect(result.tables).toEqual([]);
  });

  it('re-throws DatabaseError from query', async () => {
    const dbErr = new DatabaseError(
      'Query failed',
      new Error('connection lost'),
    );
    mockQuery.mockRejectedValueOnce(dbErr);

    await expect(getDbSchema()).rejects.toBeInstanceOf(DatabaseError);
  });

  it('wraps unexpected errors in DatabaseError', async () => {
    mockQuery.mockRejectedValueOnce(new Error('unexpected'));

    await expect(getDbSchema()).rejects.toBeInstanceOf(DatabaseError);
  });
});

import { describe, it, expect } from 'vitest';
import {
  AppError,
  DatabaseError,
  McpToolError,
  ValidationError,
  NotFoundError,
} from './index.js';

describe('AppError', () => {
  it('sets message, code, statusCode, and name', () => {
    const err = new AppError('Something broke', 'SOMETHING_BROKE', 503);
    expect(err.message).toBe('Something broke');
    expect(err.code).toBe('SOMETHING_BROKE');
    expect(err.statusCode).toBe(503);
    expect(err.name).toBe('AppError');
    expect(err).toBeInstanceOf(Error);
  });

  it('defaults statusCode to 500', () => {
    const err = new AppError('msg', 'CODE');
    expect(err.statusCode).toBe(500);
  });

  it('chains cause via ErrorOptions', () => {
    const cause = new Error('root cause');
    const err = new AppError('wrapper', 'CODE', 500, { cause });
    expect(err.cause).toBe(cause);
  });
});

describe('DatabaseError', () => {
  it('has correct code and statusCode', () => {
    const err = new DatabaseError('DB failed');
    expect(err.code).toBe('DATABASE_ERROR');
    expect(err.statusCode).toBe(500);
    expect(err).toBeInstanceOf(AppError);
  });

  it('chains cause', () => {
    const cause = new Error('pg error');
    const err = new DatabaseError('query failed', cause);
    expect(err.cause).toBe(cause);
  });
});

describe('McpToolError', () => {
  it('stores toolName and has correct code', () => {
    const err = new McpToolError('Tool failed', 'query_failed_jobs');
    expect(err.code).toBe('MCP_TOOL_ERROR');
    expect(err.toolName).toBe('query_failed_jobs');
    expect(err.statusCode).toBe(500);
    expect(err).toBeInstanceOf(AppError);
  });
});

describe('ValidationError', () => {
  it('has status 400 and correct code', () => {
    const err = new ValidationError('Bad input');
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.statusCode).toBe(400);
    expect(err).toBeInstanceOf(AppError);
  });
});

describe('NotFoundError', () => {
  it('has status 404 and correct code', () => {
    const err = new NotFoundError('Not found');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.statusCode).toBe(404);
    expect(err).toBeInstanceOf(AppError);
  });
});

import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  ANTHROPIC_API_KEY: z.string().min(1),
  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  ALLOWED_ORIGIN: z.string().default('http://localhost:4200'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  MCP_POSTGRES_HTTP_PORT: z.coerce.number().default(3001),
  MCP_REDIS_HTTP_PORT: z.coerce.number().default(3002),
  MCP_AWS_HTTP_PORT: z.coerce.number().default(3003),
});

export const env = envSchema.parse(process.env);

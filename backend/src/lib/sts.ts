import {
  STSClient,
  AssumeRoleCommand,
  type Credentials,
} from '@aws-sdk/client-sts';
import { env } from '../config/env.js';
import { createLogger } from './logger.js';
import { redis } from './redis.js';

const log = createLogger({ service: 'sts' });

const stsClient = new STSClient({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
});

// Buffer before expiry to avoid using credentials that are about to expire
const EXPIRY_BUFFER_SECONDS = 60;

export interface AssumedCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}

function cacheKey(userId: string, accountId: string): string {
  return `sts:${userId}:${accountId}`;
}

export async function assumeRole(
  roleArn: string,
  userId: string,
  accountId: string,
): Promise<AssumedCredentials> {
  const key = cacheKey(userId, accountId);

  // Check Redis cache first
  const cached = await redis.get(key);
  if (cached) {
    log.debug({ userId, accountId }, 'STS credentials served from cache');
    return JSON.parse(cached) as AssumedCredentials;
  }

  log.info({ roleArn, userId, accountId }, 'Calling STS AssumeRole');

  const command = new AssumeRoleCommand({
    RoleArn: roleArn,
    RoleSessionName: `devops-copilot-${userId.substring(0, 8)}`,
    DurationSeconds: 3600,
  });

  const response = await stsClient.send(command);
  const creds: Credentials | undefined = response.Credentials;

  if (
    !creds?.AccessKeyId ||
    !creds.SecretAccessKey ||
    !creds.SessionToken ||
    !creds.Expiration
  ) {
    throw new Error('STS returned incomplete credentials');
  }

  const assumed: AssumedCredentials = {
    accessKeyId: creds.AccessKeyId,
    secretAccessKey: creds.SecretAccessKey,
    sessionToken: creds.SessionToken,
  };

  // Cache until expiry minus buffer
  const expiresIn = Math.max(
    Math.floor((creds.Expiration.getTime() - Date.now()) / 1000) -
      EXPIRY_BUFFER_SECONDS,
    1,
  );

  await redis.setex(key, expiresIn, JSON.stringify(assumed));

  log.debug({ userId, accountId, expiresIn }, 'STS credentials cached');

  return assumed;
}

export async function invalidateStsCache(
  userId: string,
  accountId: string,
): Promise<void> {
  await redis.del(cacheKey(userId, accountId));
}

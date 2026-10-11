import { createClient, RedisClientType } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

const redisUrl =
  process.env.REDIS_URL ||
  `redis://${process.env.REDIS_PASSWORD ? `:${process.env.REDIS_PASSWORD}@` : ''}${
    process.env.REDIS_HOST || 'localhost'
  }:${process.env.REDIS_PORT || 6379}`;

export const redisClient: RedisClientType = createClient({
  url: redisUrl,
  socket: {
    reconnectStrategy: (retries: number) => {
      if (retries > 10) {
        console.error('[Redis] Max reconnection attempts exceeded.');
        return new Error('Max reconnection attempts reached.');
      }
      const delay = Math.min(retries * 200, 3000);
      console.warn(`[Redis] Reconnecting in ${delay}ms (attempt #${retries})...`);
      return delay;
    },
  },
});

redisClient.on('connect', () => {
  console.log('[Redis] Connecting to instance...');
});

redisClient.on('ready', () => {
  console.log('[Redis] Connection established and ready to accept commands.');
});

redisClient.on('error', (err: Error) => {
  console.error('[Redis Error]', err.message);
});

redisClient.on('reconnecting', () => {
  console.warn('[Redis] Reconnection initiated.');
});

/**
 * Initializes connection to Redis server.
 */
export async function connectRedis(): Promise<void> {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
}

/**
 * Performs a health ping against the Redis instance.
 */
export async function checkRedisHealth(): Promise<{
  status: 'healthy' | 'unhealthy';
  latencyMs: number;
  isOpen: boolean;
  error?: string;
}> {
  const start = Date.now();
  try {
    if (!redisClient.isOpen) {
      throw new Error('Redis client connection is not open');
    }
    const pong = await redisClient.ping();
    const latencyMs = Date.now() - start;
    return {
      status: pong === 'PONG' ? 'healthy' : 'unhealthy',
      latencyMs,
      isOpen: redisClient.isOpen,
    };
  } catch (error: any) {
    const latencyMs = Date.now() - start;
    return {
      status: 'unhealthy',
      latencyMs,
      isOpen: redisClient.isOpen,
      error: error?.message || 'Redis ping failed',
    };
  }
}

/**
 * Gracefully disconnects the Redis client.
 */
export async function closeRedisConnection(): Promise<void> {
  console.log('[Redis] Closing connection...');
  if (redisClient.isOpen) {
    await redisClient.quit();
  }
  console.log('[Redis] Connection closed.');
}

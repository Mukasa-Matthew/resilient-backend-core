import { Request, Response } from 'express';
import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redisClient } from '../config/redis.js';

interface RateLimiterOptions {
  windowMs?: number;
  max?: number;
  prefix?: string;
  message?: string;
}

/**
 * Creates a Redis-backed Rate Limiter middleware instance.
 * Gracefully degrades if Redis is unavailable or still connecting.
 */
export function createRateLimiter(options: RateLimiterOptions = {}): RateLimitRequestHandler {
  const windowMs =
    options.windowMs ||
    Number(process.env.RATE_LIMIT_WINDOW_MS) ||
    15 * 60 * 1000; // 15 minutes default

  const max =
    options.max ||
    Number(process.env.RATE_LIMIT_MAX_REQUESTS) ||
    100; // 100 requests default

  const prefix = options.prefix || 'rl:global:';
  const message =
    options.message || 'Too many requests from this IP address. Please try again later.';

  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: new RedisStore({
      // Use node-redis sendCommand adapter
      sendCommand: (...args: string[]) => redisClient.sendCommand(args),
      prefix,
      passOnStoreError: true, // Fail open if Redis is down so API stays available
    }),
    handler: (req: Request, res: Response, _next, opts) => {
      res.status(opts.statusCode).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message,
          details: {
            windowMs,
            limit: max,
          },
          timestamp: new Date().toISOString(),
          path: req.originalUrl,
        },
      });
    },
  });
}

/**
 * Global API rate limiter instance.
 */
export const globalRateLimiter = createRateLimiter({
  prefix: 'rl:api:',
  windowMs: 15 * 60 * 1000,
  max: 100,
});

/**
 * Stricter rate limiter for sensitive endpoints (e.g., authentication, password resets).
 */
export const strictRateLimiter = createRateLimiter({
  prefix: 'rl:strict:',
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many attempts on this sensitive endpoint. Please wait before retrying.',
});

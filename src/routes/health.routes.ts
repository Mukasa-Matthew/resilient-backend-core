import { Router, Request, Response } from 'express';
import { checkDatabaseHealth } from '../config/database.js';
import { checkRedisHealth } from '../config/redis.js';

export const healthRouter = Router();

/**
 * Liveness Probe: Verifies that the application process is running and event loop is healthy.
 * Ideal for Kubernetes livenessProbe.
 */
healthRouter.get('/liveness', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'UP',
    timestamp: new Date().toISOString(),
    uptimeSeconds: process.uptime(),
  });
});

/**
 * Readiness Probe: Verifies that upstream critical dependencies (PostgreSQL, Redis)
 * are reachable and ready to accept incoming production traffic.
 * Ideal for Kubernetes readinessProbe or ALB health checks.
 */
healthRouter.get('/readiness', async (_req: Request, res: Response) => {
  const [dbHealth, redisHealth] = await Promise.all([
    checkDatabaseHealth(),
    checkRedisHealth(),
  ]);

  const isHealthy = dbHealth.status === 'healthy' && redisHealth.status === 'healthy';
  const statusCode = isHealthy ? 200 : 503;

  res.status(statusCode).json({
    status: isHealthy ? 'READY' : 'DEGRADED',
    timestamp: new Date().toISOString(),
    dependencies: {
      database: dbHealth,
      redis: redisHealth,
    },
  });
});

/**
 * Detailed System Telemetry: Provides runtime resource telemetry, memory stats, and environment info.
 */
healthRouter.get('/telemetry', async (_req: Request, res: Response) => {
  const memUsage = process.memoryUsage();
  const [dbHealth, redisHealth] = await Promise.all([
    checkDatabaseHealth(),
    checkRedisHealth(),
  ]);

  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    system: {
      uptimeSeconds: Math.floor(process.uptime()),
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      environment: process.env.NODE_ENV || 'development',
    },
    memory: {
      heapUsedMb: Math.round((memUsage.heapUsed / 1024 / 1024) * 100) / 100,
      heapTotalMb: Math.round((memUsage.heapTotal / 1024 / 1024) * 100) / 100,
      rssMb: Math.round((memUsage.rss / 1024 / 1024) * 100) / 100,
      externalMb: Math.round((memUsage.external / 1024 / 1024) * 100) / 100,
    },
    dependencies: {
      database: dbHealth,
      redis: redisHealth,
    },
  });
});

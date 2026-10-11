import express, { Express, Request, Response } from 'express';
import { Server } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { closeDatabasePool } from './config/database.js';
import { connectRedis, closeRedisConnection } from './config/redis.js';
import { globalRateLimiter } from './middleware/rateLimiter.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { healthRouter } from './routes/health.routes.js';

dotenv.config();

const app: Express = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// ==============================================================================
// Security & Core Middlewares
// ==============================================================================
// Trust first proxy when running behind reverse proxies (Traefik, NGINX, AWS ALB)
app.set('trust proxy', 1);

app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ==============================================================================
// Route Registrations
// ==============================================================================
// Health endpoints are mounted before rate limiting for uninterrupted probes
app.use('/health', healthRouter);

// Apply rate limiting to all business routes
app.use('/api', globalRateLimiter);

// Sample baseline API endpoint
app.get('/api/v1/ping', (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    data: {
      message: 'pong',
      service: 'resilient-backend-core',
      timestamp: new Date().toISOString(),
    },
  });
});

// Fallback 404 handler and centralized error handling
app.use(notFoundHandler);
app.use(errorHandler);

// ==============================================================================
// Server Lifecycle & Graceful Shutdown
// ==============================================================================
let server: Server;
let isShuttingDown = false;

async function startServer(): Promise<void> {
  try {
    // Attempt connecting to Redis (fail-open fallback allowed)
    try {
      await connectRedis();
    } catch (redisError: any) {
      console.warn('[Server Warning] Initial Redis connection failed:', redisError.message);
    }

    server = app.listen(PORT, HOST, () => {
      console.log(`[Server] Resilient backend core running at http://${HOST}:${PORT}`);
      console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('[Server Error] Critical startup failure:', error);
    process.exit(1);
  }
}

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[Shutdown] Received ${signal}. Starting graceful termination sequence...`);

  // Force shutdown after timeout if pending operations hang
  const forceExitTimeout = setTimeout(() => {
    console.error('[Shutdown Error] Forcefully terminating process after 10s timeout.');
    process.exit(1);
  }, 10000);
  forceExitTimeout.unref();

  try {
    // 1. Stop accepting new HTTP requests
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) return reject(err);
          console.log('[Shutdown] HTTP listener closed. No longer accepting new connections.');
          resolve();
        });
      });
    }

    // 2. Disconnect database pool
    await closeDatabasePool();

    // 3. Disconnect Redis client
    await closeRedisConnection();

    console.log('[Shutdown] All background handles and pools drained. Clean exit.');
    process.exit(0);
  } catch (shutdownError) {
    console.error('[Shutdown Error] Error during termination:', shutdownError);
    process.exit(1);
  }
}

// OS Process Signal Listeners
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err: Error) => {
  console.error('[Process Fatal] Uncaught Exception:', err);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason: unknown) => {
  console.error('[Process Fatal] Unhandled Promise Rejection:', reason);
  gracefulShutdown('unhandledRejection');
});

// Start the server
startServer();

export { app, server };

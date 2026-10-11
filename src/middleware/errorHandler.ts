import { Request, Response, NextFunction } from 'express';

/**
 * Base Application Error class for predictable, operational errors.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly isOperational: boolean;
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode: number = 500,
    errorCode: string = 'INTERNAL_SERVER_ERROR',
    isOperational: boolean = true,
    details?: unknown
  ) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = isOperational;
    this.details = details;

    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found', details?: unknown) {
    super(message, 404, 'NOT_FOUND', true, details);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string = 'Bad request', details?: unknown) {
    super(message, 400, 'BAD_REQUEST', true, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized access', details?: unknown) {
    super(message, 401, 'UNAUTHORIZED', true, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden action', details?: unknown) {
    super(message, 403, 'FORBIDDEN', true, details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Resource conflict', details?: unknown) {
    super(message, 409, 'CONFLICT', true, details);
  }
}

/**
 * 404 handler for routes that do not match any defined endpoint.
 */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`Endpoint not found: ${req.method} ${req.originalUrl}`));
}

/**
 * Centralized Express Error Handling Middleware.
 * Normalizes all operational and unexpected errors into a consistent JSON response.
 */
export function errorHandler(
  err: Error | AppError | any,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const isProduction = process.env.NODE_ENV === 'production';

  // Normalize generic or library-specific errors
  let statusCode = 500;
  let errorCode = 'INTERNAL_SERVER_ERROR';
  let message = 'An unexpected internal server error occurred';
  let details: unknown = undefined;
  let isOperational = false;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    errorCode = err.errorCode;
    message = err.message;
    details = err.details;
    isOperational = err.isOperational;
  } else if (err.code === '23505') {
    // PostgreSQL Unique Constraint Violation
    statusCode = 409;
    errorCode = 'DUPLICATE_ENTRY';
    message = 'A record with matching unique values already exists';
    isOperational = true;
    details = err.detail;
  } else if (err.type === 'entity.parse.failed') {
    // Express JSON body-parser error
    statusCode = 400;
    errorCode = 'MALFORMED_JSON_PAYLOAD';
    message = 'Malformed JSON payload in request body';
    isOperational = true;
  } else if (err.name === 'ValidationError') {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
    message = err.message || 'Validation failed';
    details = err.errors;
    isOperational = true;
  }

  // Structured server-side logging
  const logPayload = {
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
    statusCode,
    errorCode,
    message: err.message,
    isOperational,
    stack: isOperational ? undefined : err.stack,
  };

  if (statusCode >= 500) {
    console.error('[Error: Critical Failure]', logPayload);
  } else {
    console.warn('[Error: Client Failure]', logPayload);
  }

  // Sanitize message for unexpected 500 errors in production
  const responseMessage =
    !isOperational && isProduction ? 'An internal server error occurred. Please try again later.' : message;

  res.status(statusCode).json({
    success: false,
    error: {
      code: errorCode,
      message: responseMessage,
      details: details ?? null,
      timestamp: new Date().toISOString(),
      path: req.originalUrl,
      ...(isProduction ? {} : { stack: err.stack }),
    },
  });
}

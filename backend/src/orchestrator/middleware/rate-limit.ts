import { rateLimit } from 'express-rate-limit';
import { env } from '../../config/env.js';

/**
 * Rate limiter for chat endpoint
 * Production: 20 requests per 15 minutes per IP
 * Development: 100 requests per 15 minutes per IP
 */
export const chatRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: env.NODE_ENV === 'production' ? 20 : 100,
  standardHeaders: true, // Return rate limit info in RateLimit-* headers
  legacyHeaders: false, // Disable X-RateLimit-* headers
  message: {
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please try again later.',
    },
  },
  // Skip rate limiting for health check and other safe endpoints
  skip: (req) => req.path === '/health',
});

/**
 * General API rate limiter
 * Production: 100 requests per 15 minutes per IP
 * Development: 500 requests per 15 minutes per IP
 */
export const generalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === 'production' ? 100 : 500,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health',
});

/**
 * Auth route rate limiter — strict to prevent brute-force attacks
 * Production: 5 requests per 15 minutes per IP
 * Development: 50 requests per 15 minutes per IP
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === 'production' ? 5 : 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many attempts. Please try again later.',
    },
  },
});

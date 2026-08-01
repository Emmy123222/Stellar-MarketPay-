// @ts-ignore
import cors from 'cors';
// @ts-ignore
import express from 'express';
// @ts-ignore
import morgan from 'morgan';
import { securityMiddleware } from './middleware/securityMiddleware';
import { createFlightRoutes } from './api/routes/flights';
import { bookingRoutes } from './api/routes/bookings';
import { refundRoutes } from './api/routes/refunds';
import { insuranceRoutes } from './api/routes/insurance';
import { groupBookingRoutes } from './api/routes/group-bookings';
import { securityRoutes } from './api/routes/security';
import { adminAuthRoutes } from './api/routes/admin/auth';
import { adminFlightRoutes } from './api/routes/admin/flights';
import { adminUserRoutes } from './api/routes/admin/users';
import { adminBookingRoutes } from './api/routes/admin/bookings';
import { adminAnalyticsRoutes } from './api/routes/admin/analytics';
import { adminRefundRoutes } from './api/routes/admin/refunds';
import { tenantAnalyticsRoutes } from './api/routes/admin/tenantAnalytics';
import { analyticsAuditRoutes } from './api/routes/admin/analyticsAudit';
import { collaborationRoutes } from './api/routes/collaboration';
import { authRoutes } from './api/routes/auth';
import disputeRoutes from './api/routes/disputes';
import serviceRoutes from './api/routes/services';
import contractEventRoutes from './api/routes/contract-events';
import transactionRoutes from './api/routes/transactions';
import checkinRoutes from './api/routes/checkin';
import journeyRoutes from './api/routes/journeys';
import { documentRoutes } from './api/routes/documents';
import { alertRoutes } from './api/routes/alerts';
import { reviewRoutes } from './api/routes/reviews';
import { userRoutes } from './api/routes/users';
import { carbonRoutes } from './api/routes/carbon';
import { trackingRoutes } from './api/routes/tracking';
import { feedbackRoutes } from './api/routes/feedback';
import { createCurrencyRoutes } from './api/routes/currencies';
import { referralRoutes } from './api/routes/referrals';
import { recommendationRoutes } from './api/routes/recommendations';
import { flightStatusRoutes } from './api/routes/flightStatus';
import { analyticsRoutes } from './api/routes/analytics';
import { messageRoutes } from './api/routes/messages';
// @ts-ignore
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from './api/openapi/generator';
import { validateRequest } from './middleware/validationMiddleware';

// @ts-ignore
import type { Application } from 'express';

import {
  createDefaultFlightSearchService,
  FlightSearchService,
} from './services/flightSearchService';
import { errorHandler, asyncHandler } from './utils/errorHandler';
import { logger } from './utils/logger';
import { cspMiddleware } from './middleware/csp';
import { rateLimitMiddleware } from './middleware/rate-limit';
import healthRouter from './routes/health';
import { metricsMiddleware } from './middleware/metricsMiddleware';
import { register } from './services/metrics';
import { AppDataSource } from './db/dataSource';
import { dbInitMiddleware } from './middleware/dbMiddleware';
import {
  createIpRateLimiter,
  createTieredRateLimiter,
  IpRateLimitOptions,
  TieredRateLimitOptions,
} from './utils/rateLimiter';
import { requireAuth } from './middleware/authMiddleware';
import { NotFoundError } from './utils/errors';
import { AppError } from './services/ErrorHandlingService';
import { requestLogger } from './middleware/requestLogger';
import { analyticsAuditLogger } from './middleware/audit-logger';

export interface AppOptions {
  flightSearchService?: FlightSearchService;
  globalRateLimit?: false | Partial<IpRateLimitOptions>;
  tieredRateLimit?: false | Partial<TieredRateLimitOptions>;
  searchRateLimit?: false | Partial<IpRateLimitOptions>;
}

export const createApp = async (options: AppOptions = {}) => {
  const app = express();
  const { config } = await import('./config');

  if (config.trustProxy) {
    app.set('trust proxy', 1);
  }

  const flightSearchService = options.flightSearchService || createDefaultFlightSearchService();

  const globalRateLimitMiddleware =
    options.globalRateLimit === false
      ? null
      : createIpRateLimiter({
        points: config.rateLimitMax,
        durationSeconds: config.rateLimitWindowSec,
        keyPrefix: 'traqora-global-rate-limit',
        ...options.globalRateLimit,
      });

  const tieredRateLimitMiddleware =
    options.tieredRateLimit === false
      ? null
      : createTieredRateLimiter({
        keyPrefix: 'traqora-tiered-rate-limit',
        redisUrl: config.redisUrl || undefined,
        trustProxy: config.trustProxy,
        useCloudflareHeaders: config.useCloudflareHeaders,
        public: {
          points: config.rateLimitPublicMax,
          durationSeconds: config.rateLimitWindowSec,
        },
        user: {
          points: config.rateLimitUserMax,
          durationSeconds: config.rateLimitWindowSec,
        },
        premium: {
          points: config.rateLimitPremiumMax,
          durationSeconds: config.rateLimitWindowSec,
        },
        ddos: {
          points: config.ddosBurstMax,
          durationSeconds: config.ddosBurstWindowSec,
        },
        blockDurationSeconds: config.rateLimitBlockDurationSec,
        blockAfterViolations: config.rateLimitBlockAfterViolations,
        captchaAfterViolations: config.captchaAfterViolations,
        ...options.tieredRateLimit,
      });

  const searchRateLimitMiddleware = createIpRateLimiter({
    points: 100,
    durationSeconds: 60,
    keyPrefix: 'traqora-flight-search-rate-limit',
    ...options.searchRateLimit,
  });

  app.use(cspMiddleware);
  app.use(rateLimitMiddleware);
  app.use('/health', healthRouter);

  app.use(securityMiddleware);
  app.use(
    cors({
      origin: config.corsOrigin,
      credentials: true,
    })
  );

  if (globalRateLimitMiddleware) {
    app.use(globalRateLimitMiddleware);
  }

  if (tieredRateLimitMiddleware) {
    app.use(tieredRateLimitMiddleware);
  }

  app.use(requestLogger);
  app.use(metricsMiddleware);
  app.use(morgan('combined', { stream: { write: (message: string) => logger.info(message.trim()) } }));

  app.use(dbInitMiddleware);

  // Stripe webhook requires raw body — must be registered BEFORE express.json()
  app.use('/api/v1/bookings/webhook/stripe', express.raw({ type: '*/*' }));

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.get('/metrics', asyncHandler(async (_req: express.Request, res: express.Response) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  }));

  app.get('/readiness', asyncHandler(async (_req: express.Request, res: express.Response) => {
    if (!AppDataSource.isInitialized && config.databaseUrl) {
      throw new AppError('Database not initialized', { statusCode: 503, code: 'SERVICE_UNAVAILABLE' });
    }
    if (AppDataSource.isInitialized) {
      await AppDataSource.query('SELECT 1');
    }
    return res.json({ status: 'ready' });
  }));

  // OpenAPI documentation routes
  app.get('/api/openapi.json', (_req: express.Request, res: express.Response) => {
    res.json(openApiDocument);
  });

  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));

  app.use('/api/v1/alerts', requireAuth, alertRoutes);
  app.use('/api/v1/reviews', reviewRoutes);
  app.use('/api/v1/flight-status', flightStatusRoutes);
  app.use('/api/v1/analytics', analyticsRoutes);


  app.use('/api/v1/auth', validateRequest('/api/v1/auth/challenge'), validateRequest('/api/v1/auth/verify'), validateRequest('/api/v1/auth/refresh'), authRoutes);
  app.use('/api/v1/flights', createFlightRoutes(flightSearchService, searchRateLimitMiddleware));
  app.use('/api/flights', createFlightRoutes(flightSearchService, searchRateLimitMiddleware));
  app.use('/api/v1/bookings', requireAuth, bookingRoutes);
  app.use('/api/v1/refunds', requireAuth, refundRoutes);
  app.use('/api/v1/insurance', insuranceRoutes);
  app.use('/api/v1/group-bookings', requireAuth, groupBookingRoutes); // <-- Added group booking routes
  app.use('/api/v1/security', securityRoutes);
  app.use('/api/v1/documents', requireAuth, documentRoutes);
  app.use('/api/v1/referrals', referralRoutes);
  app.use('/api/v1/recommendations', recommendationRoutes);
  app.use('/api/v1/users', userRoutes);

  // Admin routes
  app.use('/api/v1/admin/auth', adminAuthRoutes);
  app.use('/api/v1/admin/flights', adminFlightRoutes);
  app.use('/api/v1/admin/users', adminUserRoutes);
  app.use('/api/v1/admin/bookings', adminBookingRoutes);
  app.use('/api/v1/admin/analytics', analyticsAuditRoutes);
  app.use('/api/v1/admin/analytics', analyticsAuditLogger);
  app.use('/api/v1/admin/analytics', adminAnalyticsRoutes);
  app.use('/api/v1/admin/analytics', tenantAnalyticsRoutes);
  app.use('/api/v1/admin/refunds', adminRefundRoutes);
  app.use('/api/v1/collaboration', collaborationRoutes);
  app.use('/api/v1/disputes', disputeRoutes);
  app.use('/api/v1/services', serviceRoutes);
  app.use('/api/v1/contract-events', contractEventRoutes);
  app.use('/api/v1/transactions', transactionRoutes);
  app.use('/api/v1/checkin', requireAuth, checkinRoutes);
  app.use('/api/v1/journeys', journeyRoutes);
  app.use('/api/v1/carbon', carbonRoutes);
  app.use('/api/v1/tracking', requireAuth, trackingRoutes);
  app.use('/api/v1/feedback', feedbackRoutes);
  app.use('/api/v1/currencies', createCurrencyRoutes());

  // Messaging routes (Issue #810)
  app.use('/api/v1/jobs', requireAuth, messageRoutes);

  app.use((_req: express.Request, _res: express.Response, next: express.NextFunction) => {
    next(new NotFoundError('Endpoint not found'));
  });

  app.use(errorHandler);

  return app;
};
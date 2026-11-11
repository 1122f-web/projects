import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { authRouter } from './routes/auth.js';
import { meRouter } from './routes/me.js';
import { publicRouter } from './routes/public.js';
import { doctorRouter } from './routes/doctor.js';
import { appointmentsRouter } from './routes/appointments.js';
import { conversationsRouter } from './routes/conversations.js';
import { notificationsRouter } from './routes/notifications.js';
import { reviewsRouter } from './routes/reviews.js';
import { adminRouter } from './routes/admin.js';
import { internalRouter } from './routes/internal.js';
import { prescriptionsRouter } from './routes/prescriptions.js';
import { documentsRouter } from './routes/documents.js'; // <-- 1. IMPORT DOCUMENTS ROUTER

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.TRUST_PROXY) app.set('trust proxy', config.TRUST_PROXY);

  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } }));
  app.use(
    cors({
      origin(origin, callback) {
        // Requests without an Origin header (curl, server-to-server) are allowed;
        // browsers are limited to the configured frontend origins.
        if (!origin || config.allowedOrigins.includes(origin)) return callback(null, true);
        callback(null, false);
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  app.use('/api', apiLimiter);
  app.use('/api/auth', authRouter);
  app.use('/api/me', meRouter);
  app.use('/api', publicRouter);
  app.use('/api/doctor', doctorRouter);
  app.use('/api/appointments', appointmentsRouter);
  app.use('/api/conversations', conversationsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/reviews', reviewsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/internal', internalRouter);
  app.use('/api/prescriptions', prescriptionsRouter);
  app.use('/api/documents', documentsRouter); // <-- 2. MOUNT DOCUMENTS ROUTER HERE

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
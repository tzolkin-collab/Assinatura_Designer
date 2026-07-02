import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { requireAuth } from './middleware/auth.js';
import { healthRouter } from './routes/health.js';
import { brandsRouter } from './routes/brands.js';
import { settingsRouter } from './routes/settings.js';
import { authRouter } from './routes/auth.js';
import { aiRouter } from './routes/ai.js';
import { postsRouter } from './routes/posts.js';
import { foldersRouter } from './routes/folders.js';
import { canvaRouter } from './routes/canva.js';
import { uploadRouter } from './routes/upload.js';
import { fabricaRouter } from './routes/fabrica.js';
import { asanaRouter } from './routes/asana.js';

const app = express();

// ── Global Middleware ──
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

// ── Routes ──
app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/brands', requireAuth, brandsRouter);
app.use('/api/settings', requireAuth, settingsRouter);
app.use('/api/ai', requireAuth, aiRouter);
app.use('/api/posts', requireAuth, postsRouter);
app.use('/api/folders', requireAuth, foldersRouter);
app.use('/api/upload', requireAuth, uploadRouter);
app.use('/api/fabrica', requireAuth, fabricaRouter);
app.use('/api/asana', requireAuth, asanaRouter);

// ── Canva Routes ──
// Callback must be public (browser redirect from Canva OAuth)
app.get('/api/canva/callback', canvaRouter);
// All other Canva routes require auth
app.use('/api/canva', requireAuth, canvaRouter);

// ── Error Handler (must be last) ──
app.use(errorHandler);

export { app };

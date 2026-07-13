import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestContext } from './middleware/requestContext.js';
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
import { teamRouter } from './routes/team.js';
import { assetsRouter } from './routes/assets.js';
import { notificationsRouter } from './routes/notifications.js';

const app = express();

// Confia em 1 hop de reverse proxy (Vercel/Render/etc.) para que `req.ip`
// reflita o cliente real — necessário para o rate limiting por IP.
app.set('trust proxy', 1);

// ── Global Middleware ──
// Cabeçalhos de segurança. Isto é uma API JSON: não serve HTML, então a CSP padrão
// do helmet (que existe para páginas) não tem o que proteger e só atrapalha se algum
// dia servirmos assets. O resto (HSTS, noSniff, frameguard, sem X-Powered-By) vale.
app.use(
  helmet({
    contentSecurityPolicy: false,
    // A API e o frontend vivem em origens diferentes; a política padrão `same-origin`
    // bloquearia respostas legítimas para o app.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(requestContext);

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
app.use('/api/brands/:brandId/members', requireAuth, teamRouter);
app.use('/api/brands/:brandId/assets', requireAuth, assetsRouter);
app.use('/api/notifications', requireAuth, notificationsRouter);

// ── Canva Routes ──
// Callback must be public (browser redirect from Canva OAuth)
app.get('/api/canva/callback', canvaRouter);
// All other Canva routes require auth
app.use('/api/canva', requireAuth, canvaRouter);

// ── Error Handler (must be last) ──
app.use(errorHandler);

export { app };

import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { config } from '../config.js';
import { createError } from '../middleware/errorHandler.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { ensureInternalTeamMemberships } from '../lib/internalTeam.js';
import { hashInviteToken } from '../lib/invites.js';
import { z } from 'zod';
import { parseBody } from '../lib/validate.js';
import { encryptToken } from '../lib/tokenCrypto.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { generateOAuthState, exchangeAuthorizationCode } from '../lib/connectorOAuth.js';

export const authRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const registerSchema = z.object({
  email: z.string().trim().regex(EMAIL_RE, 'Email inválido'),
  password: z.string().min(8, 'A senha deve ter ao menos 8 caracteres'),
  name: z.string().trim().min(1, 'Nome é obrigatório'),
});

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email é obrigatório'),
  password: z.string().min(1, 'Senha é obrigatória'),
});

const asanaTokenSchema = z.object({
  token: z.string().min(1, 'Asana token is required'),
});

const acceptInviteSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório.'),
  password: z.string().min(8, 'A senha deve ter ao menos 8 caracteres'),
});

// Hash "descartável" para igualar o custo do bcrypt quando o email não existe —
// sem ele, o login responde na hora para email inexistente e ~100ms para email
// real (o compare roda), permitindo enumerar contas por tempo de resposta.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('timing-equalizer-not-a-real-password', 10);

authRouter.post('/register', rateLimit({ windowSec: 3600, max: 5, keyPrefix: 'register' }), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, name } = parseBody(registerSchema, req.body);

    const exist = await prisma.user.findUnique({ where: { email } });
    if (exist) throw createError(409, 'Email already in use');

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
        // Role defaults to DESIGNER
      },
      select: { id: true, email: true, name: true, role: true } // don't return password
    });

    // Ferramenta interna: a conta nova já entra vendo todas as marcas da equipe.
    ensureInternalTeamMemberships().catch(() => {});

    const token = jwt.sign({ userId: user.id, role: user.role }, config.jwtSecret, { expiresIn: '7d' });

    res.status(201).json({ data: { user, token } });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/connections/asana - Configure Asana PAT
authRouter.post('/connections/asana', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { token } = parseBody(asanaTokenSchema, req.body);

    await prisma.user.update({
      where: { id: req.user!.userId },
      data: { asanaToken: encryptToken(token), asanaRefreshToken: null, asanaTokenExpiry: null }
    });

    res.json({ message: 'Asana token saved successfully' });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/auth/connections/asana - Remove Asana PAT
authRouter.delete('/connections/asana', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.user.update({
      where: { id: req.user!.userId },
      data: { asanaToken: null }
    });

    res.json({ message: 'Asana token removed successfully' });
  } catch (error) {
    next(error);
  }
});

// ── Convites de equipe ───────────────────────────────────────────────────────
// Rotas públicas: quem aceita o convite ainda não tem conta. A prova de acesso é o
// token do link (256 bits), cujo hash está no banco.

/** Busca o convite pelo token cru, validando expiração e uso. */
async function findUsableInvite(rawToken: string) {
  const invite = await prisma.invite.findUnique({
    where: { tokenHash: hashInviteToken(rawToken) },
    include: { brand: { select: { name: true, slug: true } } },
  });

  if (!invite) throw createError(404, 'Convite inválido.');
  if (invite.acceptedAt) throw createError(410, 'Este convite já foi usado.');
  if (invite.expiresAt.getTime() < Date.now()) throw createError(410, 'Este convite expirou.');

  return invite;
}

// GET /api/auth/invite/:token — dados para a tela de aceite (email, marca, role)
authRouter.get('/invite/:token', rateLimit({ windowSec: 900, max: 30, keyPrefix: 'invite-peek' }), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invite = await findUsableInvite(req.params.token as string);
    res.json({
      data: {
        email: invite.email,
        role: invite.role,
        brand: invite.brand,
        expiresAt: invite.expiresAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/invite/:token/accept — cria a conta e o vínculo, num passo só
authRouter.post('/invite/:token/accept', rateLimit({ windowSec: 3600, max: 10, keyPrefix: 'invite-accept' }), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawToken = req.params.token as string;
    const { name, password } = parseBody(acceptInviteSchema, req.body);

    const invite = await findUsableInvite(rawToken);

    // O email pode ter se registrado sozinho entre o convite e o aceite.
    const existing = await prisma.user.findUnique({ where: { email: invite.email }, select: { id: true } });
    if (existing) {
      throw createError(409, 'Já existe uma conta com este email. Faça login para acessar a marca.');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Tudo ou nada: sem transação, uma falha no meio deixaria a conta criada com o
    // convite ainda aberto (ou vínculo sem convite consumido).
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email: invite.email, name: name.trim(), password: hashedPassword },
        select: { id: true, email: true, name: true, role: true },
      });

      await tx.brandMember.create({
        data: { userId: created.id, brandId: invite.brandId, role: invite.role },
      });

      // Marca como aceito exigindo que ainda esteja aberto: se dois aceites correrem
      // em paralelo, o segundo não encontra a linha e a transação inteira falha.
      const consumed = await tx.invite.updateMany({
        where: { id: invite.id, acceptedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (consumed.count === 0) throw createError(410, 'Este convite já foi usado.');

      return created;
    });

    const token = jwt.sign({ userId: user.id, role: user.role }, config.jwtSecret, { expiresIn: '7d' });
    res.status(201).json({ data: { user, token } });
  } catch (error) {
    next(error);
  }
});

// Em dev o teto de 10/15min derruba o time testando contas diferentes na mesma
// máquina (todo mundo é o mesmo IP). O freio anti-brute-force é para produção.
authRouter.post('/login', rateLimit({ windowSec: 900, max: config.isDev ? 200 : 10, keyPrefix: 'login' }), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = parseBody(loginSchema, req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.password) {
      // Gasta o mesmo tempo de um compare real para não vazar a existência do email.
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      throw createError(401, 'Invalid credentials');
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) throw createError(401, 'Invalid credentials');

    const token = jwt.sign({ userId: user.id, role: user.role }, config.jwtSecret, { expiresIn: '7d' });

    res.json({
      data: {
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
        token,
      }
    });
  } catch (error) {
    next(error);
  }
});

// ── Google OAuth Login ──────────────────────────────────────────────────────

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

function parseCookies(req: Request): Record<string, string> {
  const list: Record<string, string> = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(';').forEach((cookie) => {
      const parts = cookie.split('=');
      if (parts.length >= 2) {
        list[parts[0].trim()] = decodeURIComponent(parts.slice(1).join('=').trim());
      }
    });
  }
  return list;
}

function getFrontendUrl(): string {
  const corsOrigins = config.corsOrigin.split(',').map((s) => s.trim()).filter(Boolean);
  return corsOrigins[0] || 'http://localhost:3000';
}

// GET /api/auth/google/login — inicia fluxo de login via Google OAuth2
authRouter.get('/google/login', (req: Request, res: Response, next: NextFunction) => {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw createError(500, 'GOOGLE_CLIENT_ID não está configurado no .env');
    }

    const redirectPath = (req.query.redirect as string) || '/galeria';
    const redirectUri = process.env.GOOGLE_OAUTH_LOGIN_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/auth/google/callback`;

    const stateNonce = generateOAuthState();
    const stateValue = `${stateNonce}:${redirectPath}`;

    res.setHeader(
      'Set-Cookie',
      `oauth_login_state=${encodeURIComponent(stateValue)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`
    );

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: stateNonce,
      prompt: 'select_account',
    });

    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

    if (req.headers.accept?.includes('application/json') || req.query.json === 'true') {
      res.json({ data: { url } });
    } else {
      res.redirect(url);
    }
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/google/callback — callback público do Google OAuth2 para login
authRouter.get('/google/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code, state, error } = req.query as { code?: string; state?: string; error?: string };

    if (error) {
      throw createError(400, `Google OAuth error: ${error}`);
    }
    if (!code || !state) {
      throw createError(400, 'Code e state são obrigatórios.');
    }

    const cookies = parseCookies(req);
    const rawStateCookie = cookies['oauth_login_state'] || '';
    const [savedNonce, savedRedirect] = rawStateCookie.split(':');

    if (!savedNonce || savedNonce !== state) {
      throw createError(400, 'Estado OAuth (CSRF) inválido ou expirado. Tente novamente.');
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_OAUTH_LOGIN_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/auth/google/callback`;

    if (!clientId || !clientSecret) {
      throw createError(500, 'Credenciais do Google (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) não configuradas no .env');
    }

    // Troca o code pelos tokens
    const tokens = await exchangeAuthorizationCode(GOOGLE_TOKEN_URL, {
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    // Busca dados do usuário no Google UserInfo
    const userInfoRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userInfoRes.ok) {
      const errText = await userInfoRes.text().catch(() => '');
      throw createError(500, `Falha ao buscar perfil do usuário no Google: ${errText.slice(0, 200)}`);
    }

    const userInfo = (await userInfoRes.json()) as { sub: string; email: string; name?: string };

    if (!userInfo.email) {
      throw createError(400, 'A conta do Google não forneceu um endereço de email válido.');
    }

    const normalizedEmail = userInfo.email.trim().toLowerCase();

    // 1. Busca por googleId
    let user = await prisma.user.findUnique({ where: { googleId: userInfo.sub } });

    if (!user) {
      // 2. Busca por email para vincular conta existente
      const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
      if (existingUser) {
        user = await prisma.user.update({
          where: { id: existingUser.id },
          data: { googleId: userInfo.sub },
        });
      } else {
        // 3. Cria nova conta
        user = await prisma.user.create({
          data: {
            email: normalizedEmail,
            name: userInfo.name || normalizedEmail.split('@')[0],
            googleId: userInfo.sub,
          },
        });
        ensureInternalTeamMemberships().catch(() => {});
      }
    }

    const token = jwt.sign({ userId: user.id, role: user.role }, config.jwtSecret, { expiresIn: '7d' });

    // Limpa o cookie de estado
    res.setHeader('Set-Cookie', 'oauth_login_state=; Path=/; HttpOnly; Max-Age=0');

    const frontendUrl = getFrontendUrl();
    const finalRedirect = savedRedirect && savedRedirect.startsWith('/') ? savedRedirect : '/galeria';
    res.redirect(`${frontendUrl}/auth/callback?token=${encodeURIComponent(token)}&next=${encodeURIComponent(finalRedirect)}`);
  } catch (error) {
    next(error);
  }
});

authRouter.get('/me', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { 
        id: true, 
        email: true, 
        name: true, 
        role: true,
        asanaToken: true,
        googleAccessToken: true,
        googleRefreshToken: true
      }
    });
    if (!user) throw createError(404, 'User not found');
    
    // Format response so frontend gets nice booleans for connections
    const { asanaToken, googleAccessToken, googleRefreshToken, ...safeUser } = user;
    res.json({ 
      data: {
        ...safeUser,
        connections: {
          asana: !!asanaToken,
          drive: !!googleAccessToken || !!googleRefreshToken
        }
      } 
    });
  } catch (error) {
    next(error);
  }
});


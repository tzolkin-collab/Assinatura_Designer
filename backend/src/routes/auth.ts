import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { config } from '../config.js';
import { createError } from '../middleware/errorHandler.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { hashInviteToken } from '../lib/invites.js';

export const authRouter = Router();

// Hash "descartável" para igualar o custo do bcrypt quando o email não existe —
// sem ele, o login responde na hora para email inexistente e ~100ms para email
// real (o compare roda), permitindo enumerar contas por tempo de resposta.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('timing-equalizer-not-a-real-password', 10);

authRouter.post('/register', rateLimit({ windowSec: 3600, max: 5, keyPrefix: 'register' }), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      throw createError(400, 'Email, password, and name are required');
    }
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw createError(400, 'Email inválido');
    }
    if (typeof password !== 'string' || password.length < 8) {
      throw createError(400, 'A senha deve ter ao menos 8 caracteres');
    }

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

    const token = jwt.sign({ userId: user.id, role: user.role }, config.jwtSecret, { expiresIn: '7d' });

    res.status(201).json({ data: { user, token } });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/connections/asana - Configure Asana PAT
authRouter.post('/connections/asana', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { token } = req.body;
    if (!token) throw createError(400, 'Asana token is required');

    await prisma.user.update({
      where: { id: req.user!.userId },
      data: { asanaToken: token }
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
    const { name, password } = req.body as { name?: unknown; password?: unknown };

    if (typeof name !== 'string' || name.trim().length === 0) {
      throw createError(400, 'Nome é obrigatório.');
    }
    if (typeof password !== 'string' || password.length < 8) {
      throw createError(400, 'A senha deve ter ao menos 8 caracteres');
    }

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
    const { email, password } = req.body;
    if (!email || !password) throw createError(400, 'Email and password required');

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
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

// A protected route to test auth
import { requireAuth, AuthRequest } from '../middleware/auth.js';
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

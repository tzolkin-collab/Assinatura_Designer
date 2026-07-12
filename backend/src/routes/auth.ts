import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { config } from '../config.js';
import { createError } from '../middleware/errorHandler.js';

export const authRouter = Router();

// Hash "descartável" para igualar o custo do bcrypt quando o email não existe —
// sem ele, o login responde na hora para email inexistente e ~100ms para email
// real (o compare roda), permitindo enumerar contas por tempo de resposta.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('timing-equalizer-not-a-real-password', 10);

authRouter.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      throw createError(400, 'Email, password, and name are required');
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

authRouter.post('/login', async (req: Request, res: Response, next: NextFunction) => {
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

import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma.js';
import type { AuthRequest } from '../middleware/auth.js';

export const notificationsRouter = Router();

// GET /api/notifications
notificationsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthRequest).user!;
    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20
    });
    res.json({ data: notifications });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/notifications/:id/read
notificationsRouter.patch('/:id/read', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthRequest).user!;
    const notificationId = req.params.id as string;
    const notification = await prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { read: true }
    });
    res.json({ data: notification });
  } catch (error) {
    next(error);
  }
});

// POST /api/notifications/read-all
notificationsRouter.post('/read-all', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthRequest).user!;
    await prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true }
    });
    res.json({ message: 'Todas as notificações marcadas como lidas.' });
  } catch (error) {
    next(error);
  }
});

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { createError } from './errorHandler.js';
import { enrichAiContext } from '../lib/aiContext.js';
import { authenticatePreviewRequest, isPreviewToken, type PreviewRequestInfo } from './previewSession.js';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    role: string;
  };
  /** Presente só em sessão de navegador do agente (`designer.preview`): somente leitura, marcas da conexão. */
  preview?: PreviewRequestInfo;
}

export const requireAuth = (req: AuthRequest, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ') && isPreviewToken(header.slice(7))) {
    // Sessão do agente: token opaco `mcpv_...`, não é JWT. Toda a trava está em previewSession.ts.
    authenticatePreviewRequest(req, header.slice(7)).then(() => next(), next);
    return;
  }
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw createError(401, 'Unauthorized — Missing Token');
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, config.jwtSecret) as { userId: string; role: string };

    req.user = decoded;
    enrichAiContext({ userId: decoded.userId }); // log e teto de IA sabem de quem é
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return next(createError(401, 'Unauthorized — Invalid Token'));
    }
    
    return next(error);
  }
};

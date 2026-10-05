import type { Request, Response, NextFunction } from 'express';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
}

export const errorHandler = (
  err: AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  // InvalidSvgError (lib/svgSanitize) não conhece HTTP: quem decide é a borda. SVG que
  // não é SVG é erro do cliente, não do servidor.
  const statusCode = err.statusCode || (err.code === 'INVALID_SVG' ? 400 : 500);
  const message = err.message || 'Internal server error';

  console.error(`[ERROR] ${statusCode} - ${message}`);

  res.status(statusCode).json({
    error: {
      message,
      code: err.code || 'INTERNAL_ERROR',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  });
};

export const createError = (statusCode: number, message: string, code?: string): AppError => {
  const error = new Error(message) as AppError;
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  databaseUrl: process.env.DATABASE_URL || '',
  jwtSecret: process.env.JWT_SECRET || 'fallback-dev-secret',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  // Cérebro de design padrão: Gemini 3.1 Pro (multimodal). Override via env.
  // (gemini-3-pro-preview foi descontinuado no endpoint de geração; 3.1 é o pro atual.)
  geminiDesignDocumentModel: process.env.GEMINI_DESIGN_DOCUMENT_MODEL || 'gemini-3.1-pro-preview',
  nanoBananaApiKey: process.env.NANO_BANANA_API_KEY || '',
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: process.env.NODE_ENV !== 'production',
  // ── Cloudflare R2 ──
  r2Endpoint: process.env.R2_ENDPOINT || '',
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID || '',
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  r2BucketName: process.env.R2_BUCKET_NAME || '',
  r2PublicUrl: process.env.R2_PUBLIC_URL || '',
  // ── Redis ──
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  // ── Canva Connect API ──
  canvaClientId: process.env.CANVA_CLIENT_ID || '',
  canvaClientSecret: process.env.CANVA_CLIENT_SECRET || '',
  canvaRedirectUri: process.env.CANVA_REDIRECT_URI || 'http://localhost:4000/api/canva/callback',
  canvaScopes: 'design:content:read design:content:write design:meta:read asset:read asset:write folder:read folder:write profile:read',
} as const;

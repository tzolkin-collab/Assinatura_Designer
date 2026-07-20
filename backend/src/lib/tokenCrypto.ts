import crypto from 'crypto';
import { config } from '../config.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 16;
const TAG_LEN = 16;
const SALT = 'designer-canva-token-v1';

function getEncryptionKey(): Buffer {
  const source = config.canvaTokenEncryptionKey || config.jwtSecret;
  if (!source) {
    throw new Error('CANVA_TOKEN_ENCRYPTION_KEY ou JWT_SECRET devem estar configurados para criptografia de tokens.');
  }
  // PBKDF2 é lento de propósito: dificulta brute-force se alguém tiver acesso ao banco.
  return crypto.pbkdf2Sync(source, SALT, 100_000, KEY_LEN, 'sha256');
}

/**
 * Criptografa um token de texto plano usando AES-256-GCM.
 * Retorna base64(iv + tag + ciphertext).
 */
export function encryptToken(plainText: string): string {
  const iv = crypto.randomBytes(IV_LEN);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/**
 * Descriptografa um token criptografado por encryptToken.
 * Lança erro se o formato for inválido ou a autenticação falhar.
 */
export function decryptToken(cipherText: string): string {
  const buf = Buffer.from(cipherText, 'base64');
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error('Token criptografado inválido: comprimento insuficiente.');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const encrypted = buf.subarray(IV_LEN + TAG_LEN);
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

/**
 * Tenta descriptografar um token. Se falhar, assume que o token ainda está em
 * plain text (período de migração) e retorna o valor original.
 */
export function tryDecryptToken(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return decryptToken(value);
  } catch {
    return value;
  }
}

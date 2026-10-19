import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prismaMock } from './client';
import { app } from '../app';
import { config } from '../config';
import { getRootAdminConfig, isRootAdminLogin, rootAdminDbEmail, verifyRootAdminPassword } from '../lib/rootAdmin';

// Login "rootSystem" definido por .env: sem hash no ambiente fica desligado; com hash, só a senha certa
// entra, como ADMIN, e o login comum por e-mail continua igual.

const SENHA = 'senha-de-teste-bem-longa';
const hash = bcrypt.hashSync(SENHA, 4);

describe('lib/rootAdmin', () => {
  it('desligado sem ROOT_ADMIN_PASSWORD_HASH', async () => {
    expect(getRootAdminConfig({})).toBeNull();
    expect(isRootAdminLogin('rootSystem', {})).toBe(false);
    expect(await verifyRootAdminPassword(SENHA, {})).toBe(false);
  });

  it('login padrão rootSystem, sem diferenciar maiúsculas', () => {
    const env = { ROOT_ADMIN_PASSWORD_HASH: hash };
    expect(isRootAdminLogin('rootSystem', env)).toBe(true);
    expect(isRootAdminLogin('  ROOTSYSTEM ', env)).toBe(true);
    expect(isRootAdminLogin('outro@x.com', env)).toBe(false);
    expect(rootAdminDbEmail(env)).toBe('rootsystem');
  });

  it('o nome do login pode vir de ROOT_ADMIN_LOGIN', () => {
    const env = { ROOT_ADMIN_PASSWORD_HASH: hash, ROOT_ADMIN_LOGIN: 'chave' };
    expect(isRootAdminLogin('chave', env)).toBe(true);
    expect(isRootAdminLogin('rootSystem', env)).toBe(false);
  });

  it('confere a senha contra o hash e recusa hash malformado', async () => {
    expect(await verifyRootAdminPassword(SENHA, { ROOT_ADMIN_PASSWORD_HASH: hash })).toBe(true);
    expect(await verifyRootAdminPassword('errada', { ROOT_ADMIN_PASSWORD_HASH: hash })).toBe(false);
    expect(await verifyRootAdminPassword(SENHA, { ROOT_ADMIN_PASSWORD_HASH: 'nao-e-um-hash' })).toBe(false);
  });
});

describe('POST /api/auth/login — rootSystem', () => {
  const original = { ...process.env };

  beforeEach(() => {
    prismaMock.user.findUnique = vi.fn().mockResolvedValue(null);
    prismaMock.user.upsert = vi.fn().mockResolvedValue({ id: 'root-1', email: 'rootsystem', name: 'rootSystem', role: 'ADMIN' });
  });
  afterEach(() => {
    process.env = { ...original };
  });

  it('com a senha certa entra como ADMIN, sem exigir domínio de e-mail', async () => {
    process.env.ROOT_ADMIN_PASSWORD_HASH = hash;
    const res = await request(app).post('/api/auth/login').send({ email: 'rootSystem', password: SENHA });
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ name: 'rootSystem', role: 'ADMIN' });
    const payload = jwt.verify(res.body.data.token, config.jwtSecret) as { userId: string; role: string };
    expect(payload).toMatchObject({ userId: 'root-1', role: 'ADMIN' });
    expect(prismaMock.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'rootsystem' }, update: { role: 'ADMIN' } }),
    );
  });

  it('401 com a senha errada e não cai na busca por e-mail', async () => {
    process.env.ROOT_ADMIN_PASSWORD_HASH = hash;
    const res = await request(app).post('/api/auth/login').send({ email: 'rootSystem', password: 'errada' });
    expect(res.status).toBe(401);
    expect(prismaMock.user.upsert).not.toHaveBeenCalled();
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('desligado (sem hash): rootSystem é só um e-mail desconhecido', async () => {
    delete process.env.ROOT_ADMIN_PASSWORD_HASH;
    const res = await request(app).post('/api/auth/login').send({ email: 'rootSystem', password: SENHA });
    expect(res.status).toBe(401);
    expect(prismaMock.user.upsert).not.toHaveBeenCalled();
  });

  it('o login comum por e-mail segue igual com o root ligado', async () => {
    process.env.ROOT_ADMIN_PASSWORD_HASH = hash;
    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'qualquer' });
    expect(res.status).toBe(401);
    expect(prismaMock.user.findUnique).toHaveBeenCalled();
    expect(prismaMock.user.upsert).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import './client';
import { app } from '../app';

vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn(),
    sign: vi.fn(() => 'jwt'),
    JsonWebTokenError: class JsonWebTokenError extends Error {},
  }
}));

describe('Cabeçalhos de segurança (helmet)', () => {
  it('não vaza a stack do servidor via X-Powered-By', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('impede MIME sniffing', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('bloqueia enquadramento em iframe (clickjacking)', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('exige HTTPS nas próximas visitas (HSTS)', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['strict-transport-security']).toContain('max-age=');
  });
});

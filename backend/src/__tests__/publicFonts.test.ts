import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const load = vi.fn();
vi.mock('../lib/customFonts.js', async (orig) => ({ ...(await orig<typeof import('../lib/customFonts.js')>()), loadFontAsset: (...a: unknown[]) => load(...a) }));

import { publicFontsRouter } from '../routes/publicFonts.js';

const app = express();
app.use('/api/public/fonts', publicFontsRouter);

describe('GET /api/public/fonts/:assetId', () => {
  it('entrega a fonte com CORS aberto, tipo certo e cache', async () => {
    load.mockResolvedValueOnce({ buf: Buffer.from('FONTDATA'), format: 'opentype' });
    const res = await request(app).get('/api/public/fonts/asset-queens');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['content-type']).toContain('font/otf');
    expect(res.headers['cache-control']).toContain('immutable');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
  it('asset que não é fonte (ou não existe): 404, sem vazar nada', async () => {
    load.mockResolvedValueOnce(null);
    const res = await request(app).get('/api/public/fonts/asset-foto1');
    expect(res.status).toBe(404);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('id malformado nem consulta o banco', async () => {
    load.mockClear();
    const res = await request(app).get('/api/public/fonts/..%2Fx');
    expect(res.status).toBe(404);
    expect(load).not.toHaveBeenCalled();
  });
});

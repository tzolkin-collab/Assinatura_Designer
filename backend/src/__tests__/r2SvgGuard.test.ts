// Rede de segurança dentro do próprio uploadFileToR2: quem esquecer de higienizar na
// rota (ou um caller futuro) ainda não consegue gravar SVG sujo nem Content-Type ativo.
// O S3 é espionado — nada vai ao R2 real.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { config } from '../config';
import { s3, uploadFileToR2 } from '../lib/r2';
import { sanitizeSvg } from '../lib/svgSanitize';

const XMLNS = 'xmlns="http://www.w3.org/2000/svg"';
const SVG_SUJO = `<svg ${XMLNS} onload=alert(1)><script>alert(1)</script ><rect width="10" height="10"/></svg>`;

let send: ReturnType<typeof vi.spyOn>;

function ultimoPut(): { Body: Buffer; ContentType: string; ContentDisposition?: string; Key: string } {
  const call = send.mock.calls.at(-1)!;
  return (call[0] as { input: never }).input;
}

beforeEach(() => {
  Object.assign(config, {
    r2Endpoint: 'https://r2.exemplo.com',
    r2AccessKeyId: 'k',
    r2SecretAccessKey: 's',
    r2BucketName: 'bucket',
    r2PublicUrl: 'https://cdn.exemplo.com',
  });
  send = vi.spyOn(s3, 'send').mockResolvedValue({} as never);
  send.mockClear(); // o spy é reaproveitado entre testes: sem isto as chamadas acumulam
});

describe('uploadFileToR2 — guarda de SVG/HTML', () => {
  it('SVG sujo é higienizado e gravado como image/svg+xml + attachment', async () => {
    const url = await uploadFileToR2(Buffer.from(SVG_SUJO), 'logo.svg', 'image/svg+xml', 'brands/b1');

    expect(url).toMatch(/^https:\/\/cdn\.exemplo\.com\/brands\/b1\/[0-9a-f-]+-logo\.svg$/);
    const put = ultimoPut();
    const texto = put.Body.toString('utf-8');
    expect(texto).not.toMatch(/<script|onload/i);
    expect(texto).toContain('<rect');
    expect(put.ContentType).toBe('image/svg+xml');
    expect(put.ContentDisposition).toBe('attachment');
  });

  it('o cliente não escolhe o Content-Type: .svg declarado como text/html sai image/svg+xml', async () => {
    await uploadFileToR2(Buffer.from(SVG_SUJO), 'x.svg', 'text/html', 'uploads');
    expect(ultimoPut().ContentType).toBe('image/svg+xml');
    expect(ultimoPut().Body.toString('utf-8')).not.toMatch(/<script/i);
  });

  it('HTML/XML de verdade vira octet-stream + attachment (nunca text/html servido do bucket)', async () => {
    for (const mime of ['text/html', 'application/xhtml+xml', 'text/xml']) {
      await uploadFileToR2(Buffer.from('<html><script>alert(1)</script></html>'), 'p.html', mime, 'uploads');
      expect(ultimoPut().ContentType).toBe('application/octet-stream');
      expect(ultimoPut().ContentDisposition).toBe('attachment');
    }
  });

  it('SVG inválido rejeita e não escreve nada', async () => {
    await expect(uploadFileToR2(Buffer.from('<html/>'), 'x.svg', 'image/svg+xml')).rejects.toMatchObject({ code: 'INVALID_SVG' });
    expect(send).not.toHaveBeenCalled();
  });

  it('SVG já higienizado pela rota não é reprocessado (mesmo buffer segue ao S3)', async () => {
    const limpo = sanitizeSvg(SVG_SUJO).buffer;
    await uploadFileToR2(limpo, 'a.svg', 'image/svg+xml');
    expect(ultimoPut().Body).toBe(limpo);
  });

  it('raster e demais tipos passam como vieram, sem Content-Disposition', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await uploadFileToR2(png, 'a.png', 'image/png');
    expect(ultimoPut().Body).toBe(png);
    expect(ultimoPut().ContentType).toBe('image/png');
    expect(ultimoPut().ContentDisposition).toBeUndefined();

    await uploadFileToR2(Buffer.from('# roteiro'), 'roteiro.md', 'text/markdown', 'roteiros');
    expect(ultimoPut().ContentType).toBe('text/markdown');
  });
});

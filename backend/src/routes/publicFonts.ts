import { Router } from 'express';
import { loadFontAsset, fontMime } from '../lib/customFonts.js';

// Serve o arquivo de uma fonte própria da marca para o navegador carregar via @font-face.
// O R2 público não manda CORS e o navegador recusa fonte de outra origem sem ele; esta rota é o
// intermediário (o preview roda no front, que é outra origem). Só entrega arquivo que é fonte de
// verdade (conferido pelo conteúdo); qualquer outro asset responde 404. O id é um UUID não adivinhável,
// e a fonte já é pública na URL do R2: nada novo é exposto.
export const publicFontsRouter = Router();

publicFontsRouter.get('/:assetId', async (req, res, next) => {
  try {
    const assetId = String(req.params.assetId ?? '');
    if (!/^[\w-]{8,64}$/.test(assetId)) return res.status(404).end();
    const font = await loadFontAsset(assetId);
    if (!font) return res.status(404).end();
    res.removeHeader('Access-Control-Allow-Credentials'); // com ACAO * o navegador recusa credenciais
    res.set({
      'Content-Type': fontMime(font.format),
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Cache-Control': 'public, max-age=86400, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(font.buf);
  } catch (e) {
    next(e);
  }
});

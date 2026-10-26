// Mede o fundo exato e deriva a versão transparente de cada logo da ficha, ao salvar.
//
// O resultado fica na própria ficha (`bgHex`, `ink`, `transparentUrl`), então o brief só lê. Um logo já medido
// (mesma URL) reaproveita o que já tem: salvar a ficha não refaz nem reenvia nada. Só baixa arquivos do nosso
// bucket (a URL já passou pela checagem de que o logo é da biblioteca do projeto). Falha de medição não derruba
// o salvamento: o logo fica sem os campos e o brief usa a regra de sempre.

import { analyzeLogo } from './logoBackground.js';
import { logger } from './logger.js';
import { r2KeyFromUrl, uploadFileToR2 } from './r2.js';

export interface LogoFileMeasured {
  url: string;
  label?: string;
  bgHex?: string;
  ink?: string;
  transparentUrl?: string;
}

export async function enrichLogoFiles<T extends LogoFileMeasured>(files: T[], previous: LogoFileMeasured[] = []): Promise<T[]> {
  const before = new Map(previous.map((f) => [f.url, f]));
  const out: T[] = [];
  for (const f of files) {
    const known = before.get(f.url);
    // Campos medidos nunca vêm do cliente: ou são os já gravados para esta URL, ou são medidos agora.
    const base = { ...f, bgHex: undefined, ink: undefined, transparentUrl: undefined };
    if (known?.bgHex) {
      out.push({ ...base, bgHex: known.bgHex, ink: known.ink, transparentUrl: known.transparentUrl });
      continue;
    }
    out.push(await measure(base));
  }
  return out;
}

async function measure<T extends LogoFileMeasured>(f: T): Promise<T> {
  if (!r2KeyFromUrl(f.url)) return f;
  try {
    const res = await fetch(f.url);
    if (!res.ok) return f;
    const a = await analyzeLogo(Buffer.from(await res.arrayBuffer()));
    const next: T = { ...f };
    if (a.bgHex) next.bgHex = a.bgHex;
    if (a.twoColor && a.ink) next.ink = a.ink;
    if (a.transparentPng) next.transparentUrl = await uploadFileToR2(a.transparentPng, 'logo-transparente.png', 'image/png', 'logos');
    return next;
  } catch (err) {
    logger.warn('logo: não foi possível medir o fundo', { url: f.url, err: String(err) });
    return f;
  }
}

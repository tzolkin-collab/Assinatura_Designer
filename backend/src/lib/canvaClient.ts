import crypto from 'crypto';
import { config } from '../config.js';
import prisma from './prisma.js';
import { encryptToken, tryDecryptToken } from './tokenCrypto.js';
import { generateOAuthState, isTokenExpiringSoon } from './connectorOAuth.js';

const CANVA_API_BASE = 'https://api.canva.com/rest/v1';
const CANVA_AUTH_BASE = 'https://www.canva.com/api/oauth';
const CANVA_TOKEN_URL = 'https://api.canva.com/rest/v1/oauth/token';

// ── PKCE Helpers ──

export function generateCodeVerifier(): string {
  return crypto.randomBytes(64).toString('base64url');
}

export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export { generateOAuthState };

// ── Authorization URL Builder ──

export function buildAuthorizationUrl(codeChallenge: string, state: string): string {
  const params = new URLSearchParams({
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    scope: config.canvaScopes,
    response_type: 'code',
    client_id: config.canvaClientId,
    state,
    redirect_uri: config.canvaRedirectUri,
  });
  return `${CANVA_AUTH_BASE}/authorize?${params.toString()}`;
}

// ── Basic Auth Header (client_id:client_secret) ──

function getBasicAuthHeader(): string {
  const credentials = Buffer.from(`${config.canvaClientId}:${config.canvaClientSecret}`).toString('base64');
  return `Basic ${credentials}`;
}

// ── Token Exchange ──

export interface CanvaTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number; // seconds
  scope: string;
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string
): Promise<CanvaTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    redirect_uri: config.canvaRedirectUri,
  });

  const response = await fetch(CANVA_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: getBasicAuthHeader(),
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Canva token exchange failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<CanvaTokenResponse>;
}

export async function refreshAccessToken(refreshToken: string): Promise<CanvaTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const response = await fetch(CANVA_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: getBasicAuthHeader(),
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Canva token refresh failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<CanvaTokenResponse>;
}

// ── Session Errors ──

export class CanvaSessionExpiredError extends Error {
  public readonly code = 'CANVA_SESSION_EXPIRED';
  public readonly statusCode = 401;
  constructor(message = 'Sessão do Canva expirada. Reconecte a integração.') {
    super(message);
    this.name = 'CanvaSessionExpiredError';
  }
}

// ── Authenticated API Client ──

/**
 * Gets a valid access token for a user (the designer's own Canva account),
 * refreshing if expired. Returns null if the user has no Canva connection.
 * Throws CanvaSessionExpiredError if the refresh token is invalid/revoked.
 */
export async function getValidAccessToken(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { canvaAccessToken: true, canvaRefreshToken: true, canvaTokenExpiry: true },
  });

  const accessToken = tryDecryptToken(user?.canvaAccessToken);
  const refreshToken = tryDecryptToken(user?.canvaRefreshToken);
  if (!accessToken || !refreshToken) return null;

  // If token expires within 5 minutes (ou expiração desconhecida), refresh it
  if (isTokenExpiringSoon(user?.canvaTokenExpiry)) {
    try {
      const tokens = await refreshAccessToken(refreshToken);
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

      await prisma.user.update({
        where: { id: userId },
        data: {
          canvaAccessToken: encryptToken(tokens.access_token),
          canvaRefreshToken: encryptToken(tokens.refresh_token),
          canvaTokenExpiry: expiresAt,
        },
      });

      return tokens.access_token;
    } catch (error) {
      console.error('[Canva] Token refresh failed:', error);
      // Sessão expirada ou revogada: limpa tokens para forçar reconexão.
      await prisma.user.update({
        where: { id: userId },
        data: {
          canvaAccessToken: null,
          canvaRefreshToken: null,
          canvaTokenExpiry: null,
          canvaUserId: null,
        },
      });
      throw new CanvaSessionExpiredError();
    }
  }

  return accessToken;
}

/**
 * Faz requisição autenticada à API do Canva com retry em erros transitórios.
 */
export async function canvaFetch(
  userId: string,
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    throw new Error('Canva não conectado para este usuário');
  }

  const url = `${CANVA_API_BASE}${path}`;
  const baseHeaders: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    ...(options.headers as Record<string, string> || {}),
  };

  // Set Content-Type for JSON bodies if not already set
  if (options.body && typeof options.body === 'string' && !baseHeaders['Content-Type']) {
    baseHeaders['Content-Type'] = 'application/json';
  }

  const maxAttempts = 3;
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(url, {
      ...options,
      headers: baseHeaders,
    });

    if (response.ok || response.status === 401 || response.status === 403) {
      return response;
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const delayMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 1000 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    if (response.status >= 500 && response.status < 600) {
      const delayMs = 1000 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    // 4xx não-recuperável: retorna sem retry.
    return response;
  }

  throw lastError || new Error(`Canva API request failed after ${maxAttempts} attempts: ${path}`);
}

// ── High-Level API Methods ──

export async function getCanvaUser(userId: string) {
  const response = await canvaFetch(userId, '/users/me');
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Canva /users/me failed (${response.status}): ${text}`);
  }
  return response.json();
}

export async function createDesign(
  userId: string,
  options: {
    design_type?: { type: string; width?: number; height?: number };
    title?: string;
    asset_id?: string;
  }
) {
  const response = await canvaFetch(userId, '/designs', {
    method: 'POST',
    body: JSON.stringify(options),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Canva create design failed (${response.status}): ${text}`);
  }
  return response.json();
}

export async function getDesign(userId: string, designId: string) {
  const response = await canvaFetch(userId, `/designs/${designId}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Canva get design failed (${response.status}): ${text}`);
  }
  return response.json();
}

export async function uploadAsset(
  userId: string,
  buffer: Buffer,
  name: string,
  mimeType: string
) {
  const boundary = `----CanvaUpload${Date.now()}`;

  // Build multipart/form-data manually
  const metadataPart =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="asset_upload"\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${JSON.stringify({ name_base64: Buffer.from(name).toString('base64') })}\r\n`;

  const filePart =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="asset"; filename="${name}"\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`;

  const ending = `\r\n--${boundary}--\r\n`;

  const body = Buffer.concat([
    Buffer.from(metadataPart),
    Buffer.from(filePart),
    buffer,
    Buffer.from(ending),
  ]);

  const response = await canvaFetch(userId, '/asset-uploads', {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Canva asset upload failed (${response.status}): ${text}`);
  }
  return response.json();
}

// ── Upload de asset: é um JOB assíncrono ──────────────────────────────────────
// POST /asset-uploads devolve um job, não o asset. O `asset.id` só existe quando
// o job conclui — e é ele que o createDesign precisa. Antes ninguém esperava:
// o backend disparava os uploads e devolvia os jobs crus pro frontend.

interface CanvaAssetUploadJob {
  job?: { id?: string; status?: string; asset?: { id?: string }; error?: { message?: string } };
}

export async function getAssetUploadJob(userId: string, jobId: string): Promise<CanvaAssetUploadJob> {
  const response = await canvaFetch(userId, `/asset-uploads/${jobId}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Canva get asset upload failed (${response.status}): ${text}`);
  }
  return response.json() as Promise<CanvaAssetUploadJob>;
}

/** Sobe o buffer e espera o job de upload concluir. Devolve o assetId. */
export async function uploadAssetAndWait(
  userId: string,
  buffer: Buffer,
  name: string,
  mimeType: string,
  { timeoutMs = 120_000, intervalMs = 1500 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<string> {
  const created = (await uploadAsset(userId, buffer, name, mimeType)) as CanvaAssetUploadJob;

  // Alguns retornos já vêm com o asset pronto; nesse caso não há o que esperar.
  const immediate = created.job?.asset?.id;
  if (immediate) return immediate;

  const jobId = created.job?.id;
  if (!jobId) throw new Error('Canva não retornou job de upload do asset');

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await getAssetUploadJob(userId, jobId);
    const status = current.job?.status;

    if (status === 'success') {
      const assetId = current.job?.asset?.id;
      if (!assetId) throw new Error('Upload concluiu sem asset id');
      return assetId;
    }
    if (status === 'failed') {
      throw new Error(`Upload do asset falhou: ${current.job?.error?.message ?? 'motivo desconhecido'}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Upload do asset para o Canva excedeu o tempo limite');
}

/** Extrai o id/url do design, tolerando as duas formas de resposta da API. */
export function parseDesignResponse(raw: unknown): { id: string; url?: string } {
  const data = (raw ?? {}) as {
    id?: string;
    url?: string;
    design?: { id?: string; url?: string; urls?: { edit_url?: string; view_url?: string } };
  };
  const design = data.design ?? data;
  const id = design.id;
  if (!id) throw new Error('Canva não retornou o id do design');
  const url =
    (design as { urls?: { edit_url?: string; view_url?: string } }).urls?.edit_url ??
    (design as { urls?: { view_url?: string } }).urls?.view_url ??
    (design as { url?: string }).url;
  return { id, url };
}

// ── Merge: junta N designs de 1 página num único design multipágina ───────────
// É o que permite entregar um deck inteiro como UM design no Canva. Sem isto, um
// carrossel de 10 slides viraria 10 designs soltos.

export async function createDesignMerge(
  userId: string,
  sourceDesignIds: string[],
  title: string,
) {
  const response = await canvaFetch(userId, '/merges', {
    method: 'POST',
    body: JSON.stringify({
      type: 'create_new_design',
      title: title.slice(0, 255),
      operations: sourceDesignIds.map((designId) => ({
        type: 'insert_pages',
        source: { type: 'design', design_id: designId },
      })),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Canva merge failed (${response.status}): ${text}`);
  }
  return response.json();
}

export async function exportDesign(
  userId: string,
  designId: string,
  format: 'png' | 'jpg' | 'pdf' | 'mp4' | 'gif' = 'png'
) {
  const body: Record<string, unknown> = {
    design_id: designId,
    format: { type: format },
  };

  // PNG/JPG support quality and size options
  if (format === 'png' || format === 'jpg') {
    (body.format as Record<string, unknown>).quality = 'regular';
  }

  const response = await canvaFetch(userId, '/exports', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Canva export failed (${response.status}): ${text}`);
  }
  return response.json();
}

export async function getExportStatus(userId: string, exportId: string) {
  const response = await canvaFetch(userId, `/exports/${exportId}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Canva export status failed (${response.status}): ${text}`);
  }
  return response.json();
}

/**
 * Polls an export job until it completes or fails.
 * Returns the final export data with download URLs.
 */
export async function waitForExport(
  userId: string,
  exportId: string,
  maxAttempts = 30,
  intervalMs = 2000
): Promise<Record<string, unknown>> {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await getExportStatus(userId, exportId) as Record<string, unknown>;
    const job = result.job as Record<string, unknown> | undefined;

    if (job?.status === 'success') return result;
    if (job?.status === 'failed') throw new Error('Canva export job failed');

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Canva export timed out');
}

// ── URL Import: PPTX → design editável (Design Imports API) ───────────────────
// É o caminho que entrega EDITÁVEL de verdade — diferente do createDesign com
// asset_id (PNG rasterizado), aqui o Canva importa o PPTX e converte cada
// elemento (texto, forma, imagem) em objeto nativo. Exige uma URL PÚBLICA
// (o R2 resolve isso: sobe o PPTX, dá a URL, o Canva busca sozinho).
// Contrato verificado em canva.dev/docs/connect/api-reference/design-imports/
// (create-url-import-job, get-url-import-job) — 2026-07-21.

export async function createUrlImportJob(
  userId: string,
  url: string,
  title: string,
  mimeType: string,
) {
  const response = await canvaFetch(userId, '/url-imports', {
    method: 'POST',
    body: JSON.stringify({ title: title.slice(0, 255), url, mime_type: mimeType }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Canva URL import failed (${response.status}): ${text}`);
  }
  return response.json();
}

export async function getUrlImportJob(userId: string, jobId: string) {
  const response = await canvaFetch(userId, `/url-imports/${jobId}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Canva get URL import failed (${response.status}): ${text}`);
  }
  return response.json();
}

export interface CanvaUrlImportDesign {
  id: string;
  title?: string;
  urls?: { edit_url?: string; view_url?: string };
}

/** Faz polling até o job de import terminar (sucesso ou falha). */
export async function waitForUrlImport(
  userId: string,
  jobId: string,
  maxAttempts = 60,
  intervalMs = 3000,
): Promise<CanvaUrlImportDesign> {
  for (let i = 0; i < maxAttempts; i++) {
    const result = (await getUrlImportJob(userId, jobId)) as {
      job?: {
        status?: string;
        result?: { designs?: CanvaUrlImportDesign[] };
        error?: { code?: string; message?: string };
      };
    };
    const job = result.job;

    if (job?.status === 'success') {
      const design = job.result?.designs?.[0];
      if (!design) throw new Error('Canva concluiu o import mas não retornou nenhum design');
      return design;
    }
    if (job?.status === 'failed') {
      throw new Error(`Canva URL import falhou: ${job.error?.message ?? job.error?.code ?? 'motivo desconhecido'}`);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Canva URL import excedeu o tempo limite');
}

export async function autofillDesign(
  userId: string,
  brandTemplateId: string,
  data: Record<string, unknown>,
  title?: string
) {
  const body: Record<string, unknown> = {
    brand_template_id: brandTemplateId,
    data,
  };
  if (title) body.title = title;

  const response = await canvaFetch(userId, '/autofills', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Canva autofill failed (${response.status}): ${text}`);
  }
  return response.json();
}

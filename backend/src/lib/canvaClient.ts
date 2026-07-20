import crypto from 'crypto';
import { config } from '../config.js';
import prisma from './prisma.js';

const CANVA_API_BASE = 'https://api.canva.com/rest/v1';
const CANVA_AUTH_BASE = 'https://www.canva.com/api/oauth';

// ── PKCE Helpers ──

export function generateCodeVerifier(): string {
  return crypto.randomBytes(64).toString('base64url');
}

export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export function generateOAuthState(): string {
  return crypto.randomBytes(48).toString('base64url');
}

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

  const response = await fetch(`${CANVA_AUTH_BASE}/token`, {
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

  const response = await fetch(`${CANVA_AUTH_BASE}/token`, {
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

// ── Authenticated API Client ──

/**
 * Gets a valid access token for a user (the designer's own Canva account),
 * refreshing if expired. Returns null if the user has no Canva connection.
 */
export async function getValidAccessToken(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { canvaAccessToken: true, canvaRefreshToken: true, canvaTokenExpiry: true },
  });

  if (!user?.canvaAccessToken || !user.canvaRefreshToken) return null;

  // If token expires within 5 minutes (ou expiração desconhecida), refresh it
  const bufferMs = 5 * 60 * 1000;
  const expiresAtMs = user.canvaTokenExpiry?.getTime() ?? 0;
  if (expiresAtMs - bufferMs < Date.now()) {
    try {
      const tokens = await refreshAccessToken(user.canvaRefreshToken);
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

      await prisma.user.update({
        where: { id: userId },
        data: {
          canvaAccessToken: tokens.access_token,
          canvaRefreshToken: tokens.refresh_token,
          canvaTokenExpiry: expiresAt,
        },
      });

      return tokens.access_token;
    } catch (error) {
      console.error('[Canva] Token refresh failed:', error);
      return null;
    }
  }

  return user.canvaAccessToken;
}

/**
 * Makes an authenticated request to the Canva Connect API.
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
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    ...(options.headers as Record<string, string> || {}),
  };

  // Set Content-Type for JSON bodies if not already set
  if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  return fetch(url, {
    ...options,
    headers,
  });
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

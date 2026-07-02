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
 * Gets a valid access token for a brand, refreshing if expired.
 * Returns null if the brand has no Canva integration.
 */
export async function getValidAccessToken(brandId: string): Promise<string | null> {
  const integration = await prisma.canvaIntegration.findUnique({
    where: { brandId },
  });

  if (!integration) return null;

  // If token expires within 5 minutes, refresh it
  const bufferMs = 5 * 60 * 1000;
  if (integration.tokenExpiresAt.getTime() - bufferMs < Date.now()) {
    try {
      const tokens = await refreshAccessToken(integration.canvaRefreshToken);
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

      await prisma.canvaIntegration.update({
        where: { brandId },
        data: {
          canvaAccessToken: tokens.access_token,
          canvaRefreshToken: tokens.refresh_token,
          tokenExpiresAt: expiresAt,
        },
      });

      return tokens.access_token;
    } catch (error) {
      console.error('[Canva] Token refresh failed:', error);
      return null;
    }
  }

  return integration.canvaAccessToken;
}

/**
 * Makes an authenticated request to the Canva Connect API.
 */
export async function canvaFetch(
  brandId: string,
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const accessToken = await getValidAccessToken(brandId);
  if (!accessToken) {
    throw new Error('Canva integration not connected for this brand');
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

export async function getCanvaUser(brandId: string) {
  const response = await canvaFetch(brandId, '/users/me');
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Canva /users/me failed (${response.status}): ${text}`);
  }
  return response.json();
}

export async function createDesign(
  brandId: string,
  options: {
    design_type?: { type: string; width?: number; height?: number };
    title?: string;
    asset_id?: string;
  }
) {
  const response = await canvaFetch(brandId, '/designs', {
    method: 'POST',
    body: JSON.stringify(options),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Canva create design failed (${response.status}): ${text}`);
  }
  return response.json();
}

export async function getDesign(brandId: string, designId: string) {
  const response = await canvaFetch(brandId, `/designs/${designId}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Canva get design failed (${response.status}): ${text}`);
  }
  return response.json();
}

export async function uploadAsset(
  brandId: string,
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

  const response = await canvaFetch(brandId, '/asset-uploads', {
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

export async function exportDesign(
  brandId: string,
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

  const response = await canvaFetch(brandId, '/exports', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Canva export failed (${response.status}): ${text}`);
  }
  return response.json();
}

export async function getExportStatus(brandId: string, exportId: string) {
  const response = await canvaFetch(brandId, `/exports/${exportId}`);
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
  brandId: string,
  exportId: string,
  maxAttempts = 30,
  intervalMs = 2000
): Promise<Record<string, unknown>> {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await getExportStatus(brandId, exportId) as Record<string, unknown>;
    const job = result.job as Record<string, unknown> | undefined;

    if (job?.status === 'success') return result;
    if (job?.status === 'failed') throw new Error('Canva export job failed');

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Canva export timed out');
}

export async function autofillDesign(
  brandId: string,
  brandTemplateId: string,
  data: Record<string, unknown>,
  title?: string
) {
  const body: Record<string, unknown> = {
    brand_template_id: brandTemplateId,
    data,
  };
  if (title) body.title = title;

  const response = await canvaFetch(brandId, '/autofills', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Canva autofill failed (${response.status}): ${text}`);
  }
  return response.json();
}

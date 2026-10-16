import { z } from 'zod';
import prisma from '../../lib/prisma.js';
import { READ_SCOPE } from '../config.js';
import type { McpToolDefinition } from './types.js';

const inputSchema = {};

const outputSchema = {
  canva: z.object({ connected: z.boolean(), expiresAt: z.string().nullable() }),
  google: z.object({ connected: z.boolean() }),
  asana: z.object({ connected: z.boolean() }),
};

export const getIntegrationsStatusTool: McpToolDefinition<typeof inputSchema, typeof outputSchema> = {
  name: 'get_integrations_status',
  title: 'Ver as integrações do usuário',
  description:
    'Diz se o usuário conectou Canva, Google Drive e Asana ao Designer (só sim ou não, e quando o acesso ao Canva vence). ' +
    'Use antes de oferecer uma exportação para o Canva ou uma importação do Drive. Conectar e desconectar é feito pelo próprio ' +
    'usuário no app (Configurações > Integrações): você nunca recebe os tokens.',
  scope: READ_SCOPE,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema,
  outputSchema,

  async handler(ctx) {
    const user = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { canvaAccessToken: true, canvaTokenExpiry: true, googleAccessToken: true, asanaToken: true },
    });

    // Só booleanos e a data de validade: o token em si nunca sai do servidor.
    const canvaConnected = !!(user?.canvaAccessToken && user.canvaAccessToken.length > 0);
    const structured = {
      canva: { connected: canvaConnected, expiresAt: canvaConnected && user?.canvaTokenExpiry ? user.canvaTokenExpiry.toISOString() : null },
      google: { connected: !!user?.googleAccessToken },
      asana: { connected: !!user?.asanaToken },
    };
    const yes = (b: boolean) => (b ? 'conectado' : 'não conectado');
    const text = [
      `Canva: ${yes(structured.canva.connected)}${structured.canva.expiresAt ? ` (acesso vence em ${structured.canva.expiresAt})` : ''}`,
      `Google Drive: ${yes(structured.google.connected)}`,
      `Asana: ${yes(structured.asana.connected)}`,
      'Para conectar, o usuário abre Configurações > Integrações no Designer.',
    ].join('\n');
    return { text, structured };
  },
};

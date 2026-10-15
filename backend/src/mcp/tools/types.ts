import type { BrandRole } from '@prisma/client';
import type { z } from 'zod';
import type { McpScope } from '../config.js';

/**
 * Contrato de uma ferramenta MCP do Designer.
 *
 * A ferramenta só descreve O QUE faz (nome, texto, schema, escopo, anotações, handler).
 * Tudo que é segurança — escopo, associação à marca, registro de chamada, tratamento de
 * erro — acontece UMA vez, no `registry.ts`. Acrescentar uma ferramenta é criar um
 * arquivo e listá-lo em `tools/index.ts`; nada de segurança é copiado de uma ferramenta
 * para outra (e portanto nenhuma ferramenta nova consegue "esquecer" de checar a marca).
 */

/** Marca à qual ESTA chamada tem acesso: interseção (token aprovado) ∩ (associação atual). */
export interface BrandGrant {
  id: string;
  slug: string;
  name: string;
  role: BrandRole;
}

export interface McpCallContext {
  userId: string;
  clientId: string;
  familyId: string;
  /** Marcas permitidas para o escopo desta ferramenta, já conferidas no banco AGORA. */
  grants: BrandGrant[];
  /** Presente quando a ferramenta declara `brandArg`: a marca já autorizada. */
  brand?: BrandGrant;
  /** Origem do frontend, para links de preview/editor. */
  frontendOrigin?: string;
}

/** Anotações que o ChatGPT usa para decidir quando pedir confirmação ao usuário. */
export interface ToolAnnotationSet {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint: boolean;
  idempotentHint?: boolean;
}

export interface ToolOutput {
  /** Texto para o modelo ler (e para clientes que ignoram structuredContent). */
  text: string;
  /** Dados estruturados; precisam casar com o `outputSchema` da ferramenta. */
  structured: Record<string, unknown>;
}

/** Erro "esperado" do domínio: a mensagem é segura para o modelo/usuário ver. */
export class ToolUserError extends Error {
  constructor(
    message: string,
    /** Código curto e estável, é o que vai para o registro de chamadas. */
    readonly code: string,
  ) {
    super(message);
    this.name = 'ToolUserError';
  }
}

export interface McpToolDefinition<
  Input extends z.ZodRawShape = z.ZodRawShape,
  Output extends z.ZodRawShape = z.ZodRawShape,
> {
  /** snake_case em inglês (convenção do ecossistema MCP). */
  name: string;
  title: string;
  /** pt-BR, escrito para o MODELO decidir quando chamar: o que faz, quando usar, o que devolve. */
  description: string;
  /** Escopo OAuth exigido. O registro recusa token sem ele e anuncia em securitySchemes. */
  scope: McpScope;
  annotations: ToolAnnotationSet;
  inputSchema: Input;
  outputSchema: Output;
  /**
   * Nome do argumento que carrega o slug da marca. Se presente, o registro resolve e
   * autoriza a marca ANTES do handler (e recusa marca fora do escopo do token); o handler
   * recebe `ctx.brand`. Ferramentas sem marca (ex.: list_brands) omitem.
   */
  brandArg?: keyof Input & string;
  handler(ctx: McpCallContext, args: z.infer<z.ZodObject<Input>>): Promise<ToolOutput>;
}

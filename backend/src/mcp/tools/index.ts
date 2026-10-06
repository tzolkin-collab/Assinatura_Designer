import type { McpToolDefinition } from './types.js';
import { getBrandKitTool } from './getBrandKit.js';
import { listBrandsTool } from './listBrands.js';

/**
 * Catálogo de ferramentas do conector. Para a próxima etapa, acrescentar uma
 * ferramenta é: criar `tools/<nome>.ts` exportando um `McpToolDefinition` e listar
 * aqui. Escopo, autorização por marca, anotações, securitySchemes e registro de
 * chamadas são aplicados pelo `registry.ts` — não se repetem em cada arquivo.
 *
 * Planejadas (não implementadas nesta etapa): list_designs / get_design (leitura),
 * create_design / edit_design / pause_generation (escrita, `designer.write`), e a
 * leitura dos registros de chamadas.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const MCP_TOOLS: readonly McpToolDefinition<any, any>[] = [listBrandsTool, getBrandKitTool];

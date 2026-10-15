import type { McpToolDefinition } from './types.js';
import { getBrandKitTool } from './getBrandKit.js';
import { getDesignTool } from './getDesign.js';
import { getDesignerBriefTool } from './getDesignerBrief.js';
import { listBrandsTool } from './listBrands.js';
import { listDesignsTool } from './listDesigns.js';
import { savePresentationTool } from './savePresentation.js';

/**
 * Catálogo de ferramentas do conector. Acrescentar uma ferramenta é criar `tools/<nome>.ts`
 * exportando um `McpToolDefinition` e listá-lo aqui. Escopo, autorização por marca, anotações,
 * securitySchemes e registro de chamadas são aplicados pelo `registry.ts`.
 *
 * Modelo de trabalho: o AGENTE (ChatGPT, Claude, Gemini...) é o diretor de arte e o artista. O Designer
 * entrega o contexto (brief), valida, confere o texto, guarda e mostra no editor.
 *
 *  - leitura (`designer.read`): list_brands, get_brand_kit, get_designer_brief, list_designs, get_design;
 *  - escrita (`designer.write`): save_presentation.
 *
 * Planejadas: export (Canva/PDF), upload de foto, edição pontual de slide, pausa de geração e a
 * leitura dos registros de chamadas.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const MCP_TOOLS: readonly McpToolDefinition<any, any>[] = [
  listBrandsTool,
  getBrandKitTool,
  getDesignerBriefTool,
  listDesignsTool,
  getDesignTool,
  savePresentationTool,
];

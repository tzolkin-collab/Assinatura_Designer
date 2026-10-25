import type { McpToolDefinition } from './types.js';
import { exportFileTool, exportToCanvaTool, getCanvaExportStatusTool, getExportStatusTool } from './exportTools.js';
import { getBrandKitTool } from './getBrandKit.js';
import { getBrandProfileTool } from './getBrandProfile.js';
import { getDesignTool } from './getDesign.js';
import { getDesignerBriefTool } from './getDesignerBrief.js';
import { getIntegrationsStatusTool } from './integrationsStatus.js';
import { listAssetsTool } from './listAssets.js';
import { listBrandsTool } from './listBrands.js';
import { listDesignsTool } from './listDesigns.js';
import { endFrontendSessionTool, startFrontendSessionTool } from './frontendSession.js';
import { getPhotoSlotsTool, setSlidePhotoTool } from './photoSlots.js';
import { savePresentationTool } from './savePresentation.js';
import { updateSlideTool } from './updateSlide.js';
import { uploadAssetTool } from './uploadAsset.js';
import { createVersionTool, listVersionsTool, restoreVersionTool } from './versions.js';

/**
 * Catálogo de ferramentas do conector. Acrescentar uma ferramenta é criar `tools/<nome>.ts`
 * exportando um `McpToolDefinition` e listá-lo aqui. Escopo, autorização por marca, anotações,
 * securitySchemes e registro de chamadas são aplicados pelo `registry.ts`.
 *
 * Modelo de trabalho: o AGENTE (ChatGPT, Claude, Gemini...) é o diretor de arte e o artista. O Designer
 * entrega o contexto (brief), valida, confere o texto, guarda e mostra no editor.
 *
 *  - leitura (`designer.read`): list_brands, get_brand_kit, get_designer_brief, list_designs, get_design,
 *    get_brand_profile, list_assets, list_versions, get_photo_slots, get_integrations_status;
 *  - escrita (`designer.write`): save_presentation, update_slide, create_version, restore_version,
 *    set_slide_photo, upload_asset;
 *  - saída (`designer.export`): export_file, get_export_status, export_to_canva, get_canva_export_status;
 *  - navegador somente leitura (`designer.preview`): start_frontend_session, end_frontend_session.
 *
 * O plano completo (52 ferramentas, escopos e ordem) está em docs/MCP-DESIGNER-PLANO-FERRAMENTAS.md.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const MCP_TOOLS: readonly McpToolDefinition<any, any>[] = [
  listBrandsTool,
  getBrandKitTool,
  getDesignerBriefTool,
  listDesignsTool,
  getDesignTool,
  getBrandProfileTool,
  listAssetsTool,
  listVersionsTool,
  getPhotoSlotsTool,
  getIntegrationsStatusTool,
  savePresentationTool,
  updateSlideTool,
  createVersionTool,
  restoreVersionTool,
  setSlidePhotoTool,
  uploadAssetTool,
  exportFileTool,
  getExportStatusTool,
  exportToCanvaTool,
  getCanvaExportStatusTool,
  startFrontendSessionTool,
  endFrontendSessionTool,
];

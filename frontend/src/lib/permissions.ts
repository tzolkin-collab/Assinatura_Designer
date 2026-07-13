/**
 * Permissões por papel na marca.
 *
 * ESPELHA o backend (`backend/src/middleware/brandAccess.ts`). Aqui é só UX: a
 * autorização de verdade acontece no servidor, que devolve 403. Este arquivo existe
 * para a interface não oferecer ao usuário um botão que vai falhar.
 *
 * Se mudar a regra no backend, mude aqui também.
 */

export type BrandRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';

/** Ações que a interface controla. */
export type BrandAction =
  /** Criar/editar/apagar designs, posts, pastas. */
  | 'edit-design'
  /** Subir e apagar mídia da biblioteca. */
  | 'manage-assets'
  /** Gerar design com IA (consome cota do Gemini). */
  | 'generate'
  /** Exportar para o Canva. */
  | 'export'
  /** Alterar configurações da marca (branding, agente, referências). */
  | 'edit-settings'
  /** Convidar, remover e mudar papel de membros. */
  | 'manage-team'
  /** Conectar/desconectar a integração do Canva. */
  | 'manage-integrations';

const ANY_MEMBER: BrandRole[] = ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER'];
const EDITORS: BrandRole[] = ['OWNER', 'ADMIN', 'EDITOR'];
const ADMINS: BrandRole[] = ['OWNER', 'ADMIN'];

const MATRIX: Record<BrandAction, BrandRole[]> = {
  'edit-design': EDITORS,
  'manage-assets': EDITORS,
  generate: EDITORS,
  export: EDITORS,
  'edit-settings': EDITORS,
  'manage-team': ADMINS,
  'manage-integrations': ADMINS,
};

/** VIEWER não aparece em nenhuma linha da matriz: ele só lê. Mantido explícito
 *  para o leitor não precisar deduzir isso da ausência. */
export const READ_ONLY_ROLES: BrandRole[] = ANY_MEMBER.filter(
  (role) => !EDITORS.includes(role),
);

export function can(role: BrandRole | undefined, action: BrandAction): boolean {
  if (!role) return false;
  return MATRIX[action].includes(role);
}

export function isReadOnly(role: BrandRole | undefined): boolean {
  return role === 'VIEWER';
}

/** Texto para o tooltip do controle desabilitado. */
export function permissionHint(role: BrandRole | undefined): string {
  if (!role) return 'Você não faz parte desta marca.';
  if (role === 'VIEWER') return 'Você tem permissão apenas de visualização.';
  return 'Esta ação exige permissão de administrador.';
}

export const ROLE_LABELS: Record<BrandRole, string> = {
  OWNER: 'Dono',
  ADMIN: 'Administrador',
  EDITOR: 'Editor',
  VIEWER: 'Visualizador',
};

import { Type, type Tool, type FunctionDeclaration } from '@google/genai';
import prisma from '../../lib/prisma.js';
import { getBrandMemory, updateBrandMemory } from '../../lib/redis.js';
import { tryDecryptToken, encryptToken } from '../../lib/tokenCrypto.js';
import { config } from '../../config.js';
import { refreshOAuthToken, isTokenExpiringSoon } from '../../lib/connectorOAuth.js';
import { logger } from '../../lib/logger.js';

// ── Definitions (Schemas) ──

const updateMemorySchema: FunctionDeclaration = {
  name: 'updateBrandMemory',
  description: 'Adiciona ou remove uma regra de design ou preferência visual aprendida sobre a marca. Use isso SEMPRE que o usuário expressar uma preferência (ex: "não gosto de azul", "use fontes serifadas", "nunca use gradientes").',
  parameters: {
    type: Type.OBJECT,
    properties: {
      action: {
        type: Type.STRING,
        description: 'Ação a realizar: "add" para adicionar/atualizar, "remove" para deletar.',
      },
      key: {
        type: Type.STRING,
        description: 'Um identificador curto e em minúsculas para a regra, ex: "cores", "tipografia", "estilo_fundo".',
      },
      value: {
        type: Type.STRING,
        description: 'O texto descritivo da regra, ex: "Nunca usar fundos gradientes". Vazio se a ação for "remove".',
      },
    },
    required: ['action', 'key'],
  },
};

const createAsanaTaskSchema: FunctionDeclaration = {
  name: 'createAsanaTask',
  description: 'Cria uma tarefa no Asana para um design ou aprovação. Requer que o usuário tenha o Asana conectado.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      projectId: {
        type: Type.STRING,
        description: 'O ID do projeto no Asana (gid) onde a tarefa será criada. Opcional.',
      },
      name: {
        type: Type.STRING,
        description: 'Nome da tarefa (ex: "Revisar Design: Post Instagram").',
      },
      notes: {
        type: Type.STRING,
        description: 'Descrição ou detalhes adicionais da tarefa.',
      },
    },
    required: ['name'],
  },
};

const listAsanaProjectsSchema: FunctionDeclaration = {
  name: 'listAsanaProjects',
  description: 'Lista os projetos do Asana do usuário para encontrar o projectId correto antes de criar uma tarefa.',
};

export const brainTools: Tool[] = [
  {
    functionDeclarations: [updateMemorySchema, createAsanaTaskSchema, listAsanaProjectsSchema],
  },
];

// ── Executors ──

interface SkillContext {
  userId?: string;
  brandSlug: string;
}

// Helpers para Asana
const ASANA_API_BASE = 'https://app.asana.com/api/1.0';

async function getAsanaTokenForSkill(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { asanaToken: true, asanaRefreshToken: true, asanaTokenExpiry: true },
  });
  const accessToken = tryDecryptToken(user?.asanaToken);
  if (!accessToken) throw new Error('Usuário não possui o Asana conectado ou autenticado.');

  const refreshToken = tryDecryptToken(user?.asanaRefreshToken);
  if (!refreshToken || !isTokenExpiringSoon(user?.asanaTokenExpiry)) {
    return accessToken;
  }

  try {
    const tokens = await refreshOAuthToken('https://app.asana.com/-/oauth_token', {
      client_id: config.asanaClientId,
      client_secret: config.asanaClientSecret,
      refresh_token: refreshToken,
    });
    await prisma.user.update({
      where: { id: userId },
      data: {
        asanaToken: encryptToken(tokens.access_token),
        asanaRefreshToken: tokens.refresh_token ? encryptToken(tokens.refresh_token) : undefined,
        asanaTokenExpiry: new Date(Date.now() + tokens.expires_in * 1000),
      },
    });
    return tokens.access_token;
  } catch (err) {
    logger.warn('[Skill Asana] Falha ao renovar token. Usando o antigo.', { error: (err as Error).message });
    return accessToken;
  }
}

export async function executeSkill(
  name: string,
  args: any,
  context: SkillContext
): Promise<any> {
  try {
    if (name === 'updateBrandMemory') {
      const mem = await getBrandMemory(context.brandSlug);
      const prefs = { ...mem.preferences };
      
      if (args.action === 'add') {
        prefs[args.key] = args.value;
      } else if (args.action === 'remove') {
        delete prefs[args.key];
      }
      
      await updateBrandMemory(context.brandSlug, { preferences: prefs });
      return { success: true, message: `Memória atualizada com sucesso. Chave ${args.key} foi ${args.action === 'add' ? 'adicionada' : 'removida'}.` };
    }

    if (name === 'listAsanaProjects') {
      if (!context.userId) return { success: false, error: 'Requer usuário autenticado.' };
      const token = await getAsanaTokenForSkill(context.userId);
      
      const meRes = await fetch(`${ASANA_API_BASE}/users/me?opt_fields=workspaces`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!meRes.ok) return { success: false, error: 'Falha ao buscar workspaces no Asana.' };
      const me = await meRes.json();
      
      const allProjects: any[] = [];
      for (const ws of (me.data?.workspaces || [])) {
        const r = await fetch(`${ASANA_API_BASE}/workspaces/${ws.gid}/projects?limit=20&archived=false&opt_fields=name`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (r.ok) {
          const body = await r.json();
          allProjects.push(...(body.data || []));
        }
      }
      return { success: true, projects: allProjects };
    }

    if (name === 'createAsanaTask') {
      if (!context.userId) return { success: false, error: 'Requer usuário autenticado.' };
      const token = await getAsanaTokenForSkill(context.userId);
      
      const payload: any = {
        data: {
          name: args.name,
          notes: args.notes || '',
        }
      };
      
      // Se não passar projectId explícito, joga no workspace padrão do usuário (minhas tarefas)
      if (args.projectId) {
        payload.data.projects = [args.projectId];
      } else {
        const meRes = await fetch(`${ASANA_API_BASE}/users/me?opt_fields=workspaces`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const me = await meRes.json();
        const wsId = me.data?.workspaces?.[0]?.gid;
        if (wsId) {
          payload.data.workspace = wsId;
        }
      }

      const res = await fetch(`${ASANA_API_BASE}/tasks`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(payload)
      });
      
      if (!res.ok) {
        const txt = await res.text();
        return { success: false, error: `Falha na API do Asana: ${txt}` };
      }
      
      const body = await res.json();
      return { success: true, taskId: body.data?.gid, permalink: body.data?.permalink_url };
    }

    return { success: false, error: `Skill desconhecida: ${name}` };
  } catch (error: any) {
    logger.error(`[Skill Execution Error] ${name}`, { error: error.message });
    return { success: false, error: error.message };
  }
}

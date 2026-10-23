import bcrypt from 'bcrypt';

// Login administrativo "rootSystem", definido só por variável de ambiente.
//
// Não depende do domínio de e-mail (GOOGLE_ALLOWED_EMAILS vale só para o login com Google) e não tem
// senha no código nem no banco: o .env guarda o HASH bcrypt. Sem ROOT_ADMIN_PASSWORD_HASH o login fica
// desligado, então nenhum ambiente nasce com esse acesso por acidente.
//
//   ROOT_ADMIN_LOGIN          nome do login (padrão: rootSystem; comparado sem diferenciar maiúsculas)
//   ROOT_ADMIN_PASSWORD_HASH  hash bcrypt da senha. Gerar com: pnpm exec tsx scripts/hashRootAdminPassword.ts

export const ROOT_ADMIN_DEFAULT_LOGIN = 'rootSystem';

type Env = Record<string, string | undefined>;

export interface RootAdminConfig {
  login: string;
  passwordHash: string;
}

/** Configuração do login root, ou null quando ele está desligado (sem hash no ambiente). */
export function getRootAdminConfig(env: Env = process.env): RootAdminConfig | null {
  const passwordHash = env.ROOT_ADMIN_PASSWORD_HASH?.trim();
  if (!passwordHash) return null;
  const login = env.ROOT_ADMIN_LOGIN?.trim() || ROOT_ADMIN_DEFAULT_LOGIN;
  return { login, passwordHash };
}

/** O identificador digitado é o do login root? (só diz respeito ao nome, não à senha) */
export function isRootAdminLogin(identifier: string, env: Env = process.env): boolean {
  const cfg = getRootAdminConfig(env);
  return Boolean(cfg && identifier.trim().toLowerCase() === cfg.login.toLowerCase());
}

/** Confere a senha contra o hash do ambiente. Falso quando o login está desligado. */
export async function verifyRootAdminPassword(password: string, env: Env = process.env): Promise<boolean> {
  const cfg = getRootAdminConfig(env);
  if (!cfg) return false;
  try {
    return await bcrypt.compare(password, cfg.passwordHash);
  } catch {
    // Hash malformado no .env: recusa em vez de derrubar o login.
    return false;
  }
}

/** E-mail interno que representa o root no banco (a coluna é única; não colide com e-mail real, que tem "@"). */
export function rootAdminDbEmail(env: Env = process.env): string {
  return (getRootAdminConfig(env)?.login ?? ROOT_ADMIN_DEFAULT_LOGIN).toLowerCase();
}

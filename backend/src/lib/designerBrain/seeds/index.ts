import { AMANDA_COELHO_MEMORY } from './amandaCoelho.js';

/**
 * Memórias de projeto que já vêm prontas, por slug de marca. Usadas quando a marca não
 * tem memória própria cadastrada (`BrandConfig.agentPrompt`). O cadastro da marca sempre
 * vence o seed: quem edita a memória no sistema não é sobrescrito pelo texto do repositório.
 */
export const PROJECT_MEMORY_SEEDS: Record<string, string> = {
  'amanda-coelho': AMANDA_COELHO_MEMORY,
};

/**
 * Cérebro global (padrão): LIGADO em todo projeto, com ou sem ficha salva. As regras globais, a regra
 * de foto real, a trava de texto aprovado e a revisão final valem sempre; a ficha só acrescenta a
 * camada do projeto.
 *
 * `DESIGNER_BRAIN_GLOBAL=off` (também `0`, `false`, `no`) é a SAÍDA DE EMERGÊNCIA: devolve o
 * comportamento anterior, em que o cérebro só liga com ficha salva ou slug em `DESIGNER_BRAIN_BRANDS`.
 * É a única leitura dessa variável: API (chat) e worker (pipeline) passam por aqui, para não divergirem.
 * O `env` é lido na hora da chamada, não na importação.
 */
export function isGlobalBrainEnabled(env: string | undefined = process.env.DESIGNER_BRAIN_GLOBAL): boolean {
  return !['off', '0', 'false', 'no'].includes((env ?? '').trim().toLowerCase());
}

/**
 * Interruptor do cérebro por marca. Lê `DESIGNER_BRAIN_BRANDS`: slugs separados por vírgula.
 * Só tem efeito com o cérebro global em `off` (retaguarda do comportamento anterior); com o
 * global ligado, que é o padrão, todo projeto já está coberto.
 *
 * É variável de ambiente, e não coluna no banco, de propósito: ligar um caso específico
 * (a Amanda, o piloto) não exige migration nem tela, e desligar é tirar o slug da lista.
 * O `env` é lido na hora da chamada, não na importação, para os testes poderem trocá-lo.
 */
export function designerBrainBrands(env: string | undefined = process.env.DESIGNER_BRAIN_BRANDS): string[] {
  return (env ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isDesignerBrainEnabled(
  brandSlug: string,
  env: string | undefined = process.env.DESIGNER_BRAIN_BRANDS,
): boolean {
  return designerBrainBrands(env).includes(brandSlug.trim().toLowerCase());
}

/**
 * O cérebro está ligado para a marca INDEPENDENTE de ela ter ficha salva? Verdadeiro com o cérebro
 * global ligado (padrão) ou, na saída de emergência, quando o slug está em `DESIGNER_BRAIN_BRANDS`.
 */
export function isBrainOnWithoutProfile(
  brandSlug: string,
  globalEnv: string | undefined = process.env.DESIGNER_BRAIN_GLOBAL,
  brandsEnv: string | undefined = process.env.DESIGNER_BRAIN_BRANDS,
): boolean {
  return isGlobalBrainEnabled(globalEnv) || isDesignerBrainEnabled(brandSlug, brandsEnv);
}

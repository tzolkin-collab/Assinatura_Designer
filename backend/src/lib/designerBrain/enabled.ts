/**
 * Interruptor do cérebro por marca. Lê `DESIGNER_BRAIN_BRANDS`: slugs separados por vírgula.
 * Vazio (padrão) = desligado em TODAS as marcas — a geração segue exatamente como antes.
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

# P13: WP8, telas globais (Gastos com teto de R$ 200, Perfil, Agente IA)

**Camada B (ajustes do Gustavo), com um pedaço da Gabi** (o teto de R$ 200/mês foi combinado com ela em 06/10).
Antes de tudo, leia `docs/aceite/README.md` e siga as regras da seção 3.
**Depende de:** WP1 (#122) mergeado. Arquivos: `configuracoes/*`, `routes/settings.ts`.

## Objetivo
1. **Gastos** com o **teto de R$ 200/mês** de API, visível e com aviso antes de estourar.
2. **Perfil** e **Agente IA** (rótulos) coerentes com as demais telas depois das remoções.

## Contexto
- O app já registra tokens de entrada, saída e raciocínio do `usageMetadata` do Gemini e estima custo por modelo, com a tabela de preços do Designer. **É estimativa, não fatura da Google.** A tela deve dizer isso.
- Houve um gasto de R$ 200 em 18-19/10 com o modelo `gemini-4-argon`, que **nada no código usa**, ainda sem explicação. A tela de Gastos deve mostrar **por modelo**, para que um modelo inesperado apareça. Não tente explicar o incidente aqui.
- Decisão: uma chave por aplicação, com teto próprio (Camada C). O teto na tela é **informativo**; o teto real é na chave/conta.
- Combinado com a Gabi: "comunicar qualquer demanda que gere custo adicional".
- 🟡 Não sei como o teto seria configurado (por marca, global, variável). **Pergunte** se o código não deixar claro.

## Passos
1. Leia a tela e a rota de Gastos atuais (`ai-usage`) e o que já calcula.
2. Proponha o menor desenho para teto, alerta (por exemplo 80%) e quebra por modelo. Se precisar de coluna nova, **pare e pergunte**.
3. Implemente com testes (cálculo do acumulado do mês, alerta, estimativa rotulada).
4. Ajuste rótulos de Perfil e Agente IA sem mudar comportamento.

## Aceite
- [ ] Gasto do mês e teto visíveis; alerta ao se aproximar; quebra por modelo.
- [ ] Texto deixa claro que é estimativa.
- [ ] Nenhuma mudança em geração. Suíte verde, tela conferida.

## Não fazer
Não bloquear geração ao atingir o teto sem decisão do Gustavo. Não expor chaves ou valores de `.env`.

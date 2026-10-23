# P07: Defeitos conhecidos da Fábrica

**Camada A (Gabi).** Antes de tudo, leia `docs/aceite/README.md` e siga as regras da seção 3.
**Toca o fluxo da Fábrica e do planner (`brain/index.ts`, planner):** rode depois de #124 e **sozinho** em relação a pacotes que tocam `pipeline.ts`.

## Objetivo
Corrigir três defeitos documentados em 15/10 (`docs/HANDOFF-CEREBRO-DA-IA.md` §11.6), **cada um com teste que falha antes e passa depois**.

## Defeitos
1. **Modo Auto vira Manual sozinho** e a Fábrica faz a pergunta guiada "Qual o destino da peça?" antes de gerar.
2. **O assistente diz "Já comecei a gerar"** enquanto a confirmação da regra de foto real ainda está pendente (o cartão avisa "Ainda não comecei", mas a frase anterior contradiz).
3. **O planner inventa títulos de slide** que não estão no texto aprovado ("O Poder da Decisão", "O Custo da Falta de Direção"). O texto do slide sai literal, mas o **nome** do slide no roteiro não.

## Contexto
- Em 06/10 já se tornou Auto coerente no roteiro copy-first: no Auto o roteiro é encaminhado como estrutura aprovada; no Manual há pausa. Partir daí, não refazer.
- A mudança de rolagem do #89 (cartão escondido atrás do campo de mensagem) provavelmente é desnecessária; **não remova sem provar** em tela maior e mobile.
- 🟡 Os defeitos 1 e 2 foram observados na tela em 15/10 e podem ter mudado desde então. **Reproduza antes de corrigir**; se não reproduzir, diga e não mexa.
- D17: após recusa, a regeneração reaproveita o roteiro aprovado. Não mude isso aqui.

## Passos
1. Reproduza cada defeito (testes automatizados ou tela). Registre como.
2. Escreva o teste que falha. Corrija o mínimo. Rode a suíte inteira.
3. Para o 3, a regra é: título de slide só pode vir do texto aprovado ou ser rotulado como sugestão; decida a menor mudança e justifique.

## Aceite
- [ ] Cada defeito: reprodução registrada, teste novo, correção, suíte verde.
- [ ] Nenhuma mudança no texto literal dos slides.

## Não fazer
Não corrigir o que não reproduzir. Não misturar com P03.

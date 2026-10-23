# Aceite do Designer: contexto comum

> Criado em 23/10/2026. Estado conferido em 19/10 (handoff consolidado) e 23/10 (git e GitHub).
> Marca 🟡 HIPÓTESE o que não foi confirmado. Onde documento e código divergem, vale o código.
> Cada prompt em `prompts/` assume que quem executa leu **este arquivo primeiro**.

## 1. O que é este trabalho

Fechar o Designer (contrato Assinatura Marca Própria, cliente **Gabriela**) para homologação em **29/10** e revisão/aceite em **30/10**.

O escopo tem duas camadas, e a diferença importa:

| Camada | O que é | Quem pediu | Fecha o aceite? |
| --- | --- | --- | --- |
| **A. Aceite da Gabi** | Os pedidos dela: Cérebro em camadas, status do texto por campo, variedade de composição, avisos, troca sem regerar, os 8 testes do Checklist Operacional | Gabriela (documento "Cérebro de IA do Sistema Designer" de 04/10, ata de 02/10, reunião de 06/10, WhatsApp) | **Sim** |
| **B. Ajustes do Gustavo** | Simplificação da interface decidida em 19/10 (D1 a D17): tirar Tenants e pesquisa de concorrentes, aposentar System Prompt e Preferências, juntar configurações no Cérebro | Gustavo | Não. Reduz superfície, não acrescenta funcionalidade |

Exceção: o **cérebro global em todo projeto, com ou sem ficha** (D4, PR #124) é mais que um ajuste, porque muda o comportamento da geração. Trate-o como risco próprio.

**Ordem de prioridade:** A primeiro, B depois. Os ajustes B que divergem do desenho da Gabi (D7, D8, D9, D10) precisam ser **avisados a ela** (tarefa P15).

## 2. Estado de partida

- `main` em `1456f55`. PRs #74 a #119 mergeados. **A produção roda o build de 16/10**; nada de 19/10 em diante foi para produção.
- **Cinco PRs abertos, nenhum mergeado**, todos `MERGEABLE` com CI verde: #120 login `rootSystem`, #121 slug da documentação, #122 remove Tenants, #123 remove pesquisa de concorrentes, #124 cérebro global.
- Ordem de junção decidida (D13): **#122, #120, #123, #124**. #123 × #124 conflitam em `backend/src/__tests__/pipelineAdviceInterrupt.test.ts`; resolver ao juntar.
- O painel "Briefing da peça" (campos no lugar de tags, PR #119) já está em `main`. O formulário de briefing que a Gabi pediu **existe**; falta verificar de ponta a ponta com a IA.
- **Chave Gemini revogada em 19/10.** Sem chave nova, nenhuma geração real funciona. Bloqueia P01, P02, P06 e o teste do #124.

## 3. Regras para todo executor (valem para todos os prompts)

1. **Nunca escrever em banco real, rodar migration, seed, deploy ou push** sem autorização do Gustavo naquele momento. O backend local usa **banco e Redis reais**: trate como produção, só leitura.
2. **Nenhuma geração com IA paga sem autorização** (cerca de US$ 0,40 por deck; teto de R$ 200/mês). Peça antes, dizendo quantos decks e em qual conta.
3. **Nunca ler nem repetir valores de `.env`** ou credenciais.
4. **Fila isolada:** use a config `backend-local` (ou `designer-backend-local`) com `BULLMQ_PREFIX=dev-local` e `ZOMBIE_POST_SWEEP_ENABLED=false`. **Nunca** `designer-backend` (prefixo de produção; o worker consumiria jobs de outros usuários).
5. **Nunca rodar `pnpm` em worktree cuja `node_modules` seja junction** para a do projeto principal (ele tenta reinstalar e remover a pasta). Use `node node_modules/vitest/vitest.mjs run` e `node node_modules/typescript/bin/tsc --noEmit`.
6. `git status` antes de começar; `git add` **só dos seus arquivos** (nunca `git add -A`); commits pequenos (`feat(...)`, `fix(...)`, `docs(...)`).
7. **Fontes comerciais (Queens, Aeonik) e `insumos-amanda/` nunca entram no git.**
8. "Compila" não é aceite: prove com teste **e** na tela quando houver tela. Admita o que não foi verificado.
9. Se faltar decisão de produto, **pare e pergunte** no relatório. Não decida sozinho.
10. Merge só com autorização explícita do Gustavo e depois de revisar o diff.
11. No Windows, PowerShell não aceita `&&`: use `;` e `$env:VAR='x'`.
12. Um teste de `svgSanitize` dá timeout de 5 s sob carga e passa sozinho (60 de 60). Não é regressão.
13. Pacotes que tocam `pipeline.ts` rodam **um por vez**.

## 4. Como rodar e verificar

```powershell
# backend
cd backend; node node_modules/typescript/bin/tsc --noEmit; node node_modules/vitest/vitest.mjs run
# frontend
cd frontend; node node_modules/typescript/bin/tsc --noEmit; node node_modules/vitest/vitest.mjs run
```

- Linha de base na `main` de 15/10 a 17/10: backend e frontend verdes, `tsc` limpo. Contagens mudam a cada PR; compare antes e depois do seu trabalho, não com um número fixo.
- Tela sem backend real: API de mentira local + `NEXT_PUBLIC_API_URL` apontando para ela, com `localStorage.auth_token` e cookie `auth_token` quaisquer.
- Login `rootSystem`: gerar o hash com `scripts/hashRootAdminPassword.ts` e pôr `ROOT_ADMIN_PASSWORD_HASH='$2b$...'` em `backend/.env`, entre aspas simples. A senha nunca vai no código.
- Scripts de aceite: `backend/scripts/aceiteCerebro.ts`, `renderizarDeck.ts`, `medirVariedade.cjs`, `loadAmandaPhotos.ts`, `teste2FotoReal.ts`. Os que gravam simulam por padrão e só gravam com `--apply`.

## 5. Onde está a informação

| O quê | Onde |
| --- | --- |
| Handoff mais recente | `docs/handoffs/2026-10-19-estado-consolidado.md` |
| Checklist e decisões D1 a D17 do PO | `docs/po/designer-checklist.md` |
| Pedidos da Gabi (fontes primárias) | `docs/HANDOFF-DESIGNER-2026-10-17.md` §2; documento fora do repo em `C:\Users\gusta\Downloads\CÉREBRO DE IA DO SISTEMA DESIGNER.docx` |
| Os 8 testes e achados de 15/10 | `docs/HANDOFF-CEREBRO-DA-IA.md` §11 |
| Checklist Operacional preenchido | `docs/CHECKLIST OPERACIONAL - preenchido 2026-10-15.docx` (rascunho; o Google Doc dela **não** foi alterado) |
| Lote 1 da Gabi (insumo de variedade) | `docs/benchmark/lote1-gabriela/` |
| Registro oficial | Tzolkin Core, tenant "Assinatura Marca Própria" `7d5f75ba-5dd0-4136-a30c-c9c3372c346e`, contratação "Designer" `7b59ff31-1f30-4227-ab58-16ee612c342c` (prefixo `[Designer]`) |
| Workflows de workers | `.claude/workflows/po-*.js` (executar por `scriptPath`) |

## 6. Régua de nota (para revisão de cada entrega)

Funciona de verdade, testes **e** tela: 40%. Aderência ao checklist e ao escopo: 25%. Segurança e integridade de dados: 15%. Qualidade do código e dos testes: 10%. Documentação e relatório honesto: 10%.
**>= 9** aceito. **7 a 8,9** aceito com correções. **< 7** refazer. Item de segurança reprovado limita a nota a 6. Autoavaliação do executor não vale como nota.

## 7. Índice dos prompts e ordem sugerida

| # | Tarefa | Camada | Depende de | Gasta IA? |
| --- | --- | --- | --- | --- |
| P08 | Verificações pendentes (só leitura) | A | nada | não |
| P09 | Junção dos PRs #122, #120, #123, #124 | B | autorização de merge | não |
| P15 | Rascunho do aviso à Gabriela | C | nada | não |
| P07 | Defeitos conhecidos da Fábrica | A | P09 | não |
| P03 | Avisos de conflito, de texto que não cabe, pendência objetiva | A | P09 | não |
| P04 | Trocar cor, fonte e logo sem regerar | A | P09 | não |
| P05 | Seletor de modo e e-book A4 (proposta primeiro) | A | decisão de custo | não |
| P01 | Fotos reais e Teste 2 | A | chave Gemini + autorização | sim |
| P02 | Variedade de composição | A | chave Gemini + autorização | sim |
| P06 | Testes 5 e 8 e briefing ponta a ponta | A | P09, chave, autorização | sim |
| P10 | WP5, System Prompt e Preferências | B | P09 | não |
| P12 | WP7, Moodboard | B | P09 | não |
| P13 | WP8, Gastos/Perfil/Agente | B | P09 | não |
| P11 | WP6, consolidar configurações | B | P10, P12 e aviso (P15) | não |
| P14 | WP9, manual de uso | A e B | P11, P12 | sim, no teste do zero |

Pacotes que tocam `pipeline.ts` (P03, P07, P10) rodam um por vez. Os demais podem andar em paralelo se não dividirem arquivos.

## 8. Formato do relatório de entrega (todo prompt)

1. O que mudou (arquivos) e o que **não** mudou.
2. Evidência: comandos rodados com resultado, e print/descrição da tela quando houver.
3. O que **não foi verificado** e por quê.
4. Decisões que faltam, para o Gustavo.
5. Adições e remoções, arquivo a arquivo.

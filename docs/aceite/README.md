# Aceite do Designer: contexto comum

> Reescrito em 23/10/2026 a partir do **Core** (tenant "Assinatura Marca Própria", contratação "Designer") e das sessões de 19/10. **O Core é a fonte do acompanhamento; esta pasta é o espelho executável.** Se divergirem, vale o Core. O painel de estado está no registro "[Designer] PAINEL DE ACOMPANHAMENTO (23/10)".
> Marca 🟡 HIPÓTESE o que não foi confirmado. Onde documento e código divergem, vale o código.
> Cada prompt em `prompts/` assume que quem executa leu **este arquivo primeiro**.

## 1. A regra de escopo (decisão do Gustavo, 19/10)

> "Não quero adicionar mais features e sim corrigir e finalizar o que já tem, agregar o MCP e o que a Gabriela pediu."

| | O que é |
| --- | --- |
| **Dentro** | Corrigir o que existe. **Integrar o MCP já construído** (20 ferramentas, lotes 1A a 1C): deploy e teste com agente real. O que a Gabi pediu **e já existe**. |
| **Fora, adiado para 02/11** | Seletor de modo, "Nova imagem" / "Novo e-book A4", formulário de briefing completo. Só voltam se a Gabi aprovar escopo e custo. |
| **Descartado** | Conflito de versões do texto. |
| **Fora** | MCP lotes 2 a 4 (32 ferramentas). |

Datas fixas: **homologação 29/10**, **revisão do designer (aceite) 30/10**.

## 2. Dois tipos de trabalho (não misturar)

| Tipo | O que é | Fecha o aceite? |
| --- | --- | --- |
| **Pedido da Gabi** | Os 8 testes do Checklist Operacional, variedade de composição, aviso de texto que não cabe, foto real, briefing por campos, Cérebro em camadas | **Sim** |
| **Ajuste do Gustavo** (D1 a D17) | Tirar Tenants e pesquisa de concorrentes, aposentar System Prompt e Preferências, juntar configurações no Cérebro, login `rootSystem`, cérebro global em todo projeto | Não: simplifica, não acrescenta. O cérebro global muda a geração e é risco próprio |

Os ajustes que **divergem do desenho da Gabi** (D7, D8, D9, D10) precisam ser **avisados a ela**. Nada foi enviado.

## 3. Estado de partida (23/10)

- **Produção:** roda o build de **16/10**, com o **MCP já ligado** e as **19 migrations aplicadas** (logs de 16 a 19/10). **Não recebeu nada de 19/10 em diante.** O banco está em `easypanel.landcriativa.com`; 🟡 onde o container da API roda não está confirmado.
- **`main`** em `1456f55` (PRs #74 a #119). **Cinco PRs abertos, nenhum mergeado:** #121, #122, #120, #123, #124. Todos `MERGEABLE`. **Os únicos checks do GitHub são do Vercel: não existe CI que rode os testes.** O "verde" dos testes vem das suítes que o PO rodou localmente em 19/10.
- Ordem de junção (D13): **#121, #122, #120, #123, #124.** #123 × #124 conflitam em `pipelineAdviceInterrupt.test.ts`.
- **Chave Gemini revogada em 19/10.** Sem chave nova, **nenhuma geração real funciona.** Bloqueia os testes de foto real, variedade, 5 e 8, e o teste do #124 com decks reais.
- **"Passou" não é resultado.** Os testes 1, 3 e 6 "passaram" por critério de teste. **Nunca se comparou um deck gerado com o lote 1 da Gabi (`docs/benchmark/lote1-gabriela/brief.txt`) slide a slide**: paleta, fonte, composição, texto exato, foto. Isso é o resultado.

## 4. Regras para todo executor

1. **Nunca escrever em banco real, rodar migration, seed, deploy ou push** sem autorização do Gustavo naquele momento. O backend local usa **banco e Redis reais**: tratar como produção, só leitura.
2. **Nenhuma geração com IA paga sem autorização** (~US$ 0,40 por deck; teto de R$ 200/mês). Diga quantos decks e em qual conta.
3. **Nunca ler nem repetir valores de `.env`** ou credenciais.
4. **Fila isolada:** config `backend-local` (ou `designer-backend-local`) com `BULLMQ_PREFIX=dev-local` e `ZOMBIE_POST_SWEEP_ENABLED=false`. **Nunca** `designer-backend` (prefixo de produção).
5. **Nunca rodar `pnpm` em worktree cuja `node_modules` seja junction.** Use `node node_modules/vitest/vitest.mjs run` e `node node_modules/typescript/bin/tsc --noEmit`.
6. `git status` antes; `git add` **só dos seus arquivos** (nunca `git add -A`); commits pequenos.
7. **Fontes comerciais (Queens, Aeonik) e `insumos-amanda/` nunca entram no git.**
8. "Compila" não é aceite: prove com teste **e** na tela. Admita o que não foi verificado.
9. Faltou decisão de produto: **pare e pergunte** no relatório.
10. Merge só com autorização explícita do Gustavo, PR a PR, depois de revisar o diff.
11. PowerShell não aceita `&&`: use `;`.
12. Teste de `svgSanitize` dá timeout de 5 s sob carga e passa sozinho (60 de 60). Não é regressão.
13. Pacotes que tocam `pipeline.ts` (**P03, P07, P10**) rodam **um por vez**.
14. **Não reabra decisão já tomada** (seção 1). Se achar que algo fora do escopo é necessário, registre e pergunte; não construa.

## 5. Como rodar e verificar

```powershell
cd backend; node node_modules/typescript/bin/tsc --noEmit; node node_modules/vitest/vitest.mjs run
cd frontend; node node_modules/typescript/bin/tsc --noEmit; node node_modules/vitest/vitest.mjs run
```

- Compare antes e depois do seu trabalho; não use contagem fixa (muda a cada PR).
- Tela sem backend real: API de mentira local + `NEXT_PUBLIC_API_URL`, com `localStorage.auth_token` e cookie `auth_token` quaisquer.
- Login `rootSystem`: hash por `scripts/hashRootAdminPassword.ts` em `backend/.env`, entre aspas simples. Senha nunca no código.
- Scripts de aceite: `backend/scripts/aceiteCerebro.ts`, `renderizarDeck.ts`, `medirVariedade.cjs`, `loadAmandaPhotos.ts`, `teste2FotoReal.ts`. Os que gravam simulam por padrão e só gravam com `--apply`.
- O Core cria registros como "planejado": registro de fato já ocorrido exige `status: done` numa segunda chamada, passando `ends_at`.

## 6. Onde está a informação

| O quê | Onde |
| --- | --- |
| Acompanhamento oficial | **Core**: tenant `7d5f75ba-5dd0-4136-a30c-c9c3372c346e`, contratação `7b59ff31-1f30-4227-ab58-16ee612c342c` (prefixo `[Designer]` e `[Worker]`) |
| Painel de 23/10 | Core: "[Designer] PAINEL DE ACOMPANHAMENTO (23/10)" |
| Handoff mais recente | `docs/handoffs/2026-10-19-estado-consolidado.md` |
| Checklist e decisões D1 a D17 do PO | `docs/po/designer-checklist.md` |
| Pedidos da Gabi (fontes primárias) | `docs/HANDOFF-DESIGNER-2026-10-17.md` §2; documento fora do repo: `C:\Users\gusta\Downloads\CÉREBRO DE IA DO SISTEMA DESIGNER.docx` |
| Os 8 testes e achados de 15/10 | `docs/HANDOFF-CEREBRO-DA-IA.md` §11 |
| Pedido de geração da Gabi (lote 1) | `docs/benchmark/lote1-gabriela/` |
| MCP | `docs/MCP-DESIGNER.md` (e `MCP-DESIGNER-PLANO-FERRAMENTAS.md`: lotes 2 a 4 **fora**) |

## 7. Índice dos prompts e ordem sugerida

| # | Tarefa | Tipo | Depende de | Gasta IA? | Tarefa no Core |
| --- | --- | --- | --- | --- | --- |
| P09 | Junção dos PRs #121, #122, #120, #123, #124 | ajuste | autorização de merge | não | Junção dos PRs |
| P15 | Rascunho do aviso à Gabriela (não envia) | comunicação | nada | não | FUP Gabriela (2 tarefas) |
| P08 | Verificações pendentes (só leitura) | Gabi | nada | não | Galeria, Acessos, 8 testes |
| P03 | Aviso quando o texto não cabe | Gabi | P09 | não | Aviso ao usuário quando o texto não cabe |
| P07 | Defeitos conhecidos da Fábrica (reproduzir antes) | Gabi | P09 | não | (sem tarefa própria) |
| P16 | **Integrar o MCP**: deploy e teste com agente real | contrato | P09, chave | não | Deploy do backend e teste do conector MCP |
| P01 | Fotos reais da Amanda e Teste 2 | Gabi | **chave** + autorização | sim | Fotos reais da Amanda |
| P02 | Variedade de composição (teste justo com o lote 1) | Gabi | **chave** + autorização | sim | Variedade de composição |
| P06 | Testes 5 e 8 e briefing de ponta a ponta | Gabi | P09, chave | sim | 8 testes; Desdobramento e collab |
| P10 | Retirar System Prompt e Preferências | ajuste | P09 | não | Retirar System Prompt e Preferências |
| P12 | Moodboard (card e área) | ajuste | P09 | não | Referências: excluir concorrentes e criar Moodboard |
| P13 | Gastos, Perfil e Agente IA (**decidir antes**) | ajuste | P09 | não | Gastos, Perfil, Agente IA |
| P11 | Consolidar configurações (D10) | ajuste | P10, P12 e aviso (P15) | não | Consolidar configurações da marca |
| P14 | Manual de uso | ambos | P11, P12 | sim, no teste do zero | Criar manual de instruções |
| P04 | Trocar cor, fonte e logo sem regerar | **adiado** | resposta da Gabi | não | pergunta no FUP |
| P05 | Seletor de modo, Nova imagem, e-book A4 | **adiado (02/11)** | aprovação da Gabi | não | [Adiado] (2 tarefas) |

## 8. Formato do relatório de entrega (todo prompt)

1. O que mudou (arquivos) e o que **não** mudou.
2. Evidência: comandos com resultado, e print ou descrição da tela. **Para qualquer geração: o slide comparado ao pedido, item a item.**
3. O que **não foi verificado** e por quê.
4. Decisões que faltam, para o Gustavo.
5. Adições e remoções, arquivo a arquivo.

## 9. Régua de nota (para revisão de cada entrega)

Funciona de verdade, testes **e** tela: 40%. Aderência ao checklist e ao escopo: 25%. Segurança e integridade de dados: 15%. Qualidade do código e dos testes: 10%. Documentação e relatório honesto: 10%. **>= 9** aceito; **7 a 8,9** aceito com correções; **< 7** refazer. Item de segurança reprovado limita a 6. Autoavaliação do executor não vale.

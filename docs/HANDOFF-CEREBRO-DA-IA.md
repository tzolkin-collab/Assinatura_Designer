# Handoff: Cérebro de IA do Designer (estado em 2026-10-11)

Para quem continuar este trabalho (Gustavo, Lucas, Saleco ou outra sessão do Claude Code).

## 1. O que é e por quê

A Gabriela (cliente, contrato Assinatura Marca Própria) definiu o "Cérebro de IA" do Designer: **regras globais fixas + uma ficha por projeto (memória do projeto-base) + desdobramentos/collabs + briefing da criação (modo + blocos de texto com status)**. A ideia é que isso substitua o contexto antigo por marca e sirva a qualquer cliente (Amanda Coelho, Assinatura, Rúbrica...), não só a Amanda.

Regras que o código impõe e que **não devem ser afrouxadas**:
- Texto aprovado aparece literal; fala, contexto e interno nunca viram texto de arte.
- Foto real só a fornecida; o sistema nunca gera pessoa (`source: 'ai-generated'` fica fora quando o cérebro está ligado).
- A IA propõe, o humano aprova: a importação do manual **nunca salva** sozinha.
- Campo vazio nunca vira valor; a IA não preenche por conta própria.
- Arquivos da ficha: só https e só da biblioteca da própria marca (proteção contra SSRF e contra arquivo de outra marca).

## 2. Pilha de PRs (merge nesta ordem; cada um tem como base o anterior)

| PR | Branch | O que entrega |
|---|---|---|
| #75 | `feat/ficha-do-projeto` (base `main`) | Modelo `BrandProfile`, API `GET/PUT /brands/:slug/profile`, `POST /:slug/collabs`, migrations |
| #76 | `feat/visao-geral-projeto` | Página "Visão geral" do projeto |
| #77 | `feat/cerebro-da-ia-ficha` | Página "Cérebro da IA" (editor da ficha) |
| #78 | `feat/ingestao-manual-ficha` | Importar ficha de um manual (backend + painel) + correções de "Carregando..." nas configurações |
| #79 | `feat/pipeline-le-a-ficha` | Fatia 2: pipeline lê a ficha salva |
| #80 | `feat/pipeline-desdobramento-status` | Fatia 3: desdobramento + status por bloco de texto |

Fora da pilha: #74 (fix: só foto real fornecida, vale revisar/mergear), #73 (galeria, já mergeada), #50 (Jules, decisão pendente), #62–#66 (UI/fonte/sidebar, empilhados entre si), #66 (docs Amanda).
Ao mergear, **retarget a base de cada PR** para `main` depois que o anterior entrar.

## 3. Migrations: NÃO aplicadas no banco

`20261011120000_add_brand_collab` e `20261011150000_add_brand_profile` (ambas aditivas). Antes de gerar de verdade com ficha, aplique-as. O código novo **não quebra sem elas**: se a leitura da ficha falha, a geração segue sem cérebro, com aviso no log (`Não foi possível ler a ficha do projeto`). Mas as telas Cérebro, Visão geral, Galeria de desdobramentos e a importação dependem das tabelas.

## 4. Como funciona agora (mapa do código)

**Backend** (`backend/src`)
- `lib/brandProfile.ts`: schema da ficha (14 seções), `profileCompleteness`, `profileFromLegacy` (ficha derivada dos campos antigos, só sugestão), `renderProjectMemory` (formato §10.1).
- `lib/brandCollab.ts`: schema do desdobramento (INTERNAL/PARTNERSHIP, parceiro, protagonismo).
- `lib/profileExtraction.ts` + rota `POST /brands/:slug/profile/import`: lê PDF/imagem/md/txt/html e devolve **rascunho** com trecho (e página) por item. Itens sem trecho são descartados; com texto-fonte o trecho é conferido em código. Logo/manual/arquivos nunca vêm do manual. 3 tentativas (só a 1ª com `temperature: 0`: com 0 o modelo às vezes devolve JSON malformado). Limite 6/h por usuário.
- `lib/designerBrain/savedProfile.ts`: `loadBrainLayers(slug)` devolve `{ projectName, projectProfile, collab }` ou `null`. Num desdobramento a ficha é a da base; a camada de collab guarda só o que muda. `isBrainActiveForBrand` = ficha salva (própria ou da base) **ou** `DESIGNER_BRAIN_BRANDS` (retaguarda).
- `lib/designerBrain/copyBlocks.ts`: marcas de status `[APROVADO] [EM REVISÃO] [APOIO] [FALA] [CONTEXTO] [INTERNO] [NÃO EXIBIR]`. Texto sem marca = aprovado, byte a byte.
- `lib/designerBrain/pipelineContext.ts`: ordem das regras do projeto: **ficha > "Instruções do agente" > seed**. Ficha sem seção preenchida não conta.
- `lib/brandContext.ts`: desdobramento herda a biblioteca da base (`libraryBrandIds`, a própria marca primeiro, teto 20); `imageResolver` e o card de "arquivos usados" respeitam isso.
- `agents/pipeline.ts` e `agents/brain/index.ts`: usam as camadas, o status por bloco (inclusive no caminho copy-first do chat) e avisam no resultado o que ficou fora da arte e se há texto em revisão.

**Frontend** (`frontend/src`)
- `app/[marca]/page.tsx` (Visão geral), `app/[marca]/cerebro/page.tsx` (editor + painel de importação), `app/galeria/page.tsx` + `components/Collab/NewCollabModal.tsx`.
- `lib/profileForm.ts` (form ⇄ ficha), `lib/profileImport.ts` (`mergeDraftIntoForm`: só preenche vazio; divergência vira conflito com "Usar sugestão"), `lib/projectOverview.ts`.

Salvar a ficha de um projeto **liga o cérebro dele** (só texto aprovado, só foto real fornecida). A tela do Cérebro avisa isso. Projetos sem ficha salva seguem como antes.

## 5. O que NÃO foi feito (próximos passos)

1. **Fatia 4 (parte 1 feita, PR da branch `feat/amanda-como-ficha`): a Amanda como ficha.** `seeds/amandaCoelhoProfile.ts` tem a memória da Gabriela dividida nas seções da ficha, palavra por palavra (um teste compara com o seed). `scripts/loadAmandaProfile.ts` simula por padrão e só grava com `--apply` (e só se o projeto ainda não tem ficha; `--force` sobrescreve). O que a memória original não traz fica pendente: tom, logo, manual visual (único obrigatório que falta) e regras de collab.
   **Parte 2 (NÃO feita, depende do banco):** (a) aplicar as migrations; (b) `pnpm exec tsx scripts/loadAmandaProfile.ts` e depois `--apply`; (c) enviar logo/manual para a biblioteca e completar a ficha na tela; (d) rodar uma geração real da Amanda **sem** `DESIGNER_BRAIN_BRANDS` e conferir; (e) só então remover `DESIGNER_BRAIN_BRANDS` (`enabled.ts`, usos em `pipeline.ts`/`brain`), `seeds/amandaCoelho.ts`, `PROJECT_MEMORY_SEEDS`, `PROJECT_OFFICIAL_FONTS` e o teste de equivalência `amandaProfile.test.ts`. Remover antes de (b) tira o cérebro da Amanda.
2. **Modo e-book A4**: o pipeline só gera apresentação 16:9 e carrossel (imagem avulsa com proporção). E-book A4 precisa de formato/tela/renderizador novos.
3. **Geração real com ficha no banco**: nunca rodou (banco sem migrations). Tudo está coberto por testes (971 no backend, 174 no frontend), mas não por Gemini real com ficha.
4. **Páginas Histórico e Desdobramentos**, reorganização da sidebar (renomear "Marca" → "Projeto"; remover duplicidade "Minhas Marcas/Projetos da Equipe"), conforme o review por função.
5. **Tela para editar a ficha própria de cada desdobramento** (hoje só o contexto do cadastro entra na camada de collab).
6. **Conferência de trechos em PDF/imagem**: só a pessoa confere (a tela avisa). Conferir em código exigiria lib de leitura de PDF: decisão de dependência do Gustavo.
7. Pendências menores: `[marca]/configuracoes/agent` tinha 5 problemas de eslint antigos (não são das mudanças recentes); decidir o PR #50 do Jules.

## 6. Decisões em aberto (do checklist com a Gabriela)

- Regra de foto-real para a Assinatura (vale como na Amanda?).
- HTML vs Nano Banana para a arte (recomendação: HTML, texto literal e editável).
- Segunda passada de IA (revisão): custo.
- Status do texto por bloco: a sintaxe `[MARCA]` atual é proposta minha; confirmar se a Gabriela prefere outro jeito (campos na interface, por exemplo).

Materiais que **faltam** da Gabriela: fotos/vídeos da Amanda (só via WhatsApp), arquivos das fontes (Queens, Aeonik), documento de regras gerais e ata de 02/10 (não compartilhados com a conta brtzolkin), anexos e áudios do WhatsApp não lidos. O manual da Assinatura usado nos testes é **reconstruído**, não o PDF original do Canva.

## 7. Como rodar e verificar

```bash
# backend
cd backend && pnpm exec tsc --noEmit && pnpm exec vitest run
# frontend
cd frontend && pnpm exec tsc --noEmit && pnpm exec vitest run
```
- Tela sem backend real: usar uma API de mentira local (`mockapi.ts` no scratchpad da sessão), com `localStorage.auth_token` qualquer e `NEXT_PUBLIC_API_URL` apontando para ela.
- Backend local: config `backend-local` em `.claude/launch.json` (com `ZOMBIE_POST_SWEEP_ENABLED=false` e `BULLMQ_PREFIX=dev-local` para não competir com produção).
- Teste da importação com Gemini real: `backend/scripts/tmpImport.ts` (temporário, não commitado).

## 8. Armadilhas conhecidas

- **Escapes em heredoc/Python**: inserir código TS com `\n`, `\b`, `\.` por heredoc corrompe (vira quebra de linha real). Use Edit/Write para trechos com barra invertida. Aconteceu várias vezes.
- **Incidente de segurança (já tratado com o Gustavo)**: URLs de banco/Redis com credenciais foram impressas num log; o Gustavo foi orientado a rotacionar. Nunca reproduzir valores de `.env`.
- Zod `url()` aceita `javascript:`: use `httpsUrl` (https-only) + checagem de pertencimento à biblioteca.
- Editar o status de um registro no Core exige passar `ends_at` junto.
- A classificação automática bloqueia `gh pr merge` sem revisão: mergear só com autorização explícita e depois de revisar o diff.
- Merge só foi autorizado para a pilha do cérebro original e o #73. **Nada de #74–#80 foi mergeado.**

## 9. Arquivos locais não commitados (não subir)

`.claude/launch.json` (alterado), `backend/scripts/tmpAmanda.ts`, `backend/scripts/tmpImport.ts`, `docs/benchmark/BASELINE-DESIGNER.md`, `handoff.md` (outro assunto: proposta de design em lote), este arquivo.

## 10. Registro no Tzolkin Core

Tenant `7d5f75ba-5dd0-4136-a30c-c9c3372c346e` (Assinatura Marca Própria), engagement Designer `7b59ff31-1f30-4227-ab58-16ee612c342c`. Registros desta frente: "Importar ficha de um manual (PR #78)" e "Pipeline lê a ficha + desdobramento + status por bloco (PRs #79 e #80)". O Core marca "Revisão do designer" como feita, mas a Gabriela diz que ainda não validou: atualizar quando ela validar.

Doc de acompanhamento (Claude Doc): https://claude.ai/code/artifact/365b5fcf-feb8-4e2d-8370-b2be4ebdf1e6 (última atualização anterior às fatias 2 e 3).

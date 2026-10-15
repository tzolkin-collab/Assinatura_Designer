# Handoff: Cérebro de IA do Designer (estado em 2026-10-15; ver a seção 11)

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

## 3. Migrations (APLICADAS no banco em 11/10)

`20261011120000_add_brand_collab` e `20261011150000_add_brand_profile` (ambas aditivas). Já aplicadas; o texto abaixo descreve o comportamento de quem rodar o código novo num banco sem elas. O código novo **não quebra sem elas**: se a leitura da ficha falha, a geração segue sem cérebro, com aviso no log (`Não foi possível ler a ficha do projeto`). Mas as telas Cérebro, Visão geral, Galeria de desdobramentos e a importação dependem das tabelas.

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
   **Atualização 11/10 (noite):** (a) as migrations `add_brand_collab` e `add_brand_profile` **foram aplicadas** no banco (`migrate status`: up to date) e (b) a ficha da Amanda **foi gravada** (`--apply`; rodar de novo recusa sem `--force`). Conferido lendo do banco: `loadBrainLayers('amanda-coelho')` devolve a ficha, o cérebro fica ativo sem a flag, fontes oficiais Queens/Aeonik, e marcas sem ficha seguem desligadas. A produção atual (`main`) ignora a ficha: ela só passa a valer quando o #79 for mergeado.
   **Geração real da Amanda SEM a flag (11/10, noite):** o cérebro ligou sozinho pela ficha. Rodada 1 (pilha como está, sem o #74): revisor 35, reprovado, porque a "Amanda" gerada por IA que está na biblioteca foi reaproveitada em 4 slides. Rodada 2 (pilha + #74 mesclado só numa branch local descartável `tmp/gen-test`): revisor 75, aprovado, 0 imagens, 5 molduras padrão, texto literal nos 7 slides, fonte substituta avisada (Playfair + Manrope no lugar de Queens/Aeonik), 208 s, US$ 0,40 estimados. **Conclusão: o #74 TEM de entrar junto com a pilha. FEITO:** mesclado na branch do #80 (commit `687e9a9`, conflito resolvido) e propagado ao #81; 988 testes passam. O #74 segue como PR próprio para `main`: pode entrar antes ou junto, sem conflito no git (mesmo conteúdo). Ele é independente (base `main`) e conflita em `imageResolver.ts` e `brandContext.ts` com a herança de biblioteca da #80; a resolução está no commit da branch local `tmp/gen-test` (manter `brandId: { in: libraryBrandIds }` + o filtro `source: { not: 'ai-generated' }`, e `source` no select dos assets do pai). Ajustar também o teste `providedAssets.test.ts` (`where.brandId` vira `{ in: ['brand-1'] }`). Dois decks de teste ficaram na conta da Amanda no banco (posts `604108e4…` nota 35 e `c813c011…` nota 75).
   **Parte 2 (resta):** (c) enviar logo/manual para a biblioteca e completar a ficha na tela; (d) rodar uma geração real da Amanda **sem** `DESIGNER_BRAIN_BRANDS` e conferir; (e) só então remover `DESIGNER_BRAIN_BRANDS` (`enabled.ts`, usos em `pipeline.ts`/`brain`), `seeds/amandaCoelho.ts`, `PROJECT_MEMORY_SEEDS`, `PROJECT_OFFICIAL_FONTS` e o teste de equivalência `amandaProfile.test.ts`. Remover antes de a ficha estar no banco tira o cérebro da Amanda (já está; falta só a geração real e o item (c)).
2. **Modo e-book A4**: o pipeline só gera apresentação 16:9 e carrossel (imagem avulsa com proporção). E-book A4 precisa de formato/tela/renderizador novos.
3. **Geração real com ficha no banco**: nunca rodou (banco sem migrations). Tudo está coberto por testes (971 no backend, 174 no frontend), mas não por Gemini real com ficha.
4. **Páginas Histórico e Desdobramentos**, reorganização da sidebar (renomear "Marca" → "Projeto"; remover duplicidade "Minhas Marcas/Projetos da Equipe"), conforme o review por função.
5. **Tela para editar a ficha própria de cada desdobramento** (hoje só o contexto do cadastro entra na camada de collab).
6. **Conferência de trechos em PDF/imagem**: só a pessoa confere (a tela avisa). Conferir em código exigiria lib de leitura de PDF: decisão de dependência do Gustavo.
7. Pendências menores: `[marca]/configuracoes/agent` tinha 5 problemas de eslint antigos (não são das mudanças recentes); decidir o PR #50 do Jules.

## 5.1 Enquadramento de fotos (achado e correção, 11/10)

**Problema verificado.** A foto entra no espaço com `object-fit: cover` e `object-position: 50% 50%`, sempre o centro, e o sistema não sabia onde está o assunto. O editor dizia explicitamente "foto nova começa centralizada". Retrato com rosto no terço de cima, ou pessoa pequena fora do centro, perdia a cabeça. Medido, não suposto.

**Como foi medido.** 6 fotos de teste (4 recortes do moodboard da Amanda + 2 imagens de IA da biblioteca, **usadas só para medir, nunca em deck**) × 5 formatos de espaço (3:4, 9:16, 1:1, 16:9, 3:1). Detecção do assunto com o Gemini real. Só as combinações em que a foto é de fato cortada contam.

| | centro (antes) | pelo assunto (agora) |
|---|---|---|
| combinações em que o rosto é cortado | 11 de 23 | 4 de 23 |
| rosto visível, média | 80% | 93% |

As 4 que sobram são **geometricamente impossíveis** (retrato fechado numa faixa 3:1 ou 16:9): nenhuma posição resolve, só outra foto, outro espaço ou `contain`. A tela avisa nesses casos.

**Caso real** (deck de teste da Amanda, slide 1, espaço medido em 0,77 de proporção, foto de IA 16:9): antes, a mulher aparece cortada na borda direita; depois, rosto e corpo inteiros. Os espaços reais do artista medem de 0,77 a 1,00.

**O que mudou.** `lib/photoFocus.ts` (geometria pura + detecção), `lib/photoFraming.ts` (baixa a foto, detecta, mede o espaço no Chromium, cache por URL), rota `PUT /posts/:id/slides/:i/photo` (foto NOVA sem posição → enquadramento automático; posição escolhida pela pessoa sempre vence; a mesma foto reenviada mantém o ajuste) e aviso no painel de fotos do editor. A resposta traz `framing: { mode: auto|center|manual|kept, faceVisible }`. Falhou a detecção ou a medição: centro, como antes, sem erro.

**Detalhes que custaram caro.**
- O artista dimensiona o espaço por **classe CSS**, não inline: ler `width/height` do `style` dá `null`. Por isso a proporção é medida de verdade (`scanHtmlLayout`).
- Com o raciocínio do modelo ligado, a detecção falhava (`MAX_TOKENS`, JSON cortado) em retratos simples. Desligado (`thinkingBudget: 0`): 6 de 6 detectadas e 1 a 6 s por foto.

**Limites e lacunas (não resolvidos).**
- **Export PPTX ignora `object-position`** (só lê `object-fit`): o enquadramento, automático ou manual, se perde no PPTX. Já era assim antes; precisa mapear para o recorte do pptxgenjs.
- **Fotos colocadas pelo artista durante a geração** (foto fornecida no briefing) continuam centralizadas: só o caminho do editor foi coberto. Próximo passo natural: pós-processar os espaços com foto no fim do pipeline.
- Teste com 6 imagens substitutas, **não** com fotos reais da Amanda (elas só existem no WhatsApp). Refazer a medição quando chegarem.
- A detecção é de um modelo: as caixas variam entre execuções (mudaram um pouco ao desligar o raciocínio). A folga em volta do rosto erra para mostrar demais, não de menos.
- Custo: uma chamada de visão (flash, imagem reduzida a 1024 px) por foto nova; cache em memória por URL, que some a cada reinício do servidor.
- Só rosto/pessoa/objeto principal; não zooma (o `cover` não amplia além do espaço).

## 5.2 Avaliação de resultado do ciclo (11/10)

**Geração real da Amanda, 7 slides, texto aprovado, sem fotos, sem a flag:**

| rodada | código | revisor | resultado |
|---|---|---|---|
| 1 | pilha sem o #74 | 35, reprovado | a "Amanda" gerada por IA da biblioteca foi reaproveitada em 4 slides |
| 2 | pilha + #74 | 75, aprovado | 0 imagens, 5 molduras no lugar da foto, texto literal nos 7 slides |

Custo ~US$ 0,40 por deck (R$ 2 a R$ 3), 208 s. Muito abaixo da estimativa de R$ 20 a R$ 50.

**O que isso prova:** o cérebro liga sozinho pela ficha; a regra de foto real e o texto literal se sustentam; o #74 é indispensável; o custo cabe com folga no teto de R$ 200/mês.

**O que isso NÃO prova:**
- Foi **um** deck, de **um** projeto. Não é uma amostra.
- O revisor é do mesmo modelo que gera: nota 75 não é validação da Gabriela, que disse que o Designer ainda não foi validado.
- 5 dos 7 slides saem com moldura vazia (não há fotos reais da Amanda): o visual final ainda não foi visto de verdade.
- Queens e Aeonik não estão instaladas: a arte usa Playfair Display + Manrope, o que a Gabriela pode reprovar.
  **Atualização 12/10:** o uso de fonte própria está construído (`backend/src/lib/customFonts.ts`, rota `/api/public/fonts/:assetId`, `fontFaces` no `content` do deck). Basta enviar o arquivo à biblioteca e marcar a fonte como "Arquivo oficial enviado" na ficha (com `fileUrl` ou nome de arquivo contendo a família). Sem arquivo, tudo segue como antes. Limites: o PPTX leva só o nome da fonte; `htmlRender` (cache) não embute a fonte, para não inflar o banco.
- Os **8 testes de aceite do Checklist Operacional não foram rodados** (nem o de e-book A4, que não existe).
- Marcas além da Amanda não foram exercitadas; desdobramento/collab só foi coberto por teste automatizado.

**Dívida de teste:** a geração real roda fora do app (script direto no pipeline, sem worker nem fila). Nada foi testado pelo caminho de uso real (chat → fila → worker → editor).

## 5.3 Avaliação dos posts da Amanda: repetição versus progresso (12/10)

Crítica do Gustavo: "muita coisa repetida ali ao invés de progresso real". Verificado nos posts do banco (renderizados e medidos), e **procede em grande parte**.

**O que existe.** Conta da Amanda: 9 posts, **5 decks com o mesmo título e o mesmo texto** ("Estratégia para uma vida mais extraordinária", de 05/10 a 11/10), mais 2 "VAREJO+ PIUMHI", 1 que falhou e 1 sem nome. O banco todo tem 42 posts; os 30 de `assinatura` e `tzolkin` são antigos e sem nome, não avaliados.

| deck | quando | fontes que renderizam | imagens geradas por IA | molduras vazias |
|---|---|---|---|---|
| ff862294 | 05/10 (base) | Queens/Aeonik **não instaladas: cai numa serifa padrão** | 0 | 6 |
| 369acf21 | 11/10 18:27 | Playfair + Plus Jakarta | **3 (pessoa gerada)** | 0 |
| 2a92a039 | 11/10 18:33 | Playfair + DM Sans | 0 | 5 |
| 604108e4 | 11/10 22:41 | Playfair + Manrope | **4 (pessoa + cena de feira)** | 0 |
| c813c011 | 11/10 22:49 | Playfair + Manrope | 0 | 5 |

**Progresso real (mas invisível no slide):** a pessoa gerada por IA saiu (369acf21 e 604108e4 → 2a92a039 e c813c011); o texto sai literal; o aviso de fonte substituta aparece; a ficha da Amanda existe como dado; o cérebro liga sozinho. Das 4 gerações de 11/10, duas acharam defeitos reais (a pessoa gerada e o #74 fora da pilha) e duas confirmaram o conserto.

**Repetição, sem progresso visual:** vistos lado a lado, os 5 decks têm **o mesmo esqueleto** (título escuro com moldura à direita, texto sobre creme com moldura, três colunas, bloco escuro com moldura). O visual de 05/10 e o de hoje são quase o mesmo. Corpo do texto está legível (28 a 34 px num slide de 1920×1080, medido), então o "texto pequeno" que parece nas miniaturas não procede.

**O que a ficha da Amanda proíbe e o resultado ainda faz:**
- Falta a **identidade**: nenhum slide tem o wordmark AMANDACOELHO nem o monograma A—C, e não há foto. O que sobra é título, texto e moldura cinza. Parece **template genérico**, o que a própria ficha diz para evitar.
- Slides 3, 4 e 6 de hoje têm grandes áreas mortas (texto ocupa 35%, 39% e 63% da caixa, o resto é vazio sem intenção).
- Quase tudo que aparece vazio é **dado que falta, não código**: logo e manual visual em imagem, fotos reais, arquivos das fontes.

**Conclusão:** o trabalho deste ciclo foi infraestrutura e regras (ficha, desdobramento, status do texto, enquadramento): necessário, e testado. Mas a **qualidade visível do deck não mudou**, e gerar o mesmo texto de novo não prova mais nada. Repetir a geração só volta a fazer sentido com insumos novos (logo, manual visual, fotos reais, fontes) ou com **outro texto/outro projeto** (a Assinatura, para provar que generaliza).

**Limpeza pendente (precisa de autorização):** 4 decks de teste na conta da Amanda (369acf21, 2a92a039, 604108e4, c813c011), todos com o mesmo texto. Manter só o de 05/10 como linha de base.

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


---

## 11. Atualização de 15/10/2026 (para quem continua)

> Esta seção é o estado mais novo. Onde ela contradiz as seções 1 a 10, vale ela.

### 11.1 O que entrou em `main` hoje

| PR | O que é | Obs. |
|---|---|---|
| #74–#81 | pilha do Cérebro (ficha, visão geral, ingestão, pipeline lê a ficha, desdobramento, status por bloco, Amanda como ficha) | #80 teve conflito com o #74, resolvido com merge de `main` na branch |
| #89 | entrada da Fábrica: copy estruturada de ~1.000 caracteres, fragmento `}]` no chat, rolagem até a pergunta ativa | a parte da rolagem provavelmente é desnecessária (ver 11.5) |
| #82–#85 | enquadramento pelo assunto, regra de foto real no chat, ferramenta de imagem respeita a regra, ativos da Amanda (o artista VÊ o manual como referência) | o #85 tira o manual visual de dentro do slide |
| #86 | preparar o Teste 2 e enquadrar a foto que o artista coloca | traz `loadAmandaPhotos.ts` e `teste2FotoReal.ts` |
| #87 | fonte própria da marca (@font-face no preview, revisor e exportação) | |

**Ainda abertos:** #88 (redesign de interface: preto e branco, Source Sans 3), #66, #62–#65 (UI/fonte/sidebar), #50 (Jules, recomendo fechar: de agosto, conflita com a galeria redesenhada).

### 11.2 Branch com trabalho pronto e sem PR

`feat/fontes-varios-pesos`: vários arquivos por família.
- `customFonts.ts`: `readFontMeta` (peso e estilo lidos de OS/2 e fvar, nunca do nome), `matchCustomFontFiles`, `pickFaces` (até 4 por família; estático dentro da faixa de uma variável é descartado; peso fora da grade conta como o alvo mais próximo; variável primeiro no CSS), `fontFaceCss` com peso e estilo, teto de 16 referências.
- `fontFamilies.ts` (frontend): mesmo contrato.
- `scripts/loadAmandaFonts.ts`: simula por padrão, grava com `--apply`; envia todos os `.ttf/.otf` das pastas `Queens/` e `Aeonik/`.
- Testes: `customFontsFaces.test.ts` com sfnt sintético (as fontes comerciais NÃO entram no repositório). Backend 1.106 testes, `tsc` limpo.

### 11.3 Estado do banco e do R2 (reais, compartilhados)

- **Amanda, fontes:** 16 arquivos na biblioteca (Queens Regular e Var; Aeonik, 14 arquivos). Ficha: Queens e Aeonik com `source: 'custom'` e `fileUrl`. Seleção atual: Queens 300–800 (variável) + Aeonik 250, 400, 500, 700.
- **Amanda, fotos reais: 0.** Os 8 JPEG do álbum de 05/10 estão em `Projeto Assinatura/WhatsApp Image 2026-10-05 at 19.03.*.jpeg` e NÃO foram carregados. Abrir cada um antes de subir (`scripts/loadAmandaPhotos.ts`, simula por padrão). Os `Gemini_Generated_Image_*.jpg` de Downloads são imagens de IA: não entram como foto.
- **Decks de teste que sobraram na conta da Amanda e da Assinatura** (apagar quando houver autorização): `369acf21`, `2a92a039`, `604108e4`, `c813c011`, `29edecc3`, `dcd8fabe`, `3af11ee0`, `f3038754`, `3f456f24` (Assinatura), `3e679a88`, `fdd630e5`, mais os criados pelo chat (`47f93965`, `5dc69b21`, e o da sessão `405693cb`). Manter o baseline `ff862294`. O classificador de permissões bloqueou a deleção direta no banco; o script está pronto (`backend/scripts/tmpClean.ts`, com guarda que aborta se um prefixo não achar exatamente um post).

### 11.4 Testes de aceite da Gabriela (o checklist dela)

Resultado em geração real contra `main`:

| Teste | Resultado |
|---|---|
| 1 Slide sem foto | passou (só logos, áreas reservadas, revisor 80) |
| 2 Slide com foto real | **não rodado** (faltam as fotos) |
| 3 Contexto fora da arte | passou |
| 4 Excesso de texto | **parcial**: texto preservado, sem slide extra, sem aviso de limitação |
| 5 Continuidade (lote 2) | **não rodado** |
| 6 Isolamento de identidade | passou |
| 7 E-book A4 | **não existe** |
| 8 Collab | **parcial**: só testes automatizados |

O checklist preenchido, na formatação original, está em `docs/CHECKLIST OPERACIONAL - preenchido 2026-10-15.docx`. É rascunho para o Gustavo revisar: o Google Doc da Gabriela NÃO foi alterado.

### 11.5 O que foi aprendido hoje (e muda a direção)

1. **Variedade de composição é o gargalo visível**, não a regra nem a fonte. Medida (mapa de ocupação 16×9, distância média entre pares de slides): GPT da Gabriela 0,12–0,47 por lote (mediana ~0,25); decks da Amanda 0,05–0,18. Os decks do teste 3 (0,47) e da Assinatura (0,52) mostram que o artista consegue variar quando o contexto da marca é menos engessado. Script: `backend/scripts/tmpVariety.cjs` (rodar sobre uma pasta de PNGs `*-slideN.png`). Métrica grosseira, não valida estética.
2. **A variedade do GPT vem da direção de arte por slide escrita no prompt da Gabriela**, não do modelo: um arquétipo de composição por imagem, fundo, hierarquia, elemento editorial, regra de não repetir divisão nem posição de título em slides consecutivos, lista de proibições (sem sombra, degradê, círculos, várias caixas, "estética de template"). O Designer recebe só o texto de cada slide. Não é uma comparação com os mesmos insumos.
3. **Teste justo ainda não feito:** dar ao Designer as mesmas direções por slide do lote 1 dela (conversa `chatgpt.com/share/6ac41d50-5488-83e9-84b7-1bc6dd2878ec`, prompt de ~9,5 mil caracteres) e medir com a mesma métrica. Se a variedade subir, falta um campo de direção por slide na entrada; se não, o limite está no artista e na ficha, e aí entra uma biblioteca de composições da marca.
4. **O visual chapado que ela pede (sem sombra, degradê, 3D) é o que HTML/CSS faz bem**; o que HTML não alcança é textura orgânica, ilustração e recorte complexo de pessoa.
5. **Correção de diagnóstico:** o "[DISPATCH] perdido" que apontei no meio do dia estava errado. A geração aguardava o cartão "Confirmar regra de foto real", escondido atrás do campo de mensagem; a minha mensagem seguinte cancelou o pedido pendente. Na tela maior o cartão apareceu normal, então a mudança de rolagem do #89 pode ser retirada.

### 11.6 Defeitos conhecidos e não corrigidos

- **Modo Auto vira Manual sozinho** e a Fábrica faz a pergunta guiada "Qual o destino da peça?" antes de gerar.
- **O assistente diz "Já comecei a gerar"** enquanto a confirmação da regra de foto real ainda está pendente (o cartão avisa "Ainda não comecei", mas a frase anterior contradiz).
- **O planner inventa títulos de slide** que não estão no texto aprovado ("O Poder da Decisão", "O Custo da Falta de Direção"). O texto do slide sai literal, mas o nome do slide no roteiro não.
- **A fonte substituta mudava a cada geração** (Playfair, Manrope, DM Sans, Cormorant). Resolvido para a Amanda agora que há arquivo; continua valendo para marcas sem arquivo.
- **PPTX leva só o nome da fonte** (pptxgenjs não embute). Exportar para Canva ou imagem.
- **Cada arquivo de fonte embutido pesa ~0,3 a 0,7 MB por slide renderizado** (1,3 MB hoje). Se pesar, embutir só os pesos usados naquele slide.
- Sinalização de conflito entre versões de texto: não encontrei implementação (item 2.5 do checklist da Gabriela).
- Modo e-book A4 e ações "Nova imagem" / "Novo e-book A4" no projeto: não existem.

### 11.7 Como rodar localmente sem tocar na fila compartilhada

`Projeto Assinatura/.claude/launch.json` tem a configuração `designer-backend-local` (porta 4000, `RUN_WORKER_IN_PROCESS=true`, `BULLMQ_PREFIX=dev-local`, `ZOMBIE_POST_SWEEP_ENABLED=false`). **Não use `designer-backend`**: ela usa o prefixo de produção e o worker consumiria jobs de outros usuários. O banco e o Redis continuam sendo os reais. Login local: a conta de seed do projeto (`prisma/seed.ts`).

### 11.8 Próximos passos, em ordem

1. Commitar e abrir o PR de `feat/fontes-varios-pesos`.
2. Carregar as 8 fotos da Amanda (abrindo cada uma) e rodar o Teste 2 com `scripts/teste2FotoReal.ts`.
3. **Rodar o teste justo de variedade** (11.5, item 3) com o lote 1 do prompt da Gabriela.
4. Conforme o resultado: campo de direção de composição por slide na entrada e no planner, ou biblioteca de composições da marca.
5. Rodar os testes 5 (continuidade) e 8 (collab real) e fechar o checklist.
6. Só depois: #88 (redesign) e o aviso à Gabriela de que pode testar.

### 11.9 Arquivos locais e limpeza (atualizado em 15/10, à noite)

- Em `main`: `backend/scripts/aceiteCerebro.ts` (testes de aceite), `renderizarDeck.ts`, `medirVariedade.cjs`,
  `docs/benchmark/` (baselines, insumo do lote 1 da Gabriela) e o checklist preenchido em `.docx`.
- **Fora do git, de propósito**: `insumos-amanda/` (fontes comerciais da Amanda, e `scripts-temporarios/` com os
  `tmp*.ts` antigos) e `testes-aceite-*/`. Nunca commitar as fontes.
- `handoff.md` (raiz) segue só local: proposta de Design em lote, de 06/10, anterior a tudo isto.
- Branch `docs/acabamentos-designer` (plano de acabamento de 21/09) foi para o GitHub, sem PR.
- Há um `git stash` com o teto de clientes DCR "não utilizados" do MCP, incompleto (3 testes quebram). É melhoria de
  segurança a terminar, não um descarte.

# Acabamentos — Designer IA (Assinatura)

> **Levantado em:** 2026-09-21 · **Base:** código no `main` (`d7ab464`), app em produção (`designer-alpha-plum.vercel.app`),
> `docs/ROADMAP.md`, `docs/PLANO-CONSOLIDACAO.md` e os itens (a)–(M) do briefing de acabamento.
> **Convenção:** ✅ verificado (código ou app no ar) · 🟡 HIPÓTESE (não verificado) · ❓ depende de decisão sua.
> **Estado (21/09):** 12 decisões respondidas — ver **§6**. Contrato complementar lido — ver **§1.1**. Próximo passo: **Fase 0**.

---

## 0. O que esta versão NÃO tem (leia antes)

| Lacuna | Efeito | Como fechar |
|---|---|---|
| **Aditivo do Designer não existe nos documentos que vi.** Li o contrato principal (01/04/2026) e o **contrato complementar (26/05 → 25/08/2026)**: **nenhum cita o Designer**. O complementar cobre só a Frente Gabriela (Secretária A.I.) e a Frente Marcelle. O único cronograma escrito é o da Frente Marcelle (Notion). | O acabamento inteiro é, **por texto, escopo não previsto** (§1.1). | Registrar por escrito escopo e critério de término, mesmo sendo por conta da casa (§6, decisão 7). |
| **O `.docx` do complementar não mostra assinaturas** (blocos em branco; não é o PDF do D4Sign). | Não sei se foi assinado. | Conferir (§6, decisão 6). |
| **Benchmark sem teste lado a lado.** Só vi o Claude Design pelas suas capturas de tela. | A seção 1.3 traz o protocolo e o que as capturas mostram, não uma tabela de notas. | Rodar o protocolo da 1.3 (3 briefings × 3 ferramentas). |
| **Item (j) Galeria:** a resposta (21/09) foi "deve ficar junto do brandbook, com a mesma configuração de hoje, dentro da configuração de marca". | Interpretei como **biblioteca de mídia/assets** (hoje em Configurações › Mídia). 🟡 | Confirmar se é isso ou a galeria de artes geradas (§6, decisão 5). |
| **Item (e) Adobe:** não verifiquei o que a API/SDKs da Adobe permitem hoje. | Proposta marcada 🟡. | Spike de 1 dia antes de prometer (seção 3, Fase 5). |

---

## 1. Diagnóstico

### 1.1 Escopo do contrato × o que foi entregue × cronologia

**Premissas de 13/07** (`ROADMAP.md`) — e como cada uma conflita com o que a equipe pede agora:

| Premissa registrada | O que a equipe pede agora | Conflito |
|---|---|---|
| "Não é um SaaS. Sem planos, sem cobrança, sem self-service." | Dor 4: "custo menor que a assinatura dos concorrentes"; item (g): tenants, equipe, limites de armazenamento por tenant. | ✅ **Resolvido (21/09): ferramenta interna, mas com equipe.** Sem SaaS, sem cobrança; RBAC e convites ficam; "custo menor que os concorrentes" é comparação de custo de operação, não de preço. |
| "Canva é o único caminho de entrega; arte pronta, não editável." | Dor 2: "resultado fácil de alterar". | ✅ **Resolvido (21/09): edição dentro do Designer**, não via PPTX/Canva. O editor foi enxugado em 18/07 (`editor/[postId]/page.tsx:3-6`) com a decisão "a edição fina é no Canva via PPTX e pelo chat". O próprio editor no ar diz: *"Para edição visual completa, baixe o PPTX e abra no Canva/PowerPoint"*. |
| Features 03 (agendamento) e 04 (cobrança) canceladas. | Nada pedido. | — (mas `configuracoes/billing` ainda existe em duas rotas: `app/configuracoes/billing` e `app/[marca]/configuracoes/billing`.) |

**Cronologia (do git e dos docs):**

| Quando | Marco |
|---|---|
| 13/07 | Roadmap com premissas (não-SaaS, Canva único). |
| 16–19/07 | Primeiras artes em produção (6, 15 e 50 slides na galeria). |
| 18/07 | Editor enxugado; html-design vira o único formato. |
| 20–21/07 | Plano de consolidação: 4 motores legados removidos (~4.500 linhas); `imageResolver` (Nano Banana) plugado. |
| 21/07 → 03/08 | **Duas semanas de qualidade caída sem ninguém ver** (um SVG na biblioteca derrubava a decisão de imagem do deck inteiro; erro engolido por `catch` + `logger.warn`). Corrigido na #39. |
| Ago–set | Rastro de geração (`GenerationRun/Step`), logo transparente, chat com raciocínio e ferramentas, tipografia como lista. |

**O contrato principal (assinado em 01/04/2026), lido em 21/09:**

| Cláusula | O que diz | Consequência para o acabamento |
|---|---|---|
| 1.1 | Consultoria, diagnóstico, desenvolvimento e implantação de IA e automação. **"Foco inicial em duas frentes": Gabriela (expansão de novos negócios e assessoria) e Marcelle (projetos em geral).** | **"Designer" não aparece no texto** — nem brandbook, tenants, MCP, Adobe. Pedro e Matheus (criativo) e "clientes × marcas" também não são citados. |
| 2 e 3, 4.2 | Diagnóstico primeiro; depois **cronograma executivo formalizado em aditivo**; as parcelas seguintes vinculadas à evolução e à **"entrega final do sistema em pleno funcionamento, de acordo com o escopo previamente aprovado"**. | O escopo do Designer vive no aditivo (não achei). Sem ele por escrito, "acabamento" não tem linha de chegada e o pagamento fica sem critério objetivo. |
| 2.1 (xvi) | Integrações "com WhatsApp, Asana, Google Agenda, Google Drive, Canva **ou outras necessárias**". | Drive, Canva e Asana estão cobertos por nome. Adobe e Figma só entram pela cláusula aberta "outras necessárias" — defensável, mas não é automático. |
| 2.1 (xviii), (xxii), (xxiv), 14.2 | Correções e refinamentos **compatíveis com o escopo aprovado** estão incluídos; **nova demanda, expansão ou alteração exige novo alinhamento e aditivo**. Entrega final = funcionalidades do escopo aprovado implementadas e operando. | Regra de corte abaixo. |
| 2.1 (xiv), (xvii) | Relatório semanal e MVPs para validação. | Este documento serve de base do próximo relatório. |
| 9.2, 14.3 | Tudo o que a contratada produz é **propriedade exclusiva da contratante**; a contratada não pode usar os produtos, "seus extratos, trechos ou partes", **a qualquer tempo**. | 🔴 Conflita com transformar o Designer em produto multi-cliente (tenants, quotas, "custo menor que a assinatura dos concorrentes"). Ver §5 e §6. |
| 14.1 | **Sem subcontratação**, salvo autorização expressa da contratante. | A parte contratada é uma pessoa jurídica só (Lucas). Confirmar se quem executa o Designer, além dela, está coberto por autorização escrita (§5). |

**O contrato complementar (26/05/2026 → 25/08/2026), lido em 21/09** (`Contrato_Assinatura_Tzolkin.docx`):

| Cláusula | O que diz | Consequência |
|---|---|---|
| 1 e 3 | Dois eixos: **Frente Gabriela** (Secretária A.I. e automações de rotina) e **Frente Marcelle** (automação de projetos e controle operacional). **"Designer" não aparece.** | O Designer não está coberto por nenhum contrato que eu tenha visto. |
| 2 | Vigência de 3 meses; **terminou em 25/08/2026**; renovação "por comum acordo mediante aditivo escrito". | Sem renovação escrita, **hoje não há contrato vigente**. A galeria mostra artes até **24/08** (véspera do fim). 🟡 O status "Descontinuado" do Notion (14/09) é compatível com isso. |
| 3.1 | "Novas funcionalidades não previstas: **Não** — novo escopo, prazo e valor à parte." | Todo item (a)–(M) é, por texto, escopo novo. |
| 9 | Fora do escopo: uso por outros usuários/áreas/clientes não previstos · **novas integrações não previstas** · novos dashboards/telas/funcionalidades · treinamentos extensos · suporte e evolução após os 3 meses. | Adobe, MCP e a equipe de Pedro e Matheus caem aqui. |
| 7 | Aceite: entrega funcional · teste com dados reais · pendências separadas em *bug × ajuste de fluxo × novo escopo* · validação da responsável · 5 dias úteis para retorno (silêncio = validado). | Modelo direto para o critério de aceite do acabamento. |
| 6 | Pagamento mensal "conforme valor acordado" — **o valor não consta no documento**. | Não consigo cruzar com o financeiro. |

**Decisão de 21/09: o acabamento é feito por conta da casa, sem aditivo.** É uma decisão comercial legítima. Uma recomendação (não é parecer jurídico): **registrar por escrito** — e-mail ou página no Notion, com aceite da Gabriela — o **escopo**, o **critério de término** e a **regra de aceite** da cláusula 7. Sem linha de chegada, "por conta da casa" vira manutenção ilimitada, que a própria cláusula 9 exclui, e deixa em aberto as questões de propriedade intelectual e subcontratação (§5).

**Regra de corte para priorizar** (o que fazer primeiro, já que não há aditivo que limite o volume):

| Núcleo (refino do que a Gabriela já usa) | Capacidade nova (fazer depois do núcleo, com limite declarado) |
|---|---|
| `/btw` → Orientações e Pausar · prompt de ingestão · cadastro correto da Assinatura · aprovação de mudanças na marca · custo por deck · publicar como snapshot · editor básico · Drive/Canva/Asana melhores | **Adobe** (e) · **servidor MCP** (L) · equipe e quotas (g) · brandbook *criado* para Pedro e Matheus · camadas de asset (h) · equipe de workers e benchmark (dor 3 e 4) |

> **Leitura:** o trabalho até aqui foi **motor e robustez** (fila, custo, tracing, consolidação). O que os itens (a)–(M) descrevem é **a camada de marca e de trabalho da equipe** — que quase não recebeu investimento. Não é regressão; é a metade do produto que ainda não foi feita.

### 1.2 Configurações essenciais (o que uma marca precisa ter para o produto funcionar bem)

Hoje a marca é `BrandConfig`: `colors: String[]`, `primaryFonts: String[]`, `guidelines: String`, `logoUrl`, `presentationConfig: Json`. Comparado ao que o gerador realmente precisa:

| Configuração | Existe hoje? | Evidência |
|---|---|---|
| Logo com variantes (sobre claro / sobre escuro / mono) | ❌ Uma `logoUrl`. Tratada por heurística (`logoTransparency.ts`, fix `9389929`). | Na galeria de produção, **três decks da mesma marca mostram o logo de três jeitos**: caixa branca com logo, wordmark vermelho ilegível, e um **quadrado branco vazio**. |
| Paleta **com papéis** e pares texto/fundo permitidos | ❌ Lista plana. A própria tela diz: *"os nomes acima são referência para você, não papéis que o sistema aplica"*. | `branding/page.tsx` (`COLOR_ROLES`). Ingestão trunca em 12 cores (`mergedColors … .slice(0, 12)`). |
| Tipografia com papéis (título / texto longo / destaque) | ❌ Lista de nomes de Google Fonts. Tela diz: *"Arquivo próprio (.ttf) ainda não é suportado"*. | Fontes de brandbook (Adobe/licenciadas) não entram. **Caso real:** a Assinatura usa *Monument Extended* + *Aileron* (brandbook); o cadastro em produção tem *Inter* e *Rubik*. Ver §2(b). |
| Sub-marcas / contextos de uso ("quando falarmos de…") | ❌ Não existe. O brandbook da Assinatura tem dois "braços" (Criatividade × Consultoria) com iconografia e cores próprias. | §2(b), teste com o brandbook real. |
| Regras DO / DON'T estruturadas | ❌ Um textarea (`Restrições`) + `guidelines` como JSON de 5 campos. | `brandGuidelines.ts`. |
| Brandbook como objeto | ❌ Vira um efeito colateral: os arquivos caem numa pasta "Brandbooks" e o texto é *mesclado* em `guidelines`. | `brandbookIngestion.ts`. |
| Políticas padrão de geração (tipo de imagem, destino, aprovação) | 🟡 Parcial. `presentationConfig` existe mas **só o planner/reviewer leem**, não o artista que escreve o CSS. | `PLANO-CONSOLIDACAO.md §1.3`. |
| **O chat pergunta as mesmas coisas a cada peça** (estilo + destino, tipo de imagem, objetivo, se há copy, Designer × Canva) | ✅ Isso é configuração disfarçada de conversa. | `agents/brain/prompts.ts` — checklist pré-geração obrigatório. Deveria ser default da marca, perguntado só quando difere. |
| Orçamento de IA | ✅ Existe e visível ("IA hoje 0 / 5 M tok"). | `config.ts`, `/ai-usage`. |

### 1.3 Benchmarking com o mercado

O subsistema de "benchmarking" foi removido do produto (#43); o que existe é a aba **Referências** (concorrentes de marca), que não é isso. Aqui o benchmark é **do produto contra Claude Design e ChatGPT**.

**O que as suas capturas mostram do Claude Design** (✅ das imagens; é o modelo do item M):
- Um painel "Design System" com navegação lateral fixa: *Overview · Colors · Typography · Spacing · Corner radius · Shadows · Components · Assets · Files*.
- Cada seção tem estado vazio explícito ("No colors yet."), botão **+ Add** e uma frase de *pedir ao Claude* ("Ask Claude for a palette, a dark or high-contrast theme, a contrast check…").
- Um bloco **"Not sure where to start?"** com 3 caminhos: *sincronizar de um repositório*, *construir a partir de conectores*, *subir arquivos de marca*.
- Overview inclui **Accessibility**: quais pares texto/fundo têm legibilidade garantida.
- O chat é uma coluna estreita; a área grande é o **workspace** da marca, não um preview.

**Protocolo para preencher a comparação (proposta):**

| | |
|---|---|
| Entradas fixas | 1 brandbook real (Assinatura) + 3 briefings: (A) curto, 1 frase; (B) com copy oficial colada; (C) deck de 30+ slides. |
| Ferramentas | Designer · Claude Design · ChatGPT. |
| Métricas | Tempo até o 1º slide e até o deck completo · custo (US$; nosso via `GenerationRun`, dos outros = assinatura ÷ uso) · **fidelidade de marca** (checklist: logo certo, fontes, paleta, contraste, regras DON'T) · nº de correções manuais até "aprovável" · **editabilidade** (abre no PowerPoint/Canva com texto editável?). |
| Quem avalia | Gabriela (uso), Pedro e Matheus (criação), **às cegas**. |

Sem isso, "igualar ou superar" não é uma meta — é uma esperança.

### 1.4 Expectativa × Realidade

| Expectativa (dor da equipe) | Realidade verificada |
|---|---|
| **Decks longos a partir de briefing + brandbook** | ✅ Gera. Teto de 300 slides (`MAX_SLIDES`); 50 slides em produção (19/07 e 17/07). ❌ Mas o "+ brandbook" é a parte fraca: ver §2 (a)(b). |
| **Fácil de alterar, máxima qualidade, menor tempo** | ❌ Alterar é o ponto mais fraco. O editor só tem: *Editar com IA*, *Código* (HTML/CSS cru), *Versões*, *Selecionar elemento*, *Baixar*. **Sem** editar texto direto, mover/redimensionar, trocar imagem, reordenar/duplicar/excluir/adicionar slide (busquei no código: nada). |
| **Nano Banana + Gemini como workers/sub-workers em equipe paralela** | 🟡 Existe em versão inicial: `brain` (2.5-pro) → `planner` → `artista` (3.1-pro-preview escreve HTML) → `imageResolver` (Nano Banana, ≤6 imagens/deck) → `reviewer` visual. Paralelismo: lotes de **3 slides** (carrossel: 1) em pool de **2** (`GENERATION_CONCURRENCY=2`) dentro de **2** jobs (`PIPELINE_CONCURRENCY=2`) ≈ 4 chamadas simultâneas; o 1º lote é sequencial (define a "style bible"). É um **pipeline de papéis**, não uma equipe que abre várias sessões. |
| **Custo menor que a assinatura dos concorrentes** | ❌ **Não medido.** Existe teto diário de tokens e tracing (`GenerationRun.totalInputTokens/OutputTokens`), mas **nenhum lugar mostra "custo deste deck"**. Por imagem: US$ 0,067 / 0,101 / 0,151 (comentário em `config.ts`) → até ~US$ 0,91 só de imagem por deck. Custo de texto: não calculado. |

### 1.5 Capacidade real de solução de problemas

- ✅ **Consegue se recuperar** de falha de infra: fila durável, retry, fallback de modelo, circuit breaker, sessão sobrevive a reconexão.
- ✅ **Consegue se auditar** depois: `GenerationRun/Step` guarda prompt, resposta, modelo e tokens.
- ❌ **Não percebe que piorou.** Não há conjunto de briefings de referência rodando periodicamente com nota. O incidente de 21/07–03/08 durou duas semanas *porque nada mediu a saída*. O `reviewer` julga o deck que acabou de gerar, não compara com a semana passada.
- ❌ **O bot não tem ferramentas para agir sobre a marca.** Ferramentas do cérebro: `editarSlides`, `updateBrandMemory`, `createAsanaTask`, `listAsanaProjects`, `generateRoteiroLink` (`agents/brain/skills.ts`). Nenhuma para: buscar/ver assets, ler o brandbook, consultar regras, procurar no Drive/Canva. Ele **sabe da marca só pelo texto que é colado no prompt**.
- ⚠️ **O bot altera a marca sem pedir.** O prompt manda `updateBrandMemory` "sem pedir permissão, seja proativa" (`prompts.ts`), e a ingestão de brandbook faz `upsert` direto de cores/fontes/guidelines. Isso é o "criação substituída a todo momento" do item (a).

### 1.6 Avaliação sincera: o sistema resolve as dores da equipe?

| Dor | Veredito | Por quê |
|---|---|---|
| 1. Automatizar apresentações longas (briefing + brandbook) | **Metade.** | Gera deck longo. Mas o brandbook não é entendido como brandbook (ver (b)), então a fidelidade de marca depende de o usuário lembrar de corrigir. |
| 2. Resultado fácil de alterar | **Não.** | O caminho é "edite pelo chat" ou "baixe PPTX". Para a Gabriela (Canva) isso pode servir; para Pedro e Matheus (Adobe) não. |
| 3. Igualar/superar Claude Design e ChatGPT | **Desconhecido.** | Sem benchmark. A arquitetura permite; a UX de workspace (item M) está atrás do Claude Design de forma visível. |
| 4. Custo menor que os concorrentes | **Desconhecido, provavelmente sim, mas não provado.** | Dá para provar rápido: `GenerationRun` já tem os tokens. Falta preço e uma tela. |

**Quem serve hoje:** Gabriela gerando decks curtos/médios com briefing claro — **sim, com ressalvas**. Pedro e Matheus na parte criativa de brandbooks — **ainda não**: não geram brandbook, não abrem arquivo Adobe, não editam com precisão.

---

## 2. Erros — item a item

Prioridade: **P0** bloqueia o resto · **P1** dor principal · **P2** importante · **P3** acabamento. Tamanho é relativo: **S** ≤ 2 dias · **M** ≈ 1 semana · **L** > 1 semana.

### (a) Criação de marca ineficiente — **P0**

**Verificado:**
1. Estrutura rasa (ver §1.2): cores e fontes são listas sem papel; guidelines é texto.
2. **Sem aprovação.** Ingestão de brandbook grava direto (`upsert` de `guidelines/colors/primaryFonts`), mescla e trunca em 12 cores; `updateBrandMemory` grava sem perguntar; upload de logo é convertido automaticamente (`logoTransparency.ts`). Só a troca de logo detectada pede confirmação (`logoNeedsConfirmation`).
3. Skills e configuração do bot ficam em páginas separadas (`configuracoes/agent`, `configuracoes/memoria`, `configuracoes/branding`, `configuracoes/referencias`, `configuracoes/midia`) — **cinco telas** para uma coisa só.

**Proposta:**
- **Brand Kit v2** (modelo de dados na §4): cores com papel + pares permitidos, fontes com papel + origem (google | upload | adobe), regras `DO/DONT` estruturadas com escopo (cor, fonte, logo, imagem, layout, tom).
- **Toda escrita na marca vira proposta** (`BrandChange`: antes/depois, quem propôs — usuário | IA | ingestão | memória — e status). Ingestão, `updateBrandMemory` e conversão de logo passam por ela. UI: lista de "Alterações propostas" com diff e Aprovar/Rejeitar (uma tela, no workspace do item M). Modo "confiar" opcional por marca para quem quiser o comportamento atual.
- **Unificar as cinco telas no workspace da marca** (item M). `configuracoes/` fica só com conta, equipe, integrações e uso.
- Mover o checklist pré-geração do chat para **defaults da marca** ("Configurações essenciais"); o bot só pergunta quando o briefing contradiz o default.

**Aceite:** nenhuma linha de `BrandConfig` muda sem um `BrandChange` aprovado (ou modo "confiar" ligado); regra "nunca usar X" cadastrada aparece no prompt do artista e bloqueia em código quando for verificável (fonte fora da lista, cor fora da paleta).

### (b) Não cria brandbooks — **P0**

**Verificado em `brandbookIngestion.ts`:**
- 🔴 **O prompt de ingestão está hardcoded para a marca Assinatura**: pede para "vetorizar a LOGO OFICIAL … o monograma 'A✦ ASSINATURA' … o ÍCONE DA ESTRELA DE 4 PONTAS … caixa/estoque, sacola, cadeado, gráfico de barras, alvo, coração, relógio, presente, bisnaga de creme…". Para **qualquer outra marca** o modelo é induzido a inventar esses elementos. Isto é um bug hoje, independente do resto do plano — **corrigir na Fase 0**.
- Os SVGs "do brandbook" que não vieram como SVG real são **re-desenhados por IA** (tag `ai-reconstructed`, até 15, modelo `fast`, `maxOutputTokens: 8192`). Não são as layers do designer; são aproximações. E o código tem "resgate de emergência" para JSON truncado — sinal de que estoura na prática.
- **PDF e imagem** vão ao Gemini só por visão, **máx. 6 partes** (`imagePartsForGemini.length < 6`). Brandbook de 40 páginas → lê 6.
- Formatos aceitos: zip, svg, html/css, png/jpg, pdf. **Não** aceita `.ai`, `.psd`, `.indd`, `.fig`, fontes (`.ttf/.otf/.woff`).
- Brandbook não é um objeto: sem versão, sem seções, sem "isto veio da página 12".
- **Armazenamento:** não achei nenhuma quota por marca/tenant (só teto de tokens de IA). `PostVersion` tem teto (20/post); assets e marcas, não.
- **Acesso da IA aos assets:** `Asset` tem `name`, `tags`, `source` — **sem descrição, cores dominantes, variante, transparência**. Desde a #39 SVGs não vão à visão do modelo (só raster), então **o modelo escolhe ícones SVG pelo nome do arquivo**.
- **Logo × fundo:** resolvido por heurística em prompt/código pontual (`9389929`, `5fcdd10`). Sem regra estrutural; a galeria de produção ainda mostra o defeito.
- **Referências:** existem (`Reference`, análise por Gemini, `galleryImageUrls`) mas só numa página de configuração. Não aparecem onde se trabalha, e só chegam ao planner/reviewer.

**Teste com o brandbook real da Assinatura (21/09)** — dois PDFs medidos com PyMuPDF e páginas renderizadas:

| | `ID Rebranding` | `Plataforma de Marca` |
|---|---|---|
| Natureza | **Identidade visual**: logo, paleta, tipografia, iconografia, estilo de imagem, assinatura de e-mail, editorias de Instagram | **Estratégia verbal**: personalidade, valores, promessa, benefícios, posicionamento, "a Assinatura fala sobre…" |
| Tamanho / páginas | 3,7 MB · 24 pág. (1366×768) | **23 MB** · 34 pág. (1440×810) |
| Origem (metadado) | PDF unido de vários PDFs (ferramenta de merge), mai/2025 | **Canva**, mar/2025 |
| Texto extraível | **11 de 24** páginas; 2.678 caracteres (páginas de logo/ícones/imagens não têm texto) | 26 de 34 páginas; ~14 mil caracteres |
| Fontes | Monument Extended + Aileron, **embutidas como subconjunto** | Monument Extended + Aileron |

**O que o brandbook tem e o Brand Kit não consegue guardar:**
1. **Paleta oficial com HEX + RGB + CMYK + Pantone** (6 cores: `#582731`, `#8A0E2E`, `#D41D59`, `#233766`, `#545BAE`, `#E9BDA6`). O sistema guarda só hex, sem par de uso.
2. **Logo em versão branca sobre cada cor da paleta** (p. 5 e 6): é uma regra de *variante por fundo*, exatamente o que faltou na galeria (logo sumindo/quadrado branco).
3. **Dois "braços" de marca — *Criatividade* e *Consultoria* —, cada um com iconografia, cores e estilo de imagem próprios**, com regra de uso do tipo *"a serem utilizados quando falarmos de: marca final, desenvolvimento de produto, criatividade, cosméticos…"* × *"…quando falarmos dos planos de serviço (extensão, estudo de mercado, estratégia, operação)"*. É a **regra de uso contextual** que você pediu no item (a) — e é **sub-marca dentro da marca**, coisa que o modelo atual (uma paleta, uma lista de fontes) não representa.
4. **Tipografia com papéis explícitos**: *Aileron* "predominante"; *Monument Extended* "do logo, para textos curtos que destacam palavras".
5. **Editorias de conteúdo** (Educação e Informações Técnicas · Cultura e Valores · Tendências e Inovações · Estudos de Caso) — pilares de conteúdo que o planner deveria conhecer.
6. **Voz e posicionamento** (5 traços de personalidade, valores, promessa, "De Sonho a Assinatura"): é o que dá o *tom* do texto do deck, e hoje a ingestão comprime tudo em "2–4 parágrafos" de `guidelines`.

**O que a ingestão atual faria com esses arquivos (do código; ainda **não** rodei a ingestão):**
- Cada PDF vai como **uma** parte inline ao Gemini (`imagePartsForGemini`), e o limite de **6 partes é global** entre todos os arquivos do upload. A `Plataforma de Marca` (23 MB) passa no limite do upload (25 MB por arquivo, `routes/brands.ts`), mas em base64 vira ~31 MB de requisição. 🟡 O limite de dados inline da API do Gemini costuma ser bem menor que isso — **testar**. Se falhar, o `catch` só faz `console.warn` ("IA Ingestion fallback") e a rota devolve **sucesso com nada extraído**: o mesmo padrão de falha silenciosa do incidente de 21/07.
- Mesmo quando lê, o prompt é de **6 imagens + 8.192 tokens de saída** para 58 páginas de brandbook.
- Não há como o texto, o CMYK/Pantone, as regras "quando falarmos de…" ou os dois braços chegarem ao Brand Kit — os campos não existem.

**O estado da marca Assinatura em produção hoje (lido no app, 21/09) — o efeito prático:**
- **Fontes cadastradas: `Inter` e `Rubik`.** Nenhuma é do brandbook. Aileron é uma fonte gratuita e Monument Extended é comercial 🟡 (licença a confirmar); **nenhuma das duas é Google Font**, e a tela diz que arquivo próprio (.ttf) "ainda não é suportado". **Hoje o Designer não consegue gerar um deck na tipografia oficial da Assinatura.**
- **Cores cadastradas: 12** — exatamente o teto do `.slice(0, 12)` — e **nenhuma é a paleta oficial**: há aproximações (`#ec4d72`, `#4141a8`, `#3e101f`) e quase-duplicatas (`#3e101f` × `#3c111c`; `#f9f6f0` × `#fdf9f8` × `#f6ebe4`). Com o teto cheio, qualquer cor nova é descartada sem aviso.
- O prompt de ingestão hardcoded menciona "bisnaga de creme" e "estrela de 4 pontas". A bisnaga é da iconografia real (p. 8 do `ID Rebranding`); nas páginas que renderizei, o logo é um **"A" manuscrito com "ASSINATURA / MARCA PRÓPRIA"**, sem estrela (🟡 não vi todas as páginas — o prompt pode descrever uma versão anterior).

**Proposta:**
1. **Brandbook como objeto de 1ª classe** (`Brandbook` + seções) que pode ser **enviado** (PDF/ZIP/SVG/…) **ou criado com o bot** (o bot monta seções: logo, cores, tipografia, grafismos, tom, exemplos de uso — e o usuário aprova cada uma via `BrandChange`).
2. **Ingestão v2**: extração **nativa** antes de IA — texto e vetores do PDF direto (PDF preserva paths; renderizar página→imagem só como reforço visual), fontes embutidas, SVG real intacto. IA só *classifica e descreve*, **não redesenha**. Páginas lidas em lotes (map-reduce), não 6 de 40. Prompt **parametrizado pela marca**.
3. **Inteligência por asset**: `description`, `kind`, `variants` (on-light/on-dark/mono), `dominantColors`, `hasTransparency`, `usageNotes`, `brandbookId`, página de origem. Gerada na ingestão, editável.
4. **Regra de contraste em código**, não em prompt: antes de renderizar, calcular a variante do logo/ícone certa para o fundo do slide; se nenhuma serve, falhar com aviso — nunca colocar cor sobre cor igual.
5. **Ferramentas para o bot** (o que falta hoje): `buscarAssets`, `verAsset`, `lerRegrasDaMarca`, `lerBrandbook(seção)`, `buscarReferencias`. O modelo passa a **consultar** em vez de receber tudo colado.
6. **Quotas por tenant** (marcas, MB, nº de assets, versões) com medidor no mesmo lugar do "IA hoje". `DELETE /assets` precisa apagar o objeto no R2 (item 1.2 do ROADMAP; 🟡 não reverifiquei se foi feito).
7. **Referências dentro do app** (item M): pasta "Referências" no workspace, com grid, origem (Pinterest/Adobe/Canva/site) e botão **"usar como referência nesta peça"** que injeta a análise no artista (hoje não chega a ele).

**Aceite:** enviar o brandbook de uma marca *que não seja a Assinatura* produz assets reais + regras com página de origem; nenhum SVG inventado; pergunta "qual logo vai sobre fundo escuro?" o bot responde consultando o asset, não adivinhando.

### (c) Grafismos e SVGs — **P1**

**Verificado:** `generate-svg` foi removido (#48); SVG é embutido inline pelo artista; SVG de brandbook entra como asset, mas **não** é visto pelo modelo de decisão de imagem (só raster). 🟡 Memória de 03/08 registra **XSS por SVG confirmado e não corrigido** — não reverifiquei hoje; há sanitização em `htmlDesign.ts`/`posts.ts` para o HTML dos slides, mas o SVG enviado pelo usuário vai cru ao R2. **Verificar antes de qualquer trabalho de SVG.**

**Proposta:** normalizar/sanitizar SVG **no upload** (remover `<script>`, `on*`, `foreignObject`, refs externas), guardar `viewBox`, cores usadas e camadas nomeadas; renderizar rasterização de referência para o modelo *ver* o SVG (thumbnail PNG na ingestão); **biblioteca de componentes de SVG** com nome/descrição para o artista reusar (o vocabulário de componentes da #44 é o ponto de partida).

### (d) Conversão de formatos — **P2**
`imageNormalizer.ts` tem `CONVERSION_RULES`; a ingestão de brandbook **não** o usa para PDF/AI/PSD. Proposta: um único `assetPipeline` (entrada: qualquer arquivo → saída: original + raster IA-ready + SVG limpo quando houver + metadados). `.ai` moderno é frequentemente PDF-compatível 🟡 — testar com um arquivo real do Pedro/Matheus antes de prometer.

### (e) Sem integração de contas Adobe — **P2, ✅ escopo definido (21/09), spike pendente**
Nada no código (busquei `adobe|figma|behance`: só nomes de formato). **🟡 HIPÓTESE:** o que dá para fazer depende de qual recurso importa (Fonts? Bibliotecas do CC? Express? Firefly?) e de aprovação/licença da Adobe — **não verifiquei**. Caminho seguro enquanto isso: **upload de pacotes exportados** (PDF/SVG/ZIP/fontes licenciadas) via ingestão v2.

**Definido em 21/09:** usam **Illustrator, Photoshop, fontes e assets**, e a entrega "já vem com todos os SVGs, fontes, tudo" (a confirmar com uma amostra real). Consequências:
1. **Primeiro caminho = pacote do designer** (ZIP: SVG do Illustrator + fontes + PSD). Não depende de API da Adobe.
2. `.psd` → extrair **camadas** (🟡 biblioteca de leitura de PSD, ex. `ag-psd`, a validar) — casa com o item (h). `.ai` → 🟡 costuma ser PDF-compatível, ou o designer exporta SVG.
3. **Conta Adobe** (Fonts, bibliotecas): 🟡 **spike de 1 dia** antes de prometer. Risco de licença: Adobe Fonts é licenciada para uso via conta/kit, **não** como arquivo para hospedar — ver §6, decisão 9.
4. **Conta Canva Pro**: 🟡 o spike também precisa dizer o que a API do Canva expõe sem plano Enterprise (Brand Kit, fontes, modelos).

### (f) Drive/Canva/Asana "simplista e brutalista" — **P1**
**Verificado:** três popups separados (`DrivePopup`, `CanvaPopup`, `AsanaPopup`), cada um com sua casca; só o Asana tem ferramentas do bot. Drive lista e baixa arquivo (`/google/files`, `/download`); Canva lista designs e importa.
**Proposta:** um **catálogo de conectores** dentro do workspace ("Arquivos"): navegação em árvore, busca, pré-visualização, "importar para a marca" (vira `Asset` com origem) e **ferramentas do bot para os três** (`buscarNoDrive`, `buscarNoCanva`, `buscarNoAsana`). Base já existe (`connectorOAuth.ts`, `tokenCrypto.ts`). 🟡 O `PLANO-CONSOLIDACAO §1.2` (20/07) registrava token do Asana e do Google em texto puro e só o Canva criptografado; as tools do bot já usam `tryDecryptToken`/`encryptToken`, então provavelmente foi corrigido — **não reverifiquei**.

### (g) Sem gestão de equipe e marcas — **P1, ✅ decidido (21/09): Equipe Assinatura → Marca**
**Verificado:** `BrandMember` + papéis (OWNER/ADMIN/EDITOR/VIEWER) + convites + página de equipe existem. `GET /settings/tenants` só **lista**. Memória do bot é por marca (`getBrandMemory(brandSlug)`); **não há contexto por usuário**. Já houve **marcas duplicadas** (`assinatura`, `assinatura-marca-propria`, `assinatura-marca-pr-pria`).
**Decidido:** ferramenta interna **com equipe**; hierarquia **Equipe Assinatura → Marca** (sem nível "Cliente"). Portanto:
- **Uma `Team` (Assinatura)** com membros e papel no time; `BrandMember` continua como **restrição/override por marca**. 🟡 Regra padrão sugerida: o papel no time vale em todas as marcas, salvo restrição explícita.
- `UserBrandContext`: preferências do usuário naquela marca, separadas da memória da marca.
- Criar / arquivar / **mesclar marca** (já houve duplicatas).
- Painel de uso por marca e por usuário. **Quota** só como controle de custo interno (armazenamento e IA), não comercial.
- Sem `Client`, sem cobrança, sem multi-cliente — coerente com as cláusulas 9.2 e 14.3 do contrato principal.

### (h) Camadas de assets antes do pré-render — **P2**
`imageResolver` gera a imagem **achatada**. Proposta 🟡: pedir ao Nano Banana **sujeito em fundo liso** + remoção de fundo → PNG com transparência como camada separada, com `role` (fundo | sujeito | textura); o artista compõe. Custo e qualidade a medir no benchmark antes de comprometer.

### (i) Editor sem ferramentas básicas — **P1, ✅ decidido (21/09): editar dentro do Designer**
**Verificado:** ver §1.4. **Decidido:** a edição é **dentro do Designer** — "mais possibilidades, design mais sofisticado e moldável pela IA com código". Isso **reverte a decisão de 18/07**: PPTX e Canva viram **exportação**, não o caminho de edição. **Novo requisito:** usar recursos do **Canva** e, em contas Pro, do **Adobe** e outros como **fonte** dentro do Designer (importar assets, fontes, designs) — ver (e) e (f).
**Painel mínimo proposto:** editar texto direto (duplo clique) · mover/redimensionar · trocar imagem (da biblioteca) · trocar cor/fonte **só entre as da marca** (respeita regras) · reordenar/duplicar/excluir/adicionar slide (com miniaturas) · desfazer/refazer · alinhar/distribuir. A base é HTML/CSS por slide; o caminho realista é **overlay de seleção + patch no HTML** (já existe "Selecionar elemento" e edição sanitizada de código — `PUT /posts/:id/slides/:index/code`), não um canvas novo.
**Integrações prioritárias (justificadas):**
1. **Google Drive** — Gabriela e cliente entregam material lá; já conectado. Alto valor, baixo custo.
2. **Canva** — destino de entrega e fonte de brandbooks da Gabriela; já conectado (OAuth mais robusto dos três).
3. **Asana** — briefing e aprovação; já conectado e com ferramentas.
4. **Adobe** (Illustrator, Photoshop, fontes, assets) — valor alto para Pedro/Matheus; primeiro por **pacote**, depois por conta → spike (item e).
5. **Figma** — 🟡 só se algum dos três usar; **não priorizar sem confirmar**.

### (j) Galeria — **P2, ✅ direção dada (21/09), interpretação a confirmar**
**Observado no ar:** artes chamadas por hash ("Arte 5bd3b0f9"), sem título humano; lista de pastas (Apresentações/Designs, Todas as Artes, Sem Pasta); os três logos inconsistentes do item (b). **Resposta (21/09):** "deve ficar junto do brandbook e ter a mesma configuração de hoje, porém na parte de configuração de marca — mesmo problema das skills e memórias em local separado".
**Interpretação 🟡:** a **biblioteca de mídia/assets** (hoje em Configurações › Mídia, longe do brandbook) passa a viver **dentro da configuração de marca, ao lado do brandbook**, mantendo a grade e as pastas de hoje. Skills e memória do bot também entram nesse mesmo lugar. A **galeria de artes geradas** (histórico de decks) fica onde está, ganhando nome humano e busca. **Confirmar** se é isso.

### (k) Sem ferramentas de edição para apresentações publicadas — **P1**
**Verificado:** a página pública lê `Post.content` e `slides` **direto do banco a cada acesso** (`routes/publicPresentations.ts`). Não há separação **rascunho × publicado**: qualquer edição — inclusive uma da IA — aparece **imediatamente** para quem tem o link, e o Canva não devolve edições.
**Proposta:** publicar = **snapshot** com número de versão (reusa `PostVersion`); "Atualizar publicação" explícito; comparar rascunho × publicado; despublicar/reverter; expiração e senha opcionais.

### (L) Sem MCP para conversar com outros bots — **P2**
**Verificado:** nenhuma rota/servidor MCP. O consumidor óbvio já existe no contrato: **a Secretaria AI da Gabi** (`Bot_Gabi/`, `secretarIa/`) — "pede um deck ao Designer" sem UI.
**Proposta:** servidor **MCP HTTP** com tokens por usuário/marca (escopo = RBAC atual). Ferramentas: `listar_marcas`, `ler_brand_kit`, `buscar_assets`, `criar_deck(briefing, formato)` → `run_id`, `status_da_geracao(run_id)`, `editar_slide`, `exportar(formato)`. Reaproveita fila e `GenerationRun` (já é o "id de acompanhamento"). Também o caminho inverso — Designer como *cliente* MCP — resolve (f) sem escrever um popup por conector 🟡.

### (M) UX/UI da área de preview do chat — **P0 (é o contêiner de quase tudo acima)**

**Verificado no ar (`/assinatura/fabrica`):** a área grande à direita, antes da geração, é um cartão vazio "**Preview em tempo real** — o design aparece aqui durante a geração". Depois, `ArtifactPanel` = abas *Preview / Fonte* + menu Baixar + Canva + Hospedar. **Um único tipo de conteúdo: o deck.** Nada de marca, assets, referências ou arquivos.

**Proposta — transformar a área em workspace da marca** (modelo: suas capturas do Claude Design):

```
┌ Navegação ──────┬ Conteúdo da seção ─────────────────────────────────┐
│ Visão geral     │  Cores            [+ Adicionar]                     │
│ Cores           │  "Peça ao bot: uma paleta, um tema escuro, um       │
│ Tipografia      │   teste de contraste…"                              │
│ Logos           │  [ ■ #171717 Primária · uso: títulos, fundos ]      │
│ Ícones/grafismos│  [ ■ #FFFFFF Superfície · par permitido com …  ]    │
│ Imagens         │                                                      │
│ Referências     │  ── Regras desta seção (DO / DON'T) ──              │
│ Brandbook       │                                                      │
│ Arquivos        │                                                      │
│ Alterações (3)  │  ← propostas pendentes do bot/ingestão (item a)     │
│ ─────────────── │                                                      │
│ ▸ Deck em foco  │  ← o preview atual continua aqui, como uma "aba"    │
└─────────────────┴──────────────────────────────────────────────────────┘
```

- **Visão geral** com "Por onde começar?" em 3 cartões: *Importar brandbook* (PDF/ZIP/SVG) · *Conectar* (Drive, Canva, Asana, Adobe quando existir) · *Colar site ou Instagram*.
- Cada seção: **estado vazio explícito**, **+ Adicionar**, **frases de pedir ao bot**, e **Regras** daquela seção.
- **Acessibilidade** na Visão geral: quais pares texto/fundo são garantidos (a regra de contraste em código do item b.4 alimenta isso).
- O chat **aponta para o workspace** ("adicionei a cor X — [ver em Cores]") e o workspace **abre a partir do chat** (`/marca`, `/referencias`), em vez de popups.
- Mobile/estreito: navegação vira um seletor no topo.

**Aceite:** uma pessoa nova consegue, sem ajuda, subir um brandbook, ver o que foi extraído, aprovar/rejeitar e abrir uma referência — sem sair da Fábrica.

### (extra) `/btw` → estado de "aconselhar em tempo real" — **P0 (rápido)**

**O que `/btw` faz hoje (✅ `fabrica/page.tsx:141,237,274-296`):** é **estado local do navegador**. Enquanto o bot responde, tudo o que você digita vira `/btw` e fica numa lista (`btwContext`); **só vai ao modelo quando você enviar a próxima mensagem** (é anexado como `[Contexto adicional]`, linha ~291). Ou seja: **não chega ao modelo em tempo real**. Além disso, `prompts.ts:23` instrui o cérebro sobre uma tag `/btw` que o backend nunca vê como tag.

**Proposta — dois gestos explícitos, sem comando:**

| Gesto | Comportamento |
|---|---|
| **Aconselhar** (Enter durante a geração) | Vira um item numa lista visível **"Orientações"** acima do campo: texto, hora, status `pendente → aplicada (etapa X)`. Editável e removível enquanto `pendente`. Backend: lista no Redis da sessão (`…:advice`); consumida em **pontos seguros** — cérebro: próximo turno; pipeline: **antes de cada lote de slides** e antes do revisor. WS emite `advice.applied {id, etapa}`. |
| **Pausar e enviar** (botão / Ctrl+Enter) | Interrompe agora. Cérebro: aborta o stream. Pipeline: **cancelamento cooperativo no próximo limite de lote** (flag no job; slides já gerados são mantidos — o pipeline já tem pausas assim: `generateStyleProofOnly`, `pendingReview`, `pendingImageCandidates`). A mensagem entra como turno normal, com o contexto "você estava fazendo X, parou em Y". Botão **Retomar** se só pausou. |

Se o pipeline terminar antes de aplicar uma orientação, ela **converte em mensagem normal** do próximo turno e a UI avisa — nada se perde.
**Remover:** `SLASH_COMMANDS` entry `btw`, `btwContext`, `btwStrip/btwPill` (CSS), a linha do prompt (`prompts.ts:23`).
**Aceite:** orientação enviada no meio de um deck de 30 slides aparece aplicada nos lotes seguintes, com o lote onde entrou; nenhuma orientação some.

---

## 3. Plano em fases

Ordem por dependência: **modelo de marca → entrada de dados → acesso da IA → onde se vê → onde se edita → o que fala com o mundo**.

| Fase | Conteúdo | Itens | Tam. | Depende de |
|---|---|---|---|---|
| **0 — Correções rápidas** | Remover `/btw` e criar Orientações + Pausar (extra) · **Corrigir o prompt de ingestão hardcoded da Assinatura** (b) · **Corrigir o cadastro da própria Assinatura**: paleta oficial (6 cores do `ID Rebranding`), tirar as 12 aproximadas, e resolver as fontes (pedir os `.otf` de Monument Extended/Aileron ou definir substitutas aprovadas) · **Testar a ingestão com os 2 PDFs reais** e registrar o resultado (o `catch` silencioso vira erro visível) · Verificar XSS por SVG (c) · **Pedir a Pedro e Matheus um pacote real** (ZIP com SVG, fontes e PSD) como amostra de teste · Rodar 1× o protocolo de benchmark com o que existe (§1.3) · Tela "custo deste deck" a partir de `GenerationRun` (dor 4) | extra, b, c, dor 4 | S–M | — |
| **1 — Brand Kit v2 + aprovação** | Modelo de dados (§4) · `BrandChange` + tela de propostas · defaults da marca (tira o checklist do chat) · **upload de fonte** (`.otf/.ttf/.woff2` → `BrandFont.source=upload`) ao lado das substitutas aprovadas | a | M–L | 0 |
| **2 — Workspace da marca (M)** | Área direita vira workspace: Visão geral, Cores, Tipografia, Logos, Referências, Arquivos, Alterações; "Deck em foco" como aba. Primeiro **só leitura + editar** sobre o Brand Kit v2; sem depender da ingestão nova · **Skills e memória do bot entram aqui** (aba "Regras & memória") e a **biblioteca de mídia** passa a viver ao lado do brandbook (fim das telas separadas) | M, a, parte de b.7 | L | 1 |
| **3 — Brandbook e assets inteligentes** | Ingestão v2 · `Brandbook` objeto · metadados por asset · regra de contraste em código · ferramentas do bot (`buscarAssets`, `lerRegras`…) · quotas de custo · **ingestão de pacote do designer** (ZIP: SVG do Illustrator + fontes + PSD com camadas) | b, c, d | L | 1, 2 |
| **4 — Editor e publicação** | **Editor dentro do Designer é o centro** (decidido 21/09; PPTX/Canva = exportação): painel mínimo (texto, mover, imagem, cor/fonte da marca, slides) · importar recurso do Canva/Adobe direto no editor · publicar como snapshot · galeria de artes com nome humano e busca | i, k, j | L | 3 (para trocar imagem/cor da marca) |
| **5 — Conectores, tenants, MCP** | Catálogo de conectores + ferramentas do bot · spike Adobe · **`Equipe → Marca`** (papéis no time + override por marca) e contexto por usuário · **Canva/Adobe por conta (Pro)**, conforme o spike · servidor MCP | f, e, g, L | L | 1, 3 |
| **6 — Equipe de workers (só se o benchmark pedir)** | Subir paralelismo (pool configurável por peso do modelo, respeitando `aiThrottle`) · workers de asset em paralelo · loop revisor→corretor automático · camadas (h) | h, dor 3 | M–L | benchmark da Fase 0 |

**Por que não abrir a Fase 6 antes:** mais paralelismo aumenta risco de incoerência entre slides (a "style bible" existe justamente para isso), custo e limite de taxa do Gemini. Sem medir, dá para gastar mais e ganhar pouco.

---

## 4. Modelo de dados proposto (Brand Kit v2) — esboço

```
Brand            (já existe)   ·   Team (única: Assinatura) → Brand
BrandColor       { id, brandId, name, hex, rgb?, cmyk?, pantone?, role, usage, allowedOn[hex], status }
BrandContext     { id, brandId, name, whenToUse,          /* ex.: "Braço de Consultoria" */
                   colorIds[], iconAssetIds[], imageStyle, logoVariantByBackground Json }
BrandFont        { id, brandId, role: display|heading|body|caption|accent,
                   family, source: google|upload|adobe, fileAssetId?, weights[], usage }
BrandRule        { id, brandId, scope: color|font|logo|image|layout|tone,
                   kind: DO|DONT, text, structured Json?, source: brandbook|user|learned,
                   originRef?  /* "brandbook v2, p.12" */ , status }
Brandbook        { id, brandId, title, kind: VISUAL|VERBAL|OTHER, version, sourceAssetId,
                   sections Json, ingestedAt, status }   /* uma marca tem VÁRIOS volumes */
Asset (estende)  + description, kind, variants Json, dominantColors[], hasTransparency,
                   usageNotes, brandbookId?, originPage?
BrandChange      { id, brandId, entity, entityId?, before Json?, after Json,
                   proposedBy: USER|AI|INGEST|MEMORY, status: PENDING|APPROVED|REJECTED,
                   decidedBy?, decidedAt? }
Team / TeamMember{ teamId, userId, role }  — Equipe Assinatura; BrandMember vira override por marca
UserBrandContext { userId, brandId, prefs Json }
Quota            { scope: brand|team, maxAssets, maxStorageMB }   /* controle de custo interno */
```

`BrandConfig.colors/primaryFonts/guidelines` continuam durante a migração (o gerador lê de lá) e passam a ser **derivados** de `BrandColor/BrandFont/BrandRule` aprovados — assim nada quebra no meio.

---

## 5. Riscos e pontos de atenção

1. 🔴 **Credenciais em texto puro no Notion.** A página "Assinatura Marca própria" (base *Clientes*) contém uma **chave da API do Gemini** e um **token do Asana** no corpo. Recomendo **rotacionar as duas** e manter só na página de credenciais/cofre. (Não reproduzi os valores aqui.)
2. 🟡 **Status "Descontinuado"** no registro do cliente em *Clientes* (editado em 14/09). É **compatível** com o fim da vigência do complementar (25/08), mas o `CLAUDE.md` ainda diz "Mês 2 em andamento": atualizar um dos dois.
2e. 🔴 **Sem contrato vigente e sem o Designer em nenhum contrato.** O complementar acabou em 25/08 (renovação só por aditivo escrito) e nenhum documento cita o Designer. O `.docx` que li não tem assinaturas visíveis. Ver §1.1.
2a. 🔴 **Propriedade intelectual (cláusulas 9.2 e 14.3).** O que se produz é da Assinatura, e a contratada não pode reutilizar "produtos, extratos, trechos ou partes". **Alinhado pela decisão de 21/09 ("ferramenta interna").** Continua valendo: **não reaproveitar o código nem os artefatos em outros clientes** sem uma carta que separe o que é da Assinatura (marca, dados, artes, regras) do que é ferramenta reutilizável.
2b. 🟡 **Subcontratação (cláusula 14.1).** A contratada é uma pessoa jurídica (Lucas); o Designer tem outro responsável de execução. **Confirmado em 21/09: não há autorização escrita.** Recomendo pedir uma confirmação simples da Assinatura (e-mail basta como ponto de partida) junto do registro de escopo do acabamento. Não sou advogado e isto não é parecer: se houver dúvida, vale uma conversa rápida com um.
2c. 🟡 **Referências cruzadas quebradas no contrato** (ex.: multa de 8.6 aponta "cláusula 5.1", que trata de rescisão e não tem valor; 6.2 cita a "Cláusula 9.6", que não existe; 7.1(iii) cita "prazo da Cláusula 4.1", que é o valor). Não muda o acabamento, mas o aditivo é a chance de corrigir.
2d. **Dados pessoais.** O texto que você colou contém CPFs e e-mails de terceiros. Não os copiei para o documento.
3. **Modelo do artista é `gemini-3.1-pro-preview`** (`config.ts`). Modelo *preview* pode mudar de comportamento ou sumir; o benchmark recorrente (Fase 0) é o que pega isso.
4. **Ingestão v2 muda o que vira "marca"** — sem `BrandChange`, uma reingestão pode sobrescrever ajustes manuais. Por isso a Fase 1 vem antes da 3.
5. **Custo de imagem/visão cresce com metadados por asset.** Gerar descrição de 200 assets é uma chamada por asset; rodar em fila, com o mesmo teto de tokens.

---

## 6. Decisões (respondidas em 21/09)

| # | Pergunta | Resposta | Efeito no plano |
|---|---|---|---|
| 1 | Editar onde? | **Dentro do Designer** ("mais possibilidades, design sofisticado e moldável pela IA com código"). Quer também usar recursos do **Canva** e, em contas Pro, do **Adobe** e do resto. | Fase 4 vira o centro. PPTX/Canva = exportação. Canva/Adobe = **fonte de recursos** ((e), (f)). |
| 2 | Interna ou produto? | **Interna, mas com equipe.** | Sem SaaS, sem cobrança. Alinha com contrato 9.2/14.3. Quota só para custo. |
| 3 | Hierarquia | **Equipe Assinatura → Marca.** | Sem `Client`. `Team` + `BrandMember` (override). |
| 4 | Adobe | **Illustrator, Photoshop, fontes e assets.** | Ingestão de pacote (SVG/PSD/fontes) primeiro; conta Adobe depois, via spike. |
| 5 | Galeria | Junto do brandbook, "mesma configuração de hoje", **dentro da configuração de marca**; mesmo problema de skills e memórias em local separado. | Interpretação 🟡: biblioteca de mídia entra no workspace da marca. **Confirmar.** Fase 2. |
| 6 | Aditivo existe por escrito? | "Vou conferir." | **Em aberto.** |
| 7 | Aditivo novo para o acabamento? | **Não, por conta da casa.** | Sem aditivo. Recomendação: registrar escopo, término e aceite por escrito (§1.1). |
| 8 | Autorização de subcontratação (14.1)? | **Não há.** | Risco 2b (§5). |
| 9 | Fontes: upload ou substitutas? | **Ambas**, "com base nas contas de Adobe e Canva disponíveis, se possível". | Upload na Fase 1 + substitutas aprovadas. 🟡 A licença de Adobe Fonts e Canva não é a mesma coisa que ter o arquivo. |
| 10 | "Braços" como sub-marcas | **"Não entendi."** | Reformulada abaixo. |
| 11 | Brandbook: um documento ou vários? | "Eles fazem no Photoshop e no Illustrator e já vêm todos os SVGs e fontes. **Tem que ver.**" | Pedir amostra real; modelo aceita vários volumes por segurança. |
| 12 | Onde vive este documento? | **Em ambos** (repositório e Notion). | Espelhado (versão **resumida**, sem a análise contratual) na [Central de documentos INTERNOS](https://app.notion.com/p/3e22551ec67e815482ace37a5491b8f2) + nó na [Wiki](https://app.notion.com/p/3e22551ec67e8195a0f4cfa5eb11ab97). |

### Ainda em aberto

- **(10, reformulada)** O brandbook da Assinatura tem dois "braços": **Criatividade** (produto, cosméticos, tendências; ícones de batom e bisnaga) e **Consultoria** (planos de serviço: Exclusive, Insights, Essence, Signature), cada um com ícones, cores e estilo de imagem próprios. Pergunta prática: *quando o deck for sobre planos de serviço, o Designer deve trocar sozinho para o visual do braço Consultoria?* **Sim** → guardo os braços como **"contextos" dentro da mesma marca** (`BrandContext`). **Não** → uma paleta e um conjunto de ícones só, com as regras em texto. **Minha recomendação: sim**, porque é a regra de uso contextual que você pediu no item (a).
- **(6)** Contrato complementar assinado? Existe algo por escrito que cubra o Designer?
- **(5)** Confirmar a interpretação da Galeria.
- **(11)** Amostra real de pacote de designer (ZIP).
- **Fontes:** quem tem o arquivo e a licença de *Monument Extended* e *Aileron*?
- **Limite do acabamento:** até quando e até onde, por conta da casa (§1.1).

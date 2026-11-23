# Mapeamento das configurações da marca (22/11/2026)

> Gerado pelo workflow po-mapeamento-configuracoes (somente leitura, 4 leitores + consolidação). Linhas citadas podem variar um pouco: alguns leitores usaram o main (3e4e335), outros o checkout principal.

## O que cada tela faz

- AGENTE E MEMÓRIA (/[marca]/configuracoes/agent). Editar o System Prompt da marca (BrandConfig.agentPrompt) via PUT /settings/:slug/config: frontend/src/app/[marca]/configuracoes/agent/page.tsx:81; backend/src/routes/settings.ts:64,99. Ctrl+S salva: agent/page.tsx:123-132.
- AGENTE. Se o GET falha, a edição trava para não sobrescrever o prompt salvo: agent/page.tsx:64-67,77,175.
- AGENTE. Prompt vazio mostra um DEFAULT_PROMPT com [NOME_DA_MARCA]. Salvar grava esse texto: agent/page.tsx:24-39,63.
- AGENTE. Adicionar e excluir pares chave/regra em 'Preferências e Regras' (Redis BrandMemory.preferences) via PUT /brands/:slug/memory: agent/page.tsx:90-120; backend/src/routes/memory.ts:21-35; backend/src/lib/redis.ts:508-514. Não há edição de regra existente, só excluir e recriar: agent/page.tsx:226-235.
- AGENTE. O chat também grava preferências pela tool updateBrandMemory: backend/src/agents/brain/skills.ts:51-53,173-183; prompts.ts:97.
- AGENTE. Redirect antigo /configuracoes/memoria -> /configuracoes/agent: frontend/src/app/[marca]/configuracoes/memoria/page.tsx:6-9.
- BRANDING (/[marca]/configuracoes/branding). Editar cores, fontes, diretrizes, logo, presentationConfig e teto de custo de IA num só PUT /settings/:slug/config: branding/page.tsx:192-199.
- BRANDING. Subir logo salva na hora: branding/page.tsx:262-268.
- BRANDING. Trocar a paleta também regrava presentationConfig.paletteApproved: branding/page.tsx:330-338.
- BRANDING. Único ponteiro para o Cérebro: texto manda marcar a fonte própria 'na ficha do Cérebro': branding/page.tsx:657.
- CÉREBRO (/[marca]/cerebro). Carrega e salva a ficha por /brands/:slug/profile e importa por /profile/import: cerebro/page.tsx:182, 225, 245.
- CÉREBRO. Aviso de que a ficha derivada só vale depois de salva: cerebro/page.tsx:303-306. Seção 'Notas de antes da ficha' (legacyNotes): cerebro/page.tsx:592-607.
- BIBLIOTECA DE MÍDIA (/[marca]/configuracoes/midia). Upload de um arquivo por vez (imagem, SVG, fonte), até 10 MB, limite não mostrado na tela: midia/page.tsx:428,499; backend/src/routes/assets.ts:17,51.
- BIBLIOTECA. Importar do Drive (lote de até 20, item inválido pulado sem aviso): midia/page.tsx:404,587; assets.ts:26,91,106-110.
- BIBLIOTECA. Importar design do Canva como PNG, uma página por asset: midia/page.tsx:416-425,590; assets.ts:128-195.
- BIBLIOTECA. 'Adicionar Brandbook': modal com abas arquivos ou URL do Canva; ingestão com IA mostra paleta, SVGs, avisos e status; permite trocar a logo oficial: BrandbookUploaderModal.tsx:162,256-273,316,371-469; backend/src/routes/brands.ts:42,66,143.
- BIBLIOTECA. Exportar ao Canva, só para asset 'ai-generated': midia/page.tsx:457-470,705; assets.ts:265-307.
- BIBLIOTECA. Excluir asset de vez com confirm() nativo; o arquivo sai do R2: midia/page.tsx:446-455; assets.ts:198-225.
- BIBLIOTECA. Filtrar por fonte (chips com contagem) e pelas 10 tags mais usadas; até 2 tags por card; não há criar ou editar tag: midia/page.tsx:356-378,538-578,658,695-701; assets.ts:228-231.
- BIBLIOTECA. Pastas (intenção do código): árvore, criar, renomear, excluir, arrastar pasta e asset: midia/page.tsx:154-270,601-639; backend/src/routes/folders.ts:72-168. Conferido por mim: a lista de pastas chega vazia, porque a página lê res?.data (midia/page.tsx:127-128) e o cliente já desembrulha data (frontend/src/lib/api.ts:120-121).
- BIBLIOTECA. Conferido por mim: o filtro por pasta não reage, porque o useMemo não tem activeFolder nas dependências: midia/page.tsx:387-391.
- BIBLIOTECA. Renomear asset existe no backend (assets.ts:229) mas não na tela. Mover asset só por arrastar: midia/page.tsx:660-671.
- BIBLIOTECA. Botões desabilitados sem 'manage-assets'; 'Adicionar Brandbook' é o único sem title explicativo: midia/page.tsx:102-103,501-508.
- GASTOS DA MARCA (/[marca]/configuracoes/billing). Mês escolhido com custo total, tokens, chamadas e tabela por modelo; mês vazio oferece meses com consumo: billing/page.tsx:42-153,86-105. Endpoint GET /brands/:slug/ai-usage/billing, qualquer membro: frontend/src/lib/hooks.ts:199-216; backend/src/routes/brands.ts:222-230.
- GASTOS DA MARCA. Não mostra o teto diário nem o uso de hoje: billing/page.tsx:18. O uso de hoje vem de outro endpoint: brands.ts:211-218.
- GASTOS GLOBAL (/configuracoes/billing). Só ADMIN, GET /settings/billing: frontend/src/app/configuracoes/billing/page.tsx:55; backend/src/routes/settings.ts:257-270. Mostra mês cru, símbolo 'U$', sem formato pt-BR, cor fixa #fafaf9: billing/page.tsx:86,108,124,171,187.
- TETO DIÁRIO. Só por variável de ambiente (padrão 5.000.000 tokens por marca, 20.000.000 global): backend/src/config.ts:107-108; aiBudget.ts:310-323. Nenhuma tela ou rota permite elevar; /configuracoes/agent só exibe: frontend/src/app/configuracoes/agent/page.tsx:107,115.
- TETO. Única indicação antes do corte é o AiSpendBadge na Fábrica e na Galeria; carrega uma vez e não atualiza: fabrica/page.tsx:560; galeria/page.tsx:766; AiSpendBadge.tsx:17,33-37,57,81.
- EQUIPE (/[marca]/configuracoes/equipe). Listar membros (qualquer membro vê): equipe/page.tsx:43-56; backend/src/routes/team.ts:34.
- EQUIPE. Convidar por email como ADMIN, EDITOR ou VIEWER; gera link de uso único para copiar, sem email: equipe/page.tsx:58-80,184-201,218-268; team.ts:85-91.
- EQUIPE. Remover membro com confirm(); escondido para OWNER e sem 'manage-team': equipe/page.tsx:88-96,160-165; team.ts:140-169.
- EQUIPE. Aceite do convite em /convite/[token] para quem não tem conta: frontend/src/app/convite/[token]/page.tsx:44-64; backend/src/routes/auth.ts:141-184.
- EQUIPE. Não existe na tela: mudar papel (PATCH existe em team.ts:98-137, nenhum chamador no frontend) nem lista, reenvio ou cancelamento de convites pendentes (team.ts:41-47).

## Quem depende de cada tela

- Navegação: o menu lateral tem só 'Configurações' (Sidebar.tsx:32-38,195). BRAND_SETTINGS (agent, branding, equipe, midia, billing) é lido pela lista em frontend/src/app/[marca]/configuracoes/page.tsx:11-18,54-69 e pelos testes navigation.test.ts:19,39-44,59 e referenciasRemovidas.test.ts:31. Mover telas exige atualizar esses testes.
- Cada subtela tem 'Voltar para configurações': equipe/page.tsx:100, agent/page.tsx:144, billing/page.tsx:24, branding/page.tsx:357, midia/page.tsx:483.
- Visão geral -> Cérebro ('Abrir Cérebro da IA' e pendências): frontend/src/app/[marca]/page.tsx:313,326. Visão geral -> Branding ('Editar identidade'): page.tsx:335-349. Visão geral -> Mídia ('Abrir biblioteca'): page.tsx:351-374. Projeto colab mostra só 'Herdado de': page.tsx:378-391.
- Cérebro -> Mídia quando a biblioteca está vazia: cerebro/page.tsx:529.
- Fábrica -> Mídia pelo BrandBundlePanel, com <a href> (recarrega a página): BrandBundlePanel.tsx:100-105. O painel lê /settings/:slug/config e /brands/:slug/assets: BrandBundlePanel.tsx:43-44.
- Fábrica e Galeria -> Gastos da marca pelo AiSpendBadge: AiSpendBadge.tsx:100.
- Configurações gerais -> Gastos global (só ADMIN): frontend/src/app/configuracoes/page.tsx:72-88.
- Equipe só é apontada pela lista de configurações: navigation.ts:80-85. Notificação de convite aponta /convite/{token}: team.ts:80.
- Tema CSS de todo /[marca] vem do BrandConfig via useBranding: frontend/src/app/[marca]/layout.tsx:13; useBranding.ts:11-25.
- Onboarding grava em /settings/:slug/config: frontend/src/app/onboarding/page.tsx:92.
- BrandConfig.colors é lido por: pipeline.ts:629 (imagens), pipeline.ts:776 -> htmlDesign.ts:547,661,333 (prompt do artista e STYLE BIBLE), htmlDesign.ts:728 (fallback), pipeline.ts:927 e posts.ts:149 (edição de slide), brandContext.ts:110 via fabrica.ts:60 (chat), BrandBundlePanel.tsx:65, useBranding.ts, getBrandKit.ts:82 (MCP), brandProfile.ts:171 (ficha derivada).
- BrandConfig.primaryFonts é lido por: pipeline.ts:777 -> htmlDesign.ts:548,662; pipeline.ts:928; posts.ts:150; useBranding.ts:16-25,37-43; BrandBundlePanel.tsx:66; getBrandKit.ts:83; getDesignerBrief.ts:134; brandProfile.ts:172.
- BrandConfig.logoUrl é gravado por Branding, brandbook e confirm-logo (settings.ts:96-109; brands.ts:157-168; brandbookIngestion.ts:420-431) e lido por pipeline.ts:789 -> htmlDesign.ts:551; BrandBundlePanel.tsx:67; brands.ts:248,275 (lista de marcas, usada na galeria); getBrandKit.ts:84; brandProfile.ts:173.
- BrandConfig.guidelines é lido por: htmlDesign.ts:549 (só sem cérebro); pipeline.ts:930 -> htmlDesign.ts:884-885 (edição no pipeline, mesmo com cérebro); posts.ts:151; BrandBundlePanel.tsx:70-77; getBrandKit.ts:74-75; brandProfile.ts:175.
- BrandConfig.agentPrompt é lido por: pipelineContext.ts:39-40 (memória só sem ficha preenchida); pipeline.ts:780 -> htmlDesign.ts:550 (artista só sem cérebro); brandContext.ts:109 -> fabrica.ts:60 -> brain/index.ts:854,907 (chat); brain/index.ts:281 (planner copy-first); brain/index.ts:1420 -> htmlDesign.ts:887-888 (ajuste pelo chat); getDesignerBrief.ts:106; brandProfile.ts:176 (legacyNotes). Também gravado com texto padrão em brands.ts:162 e brandbookIngestion.ts:425,445.
- BrandMemory.preferences é lido só no ramo sem cérebro: pipeline.ts:290-294,376,796 -> htmlDesign.ts:293-297,555. Gravado pela tela (agent/page.tsx) e pelo chat (skills.ts:173-183).
- BrandProfile.data (ficha) é lido por: brandProfile.ts:198,229 -> pipelineContext.ts:35 -> htmlDesign.ts:415 (bloco do cérebro); pipeline.ts:726 (fontes próprias); fontNotice.ts:25-29 via pipeline.ts:1116; styleReferences.ts:25 via pipeline.ts:732; pipeline.ts:786-788 -> htmlDesign.ts:552 (variantes de logo); legacyConflicts.ts:109; getDesignerBrief.ts:105-125; savePresentation.ts:152; getBrandKit.ts:66-72; frontend/src/app/[marca]/page.tsx:73,94. Gravado também pelo MCP update_brand_profile: updateBrandProfile.ts:54,73.
- Asset (tags, source) é lido pelo pipeline: imageResolver.ts:517-529; brandContext.ts:44-84; styleReferences.ts:30-32; listAssets.ts:60-72; customFonts.ts:258. Asset.folderId não tem leitor no pipeline; só a grade da mídia (midia/page.tsx:388-389).
- Assets também são lidos por useBrandAssets.ts:34 (PhotoSlotsPanel.tsx:61), BrandBundlePanel.tsx:44 e cerebro/page.tsx:183.
- Billing: as duas telas usam getBilling (aiBudget.ts:248-284) sobre contadores no Redis gravados por recordUsage. O global grava toda chamada (aiBudget.ts:389-390); a marca só com brandSlug (aiBudget.ts:391-394).
- Equipe: memberships automáticas (todo usuário em toda marca) rodam em server.ts:39, auth.ts:65,202,395 e brands.ts:435,590 via internalTeam.ts:17-40. myRole vem de brands.ts:301 e é lido por useBrandPermissions.tsx:49-51.

## Perguntas respondidas

### duasFontesDeVerdade

sim. Branding grava em BrandConfig (colors, primaryFonts, logoUrl, guidelines): backend/src/routes/settings.ts:96-109; schema.prisma:175-184. O Cérebro grava em BrandProfile.data (palette, typography, logo.files): brandProfileStore.ts:57; brands.ts:478-487; schema.prisma:160-167. Nenhuma gravação atualiza a outra. A única ponte é de leitura e mão única: sem ficha salva, o GET monta uma ficha derivada do BrandConfig (brands.ts:456-459; brandProfile.ts:169-185), sem gravar (brands.ts:445-446). Depois de salva a ficha, mudanças no Branding não chegam a ela. Há ainda uma terceira paleta, presentationConfig.paletteApproved (branding/page.tsx:330-338; brandContext.ts:114,131). Na memória de texto da geração vence a ficha (pipelineContext.ts:25-41, conferido por mim). No prompt do artista as duas paletas chegam juntas e o código não decide (htmlDesign.ts:411-415,426 vs 547-548,333,661). SUPOSIÇÃO: quem vence de fato é o modelo; não medido. Fora da geração (editor, chat, Fábrica, tema) só o BrandConfig é lido.

### systemPromptComFicha

nao na geração; sim no chat. Com ficha salva e preenchida, a memória do projeto é a ficha renderizada; o agentPrompt só entra se a ficha não tiver seção preenchida (pipelineContext.ts:34-40, conferido por mim). O artista só recebe 'Instruções do agente' sem cérebro (htmlDesign.ts:549-550). Ordem no prompt de sistema do artista: bloco do cérebro (global, projeto = ficha, collab, modo, foto, ativos, revisão: assemble.ts:122-147; pipelineContext.ts:46-54), depois 'MECÂNICA DE SAÍDA' e o prompt genérico de diretor de arte (htmlDesign.ts:414-426). legacyNotes (que pode conter um retrato antigo do agentPrompt) entra no fim da memória, rotulada 'não são regras' (brandProfile.ts:243,252-265). Mas o System Prompt cru ainda chega ao modelo em três lugares: 1) systemInstruction do chat, depois do BRAIN_SYSTEM_PROMPT e antes da nota do cérebro (fabrica.ts:60; brandContext.ts:109; brain/index.ts:854,905-909); 2) planner do roteiro copy-first (brain/index.ts:279-285); 3) ajustes de slide pelo chat como 'Instruções Específicas da Marca' (brain/index.ts:1376,1420; htmlDesign.ts:887-888,904). As Preferências e Regras não chegam à geração com o cérebro ligado (pipeline.ts:373-376,796; htmlDesign.ts:555).

### comSemFicha

Premissa corrigida: o cérebro global liga por padrão, com ou sem ficha. Conferido por mim em backend/src/lib/designerBrain/enabled.ts:1-13. Também savedProfile.ts:161-170; pipeline.ts:321; testes em designerBrainGlobal.test.ts:86-99. A ficha só liga ou desliga o cérebro com DESIGNER_BRAIN_GLOBAL=off (designerBrainGlobal.test.ts:101-124).,Igual com e sem ficha (padrão): trava de texto aprovado (pipeline.ts:336-343); status por bloco (pipeline.ts:326-327; brain/index.ts:259-268); conferência do texto aprovado (pipeline.ts:902-956); avisos de texto em revisão e blocos fora da arte (pipeline.ts:1100-1111); porta de final e pendências (pipeline.ts:1129-1140,1204-1212); regra de foto real (pipeline.ts:324; pipelineContext.ts:110; assemble.ts:136-137); recusa de imagem avulsa no chat (brain/index.ts:1118-1119); preferências fora da geração (pipeline.ts:796).,Muda com ficha: a memória vira a ficha renderizada em vez de agentPrompt, seed ou resumo do cadastro (pipelineContext.ts:34-42,93-97).,Muda com ficha: fontes próprias carregadas (pipeline.ts:726-729); manual visual e referências de fonte vão como imagem, sem ficha a lista fica vazia (pipeline.ts:732; styleReferences.ts:23).,Muda com ficha: variantes oficiais de logo só existem com ficha (pipeline.ts:786-788; htmlDesign.ts:552).,Muda com ficha: o aviso de fonte usa a tipografia da ficha; sem ficha usa a lista do seed (fontNotice.ts:25-30; seeds/index.ts:17-19).,Muda com ficha: a camada collab do desdobramento só existe se a base ou o desdobramento tem ficha (savedProfile.ts:119-138).,Sem ficha, sem agentPrompt e sem seed: a memória vira o resumo do cadastro e entra a pendência 'Memória do projeto-base (ficha do projeto)' na porta de final (pipelineContext.ts:93-97,128; pipeline.ts:355,362,1135,1211). Qualquer agentPrompt não vazio apaga a pendência (pipelineContext.ts:39-40).,Saída de emergência (DESIGNER_BRAIN_GLOBAL=off), sem ficha e fora de DESIGNER_BRAIN_BRANDS: desligam trava de texto, status por bloco, conferência, aviso de fonte e porta de final (pipeline.ts:326,336,909,1115,1129,1204). Regra de foto só se ligada no chat (pipeline.ts:324,380-382,784; htmlDesign.ts:416-424). Imagem avulsa volta (brain/index.ts:1118-1122). Diretrizes, System Prompt e Preferências voltam ao artista (pipeline.ts:374-376; htmlDesign.ts:549-550,555).


## Conflitos para decisão do PO

- Paleta: duas no mesmo prompt do artista. A da ficha (htmlDesign.ts:415) e a do BrandConfig como 'Cores oficiais' (htmlDesign.ts:547) e STYLE BIBLE 'use SOMENTE estas cores' (htmlDesign.ts:333,661). Decidir qual alimenta a bible antes de mover o Branding para o Cérebro.
- Logo: dois no prompt do artista. BrandConfig.logoUrl (htmlDesign.ts:551) e variantes da ficha (htmlDesign.ts:552). Branding, brandbook e confirm-logo atualizam só o primeiro (settings.ts:96-109; brands.ts:157). Decidir qual é o oficial.
- Terceira paleta: presentationConfig.paletteApproved, regravada pelo Branding (branding/page.tsx:335-338) e lida no resumo (brandContext.ts:114,131). Decidir se fica.
- Editor (posts.ts:133-153), Fábrica (BrandBundlePanel.tsx:65-67; fabrica.ts:60) e tema do app (useBranding.ts) só leem BrandConfig. Se o Branding sair e o usuário editar só a ficha, eles ficam com dados velhos. Decidir: sincronizar, migrar leitores para a ficha, ou manter o Branding.
- Brandbook grava só BrandConfig (brandbookIngestion.ts:436-442) e MCP update_brand_profile grava só a ficha (updateBrandProfile.ts:54,73). Decidir para onde cada entrada deve escrever.
- Ficha derivada é foto única: depois de salva, mudanças no Branding e no System Prompt não chegam (brands.ts:450-459; brandProfile.ts:176). Decidir se haverá sincronização.
- System Prompt: a geração usa a ficha, mas chat, planner copy-first e ajustes de slide leem o System Prompt cru (brain/index.ts:281,854,907,1420; brandContext.ts:109). Decidir se ele vira campo da ficha (ex.: Tom/Essência), fica só como legacyNotes ou sai. O comentário de seeds/index.ts:4-6 contradiz pipelineContext.ts:24-26.
- Texto padrão de uma linha no agentPrompt ('Você é o assistente de design da marca X.', brands.ts:162; brandbookIngestion.ts:425,445) e o DEFAULT_PROMPT salvo (agent/page.tsx:24-39) contam como memória sem ficha, vencem o seed e apagam a pendência (pipelineContext.ts:39-41,93-97,128). Decidir se texto padrão deve contar.
- Preferências e Regras: a tela promete 'Memória dinâmica' (agent/page.tsx:206) e o chat grava nelas (prompts.ts:97; skills.ts:173-183), mas com o cérebro ligado (padrão) não chegam à geração (pipeline.ts:373-376,796). Decidir: ligar à ficha, levar ao Cérebro ou remover.
- Edição de slide no pipeline manda diretrizes do BrandConfig junto com o cérebro (pipeline.ts:930-932; htmlDesign.ts:884-889); a geração principal não manda (htmlDesign.ts:549). Decidir o comportamento único.
- Gastos: duas telas com endpoint, permissão e visual diferentes (brands.ts:222 qualquer membro; settings.ts:259 só ADMIN). Decidir se a global vira soma por marca ou se as duas compartilham um componente.
- Gastos: o total global não é a soma das marcas (aiBudget.ts:389 vs :391), mas o card diz 'consolidados de todas as marcas' (frontend/src/app/configuracoes/page.tsx:84). Decidir o texto ou a contagem.
- Teto: a mensagem manda 'eleve o limite' (aiBudget.ts:320), mas não há tela nem rota (config.ts:108; agent/page.tsx só exibe). A documentação promete teto diário ou mensal com liberação do Owner (docsContent.ts:198). Decidir se cria controle de teto ou corrige textos.
- Teto: o aviso na Fábrica sai genérico, com ponto duplo e sem dizer quando volta nem quem eleva (geminiRetry.ts:383-384; pipeline.ts:1167; brain/index.ts:1065; useFabricaWs.ts:59-71). Foto é pulada em silêncio (imageResolver.ts:263-268). A tela de Gastos não mostra teto nem uso de hoje (billing/page.tsx:18). Decidir onde mostrar o teto.
- Pastas de mídia: o backend cria 'Brandbooks' (brandbookIngestion.ts:132-139), mas a tela não mostra pastas por bug (midia/page.tsx:127-128,159-165,177-179,209-211,391). Corrigir antes ou junto da mudança de tela. Decidir também se folderId deve guiar a IA (hoje nenhum leitor no pipeline).
- Canva: dois fluxos na mesma tela, 'Importar do Canva' como PNG (midia/page.tsx:416) e aba Canva do Brandbook com IA (BrandbookUploaderModal.tsx:190). Decidir rótulos.
- Nome da mídia: 'Biblioteca de mídia' (navigation.ts:88), 'Fotos e arquivos' (page.tsx:353; cerebro/page.tsx:529) e 'Configurações › Mídia' (BrandBundlePanel.tsx:103), contra a regra de um nome (navigation.ts:21-25). Escolher um.
- Equipe × equipe interna: todo usuário vira membro de toda marca (internalTeam.ts:1-11,28-33). SUPOSIÇÃO: quem é removido volta como EDITOR no próximo gatilho. Convite a quem já tem conta falha com 409 (auth.ts:149-152) e o modal sempre diz 'ainda não tem conta' (equipe/page.tsx:186-188; team.ts:86-91). Decidir se a tela Equipe faz sentido com essa regra.
- Equipe: texto do papel ADMIN diz que pode 'apagar a marca' (equipe/page.tsx:233), mas só o OWNER pode (brands.ts:626). 'Apagar marca' aparece sem checar papel e o erro some em silêncio (configuracoes/page.tsx:36-38,75-86). Decidir texto e visibilidade.
- Equipe: não há decisão escrita que a mova. Decidir se fica em Configurações. Se mover, atualizar navigation.test.ts:39-44 e docsContent.ts:40-41.
- Defeito pré-existente, independente da mudança: o chat de revisão manda cores e fontes vazias ao editor de slide, porque lê campos que o model Brand não tem (brain/index.ts:1341,1376-1420; schema.prisma:124-154).

## Não verificado

- Nada foi rodado nem visto no navegador. Bugs de tela vêm da leitura do código. Conferi só: midia/page.tsx:127-128 e :387-391, api.ts:120-121, enabled.ts:1-13 e pipelineContext.ts:24-42 no worktree.
- Qual paleta o modelo obedece quando ficha e Branding divergem. Depende do modelo; não houve geração.
- Valores reais de DESIGNER_BRAIN_GLOBAL, DESIGNER_BRAIN_BRANDS, AI_BRAND_DAILY_TOKEN_BUDGET e AI_DAILY_TOKEN_BUDGET em produção. O .env não foi lido.
- Quantas marcas têm ficha salva, agentPrompt não vazio, ou divergência entre ficha e BrandConfig. O banco não foi consultado.
- Quanto o total global de gastos diverge da soma das marcas nos dados reais do Redis.
- Texto exato exibido quando o teto é atingido. Deduzido do código, sem disparar geração. Também não se verificou se o deck avisa a foto pulada, nem o texto no Brandbook ou no MCP.
- Exportação (PPTX, PDF, Canva): só grep, arquivos não lidos inteiros.
- Arquivos não lidos inteiros: cerebro/page.tsx, branding/page.tsx, frontend/src/lib/profileForm.ts (se o PUT envia legacyNotes), runPlanner e runHtmlReviewer, NotificationBell, a página global /configuracoes/agent, destinos de auth.ts:65 e :395, campo agentPrompt em backend/src/routes/ai.ts:42.
- Se algum outro caminho do chat lê BrandMemory.preferences. Só houve grep.
- Se a ficha de um desdobramento herda o BrandConfig da base.
- Se o membro removido volta de fato após reinício ou login.
- Se a Documentação transforma trechos em link e se o VIEWER 'deixa comentários' (docsContent.ts:54).
- Modo escuro da tela de Gastos global (#fafaf9 é risco, não problema confirmado).
- Os leitores usaram checkouts diferentes: alguns o worktree em 3e4e335 (main), outros o checkout principal em feat/mcp-update-brand-profile (051c002). Linhas podem variar um pouco.
- O pedido citava um card 'Referências' na Visão geral; ele não existe em frontend/src/app/[marca]/page.tsx:283-374. 'Referências' só é botão do BrandBundlePanel (BrandBundlePanel.tsx:89).

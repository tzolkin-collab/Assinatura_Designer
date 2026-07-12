Plano de Execução Claude Code: Projeto Designer Assinatura

Este documento estabelece o roteiro técnico e os comandos operacionais para a evolução da plataforma Designer Assinatura. O objetivo é transformar o estado atual em um ecossistema escalável de geração de apresentações massivas (200+ slides) utilizando orquestração de IA e integração nativa com o ecossistema Canva.

1. Visão Geral e Contexto Técnico

O sistema utiliza uma arquitetura Manager-Worker para garantir precisão e escala. O Manager (Gemini Pro) atua na estruturação lógica e estratégia, enquanto os Workers (Gemini Flash/Nanobanana) processam a geração de conteúdo e ativos visuais.

Infraestrutura e Ambiente

O projeto está estruturado em um monorepo localizado no repositório tzolkin-collab/designer. Claude Code deve operar sob as seguintes premissas:

* Frontend (/frontend): Next.js 14+ hospedado na Vercel. Utiliza TypeScript e estilização via CSS Modules/Global.
* Backend (/backend): Node.js/TypeScript hospedado em VPS dedicada. Gerencia a fila de renderização e integração de APIs.
* Database: Postgres para persistência de designs, tabelas de marca (branding) e metadados de slides.
* Storage: Cloudflare R2 para ativos gerados e imagens processadas.

2. Checklist de Quick Wins

* [x] Quick Win 1: Refatoração do Renderer para Puppeteer Cluster (Paralelismo).
* [x] Quick Win 2: Migração de Banco para Slides Componentizados e JSON Skeleton.
* [x] Quick Win 3: Implementação de Design Tokens e Edição Granular no Frontend.
* [x] Quick Win 4: Integração Canva Connect API com Fluxo OAuth 2.0/PKCE.

3. Prompt Quick Win 1: Fila do Puppeteer Cluster (Backend)

Objetivo: Substituir a renderização sequencial por um pool paralelo de navegadores para suportar o fatiamento de 200 slides simultâneos.

Prompt para Claude Code: "Refatore o serviço de renderização em backend/src/services/renderer.ts (ou diretório equivalente) para implementar a biblioteca puppeteer-cluster.

1. Configure o cluster utilizando Cluster.CONCURRENCY_BROWSER para garantir isolamento total de recursos entre os slides de uma apresentação massiva.
2. Implemente uma lógica de retryLimit: 3 e tratamento de erros para capturar crashes de workers sem interromper o lote.
3. Ajuste a maxConcurrency baseada nos núcleos de CPU disponíveis no ambiente de produção.
4. Crie/atualize a rota /render-batch para aceitar um array de componentes HTML/CSS, processar no cluster e retornar as URLs dos arquivos PNG gerados e armazenados no Cloudflare R2."

4. Prompt Quick Win 2: Componentização de Slides (Postgres)

Objetivo: Transicionar de um modelo de 'blob' de texto para uma estrutura de dados relacional que permita manipulação individual de cada slide.

Prompt para Claude Code: "Gerencie a migração do banco de dados Postgres e a lógica de persistência para suportar slides granulares.

1. Crie uma tabela slides vinculada a designs (FK), contendo colunas para content_json (JSONB), html_render (TEXT), position (INT) e metadata (JSONB).
2. Modifique o bot 'Manager' para que a primeira saída seja estritamente um JSON Skeleton seguindo este schema: Array<{ title: string, goal: string, layout_type: string, order: number }>.
3. Implemente a lógica no backend para salvar esse esqueleto antes de disparar os Workers. Garanta que atualizações em um slide específico não exijam a regeneração de toda a tabela de slides relacionada ao design."

5. Prompt Quick Win 3: Edição Granular e Design Tokens (Frontend)

Objetivo: Implementar consistência visual absoluta e permitir que o usuário edite partes específicas do projeto sem o 'efeito monstro' de regerar tudo.

Prompt para Claude Code: "No diretório frontend/, implemente um sistema de Design Tokens dinâmicos.

1. Crie um arquivo frontend/styles/tokens.css que defina variáveis :root (ex: --brand-primary, --font-heading).
2. Implemente um hook useBranding que recupere as configurações de marca do Postgres e injete os valores nas CSS Variables do documento.
3. Na interface de edição, adicione a função 'Editar Slide Isolado'. Ao disparar esta ação, o prompt enviado à IA deve conter exclusivamente o contexto HTML/JSON do slide selecionado e o manual de marca injetado. Bloqueie qualquer tentativa de alteração fora do escopo do ID do slide atual."

6. Prompt Quick Win 4: Exportação via Canva Connect API

Objetivo: Integrar o fluxo de trabalho da equipe de design diretamente com a biblioteca do Canva, utilizando autenticação segura e upload otimizado.

Prompt para Claude Code: "Implemente o serviço de integração com a Canva Connect API em backend/src/integrations/canva.ts.

1. Configure o fluxo de autenticação OAuth 2.0 com PKCE. Utilize SHA-256 para o code_challenge e gere um code_verifier criptograficamente seguro (entre 43 e 128 caracteres).
2. Implemente a rota de callback validando o parâmetro state para prevenir ataques CSRF.
3. Utilize o endpoint create-url-asset-upload-job para realizar o upload das imagens do R2 para o Canva. Isso é obrigatório para evitar o overhead de buffers no backend.
4. No cabeçalho Asset-Upload-Metadata, envie o nome do ativo codificado estritamente em Base64. Garanta que o escopo asset:write esteja presente na solicitação de token."

7. Guia de Operação Claude Code

Use estes comandos rápidos para validar cada etapa da implementação:

Comando	Descrição	Aplicação
/init	Inicializa o contexto do serviço.	Usar ao iniciar a integração com a Canva API.
/test	Executa testes automatizados.	Validar a concorrência do Puppeteer Cluster sob carga.
/review	Revisão de segurança e performance.	Verificar a implementação do PKCE e hashing SHA-256.
/fix	Corrige erros detectados em logs.	Ajustar falhas de timeout em apresentações de 200 slides.

Restrições Operacionais para o Agente

* TypeScript Estrito: Todo o código gerado deve utilizar tipos explícitos; evite o uso de any.
* Monorepo Aware: Sempre utilize caminhos relativos ao root do monorepo (backend/ ou frontend/).
* Performance: Priorize operações assíncronas e uploads via URL para minimizar o consumo de memória da VPS.

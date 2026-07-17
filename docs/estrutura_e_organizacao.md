# Organização, Estrutura de Pastas e Padrões de Projeto

Este documento detalha o mapeamento arquitetural completo, a árvore de diretórios e as diretrizes de código que regem o ecossistema do **Designer Assinatura**.

---

## 🏛️ 1. Visão Geral da Arquitetura

O sistema é estruturado como um monorepo que separa as responsabilidades de interface e de processamento de regras de negócios:

```
[ FRONTEND ] (Next.js) <── HTTPS / WSS ──> [ BACKEND ] (Express / Redis / BullMQ)
                                                │
                                                ├──> [ BANCO DE DADOS ] (PostgreSQL)
                                                └──> [ STORAGE ] (Cloudflare R2)
```

1. **Frontend (`/frontend`):** Interface dinâmica de edição visual baseada no formato intermediário de design (`DesignIR`). Gerencia a conversação em tempo real com a Fábrica por meio de WebSockets e interações de arrastar/soltar no Canvas de edição.
2. **Backend (`/backend`):** API servidora robusta baseada em Express e TypeScript (ESM). Orquestra os agentes de IA, processa filas assíncronas de exportação utilizando Redis/BullMQ e renderiza as apresentações em segundo plano com um cluster de Puppeteer.

---

## 📁 2. Mapeamento da Estrutura de Pastas

### 📂 Raiz do Projeto (`/`)
```
designer/
├── .gitignore                  # Regras de exclusão do Git (ignora .env, build, etc.)
├── GEMINI.md                   # DIRETRIZES TÉCNICAS FUNDAMENTAIS (Precedência Absoluta)
├── README.md                   # Notas breves de inicialização
├── backend/                    # Código fonte do servidor da aplicação
├── frontend/                   # Código fonte da interface web (Next.js)
└── docs/                       # Acervo de documentação e relatórios técnicos
```

---

### 📂 Diretório `/backend` (Servidor API)
```
backend/
├── Dockerfile                  # Empacotamento de produção do servidor
├── docker-compose.yml          # Definição de serviços (Postgres, Redis)
├── package.json                # Dependências e scripts (build, test, start)
├── prisma.config.ts            # Arquivo de configuração de adapters do Prisma
├── tsconfig.json               # Configurações do compilador TypeScript
├── vitest.config.ts            # Configuração da suíte de testes Vitest
├── prisma/                     # Camada de Dados (PostgreSQL)
│   ├── schema.prisma           # Modelagem de banco de dados e definições de tabelas
│   ├── seed.ts                 # Script de carga inicial de banco (marcas, templates)
│   └── migrations/             # Histórico de alterações e migrações SQL do banco
└── src/                        # Código Fonte Principal
    ├── app.ts                  # Inicialização da aplicação Express (middlewares, rotas)
    ├── server.ts               # Boot do servidor HTTP e WebSocket na porta principal
    ├── config.ts               # Variáveis de ambiente e constantes globais do sistema
    ├── worker.ts               # Processador de filas assíncronas (BullMQ) para exportações
    │
    ├── __tests__/              # Suíte de Testes Automatizados (Vitest)
    │   ├── security.test.ts    # Testes de isolamento multitenant (cross-tenant leaks)
    │   ├── team.test.ts        # Testes de criação e permissões de times (RBAC)
    │   └── assets.test.ts      # Testes de upload de arquivos e mídias
    │
    ├── agents/                 # Pipeline de Inteligência Artificial (Manager/Worker)
    │   ├── pipeline.ts         # Orquestrador da geração de apresentações massivas
    │   ├── types.ts            # Tipagens e interfaces dos agentes
    │   ├── brain/              # Agente central de conversa (chat conversacional)
    │   ├── planner/            # Agente que monta o plano de slides/estrutura (JSON Skeleton)
    │   ├── content/            # Agente gerador de textos e copys dos slides
    │   ├── reviewer/           # Agente de garantia de qualidade (QA) e consistência visual
    │   └── tools/              # Ferramentas acopladas que a IA pode disparar no banco
    │
    ├── lib/                    # Regras de Negócio e Serviços Auxiliares
    │   ├── aiBudget.ts         # Controle e contabilidade exata de tokens/gastos de IA
    │   ├── assetValidator.ts   # Sanitizador de imagens e mídias do usuário
    │   ├── brandContext.ts     # Gerador de resumos de brand book e contexto visual
    │   ├── canvaClient.ts      # Cliente SDK de comunicação com a Canva Connect API
    │   ├── canvaExport.ts      # Gerador assíncrono de envelopes prontos para o Canva
    │   ├── deckExport.ts       # Conversor de decks para ZIP/PDF
    │   ├── htmlDesign.ts       # Renderizador e sanitizador de slides HTML/CSS (Legado)
    │   ├── prisma.ts           # Cliente instanciado e adaptado do Prisma ORM (Pool de Conexão)
    │   ├── queue.ts            # Gerenciamento de conexões Redis e filas do BullMQ
    │   ├── r2.ts               # Integração de uploads para o Cloudflare R2 (S3-compatible)
    │   ├── raster.ts           # Renderizador gráfico massivo baseado em Puppeteer Cluster
    │   ├── redis.ts            # Manipulador de sessão fatiada (:meta, :messages, :design)
    │   └── designIR/           # Camada de Formato Intermediário de Design (DesignIR)
    │       ├── aiPatch.ts      # Motor de geração de patches inteligentes via IA
    │       ├── types.ts        # Tipagem estrita da estrutura de slides/elementos do DesignIR
    │       └── templates/      # Padrões visuais pré-definidos injetados nos slides
    │
    ├── middleware/             # Filtros de Requisição, Segurança e RBAC
    │   ├── auth.ts             # Decodificador de tokens JWT e controle de sessão
    │   ├── brandAccess.ts      # Validador de escopo de usuário membro de marcas (RBAC)
    │   ├── errorHandler.ts     # Tratador de erros global e respostas JSON de falhas
    │   └── rateLimit.ts        # Limitador de requisições por IP/marca
    │
    └── routes/                 # Endpoints REST (Controladores)
        ├── auth.ts             # Login, cadastro e autenticação
        ├── brands.ts           # Configurações de marca, equipes e solicitações de acesso
        ├── posts.ts            # Decks, criação, edições manuais, slides e renderizações
        ├── canva.ts            # Autenticação OAuth2 e endpoints de exportação de mídias
        ├── fabrica.ts          # Controle de conexões e pastas da Fábrica de IA
        └── settings.ts         # Perfis, limites e billing de uso
```

---

### 📂 Diretório `/frontend` (Interface Web Next.js)
```
frontend/
├── tsconfig.json               # Configurações do compilador TypeScript
├── next.config.ts              # Regras de compilação, redirecionamentos e imagens Next.js
├── vitest.config.ts            # Configurações de testes unitários do lado do cliente
├── public/                     # Ativos estáticos e logotipos servidos diretamente
└── src/                        # Código Fonte Principal
    ├── middleware.ts           # Validador de cookies/rotas Next.js (proteção de rotas)
    │
    ├── app/                    # Estrutura de Rotas e Páginas (Next.js App Router)
    │   ├── layout.tsx          # Wrapper global do documento (HTML/Body/Fonts)
    │   ├── favicon.ico         # Ícone da aba do navegador
    │   ├── globals.css         # Reset de CSS, variáveis globais e tokens de cores
    │   │
    │   ├── login/              # Página de login e recuperação de credenciais
    │   ├── onboarding/         # Fluxo inicial de novos usuários e marcas
    │   │
    │   └── [marca]/            # Rotas Protegidas sob Escopo da Marca Selecionada
    │       ├── galeria/        # Painel central de artes, listagem e subpastas
    │       ├── fabrica/        # Chat e geração conversacional com IA (Fábrica)
    │       ├── editor/         # Tela de edição e painéis
    │       │   └── [postId]/   # Editor visual do post correspondente (DesignIR)
    │       ├── configuracoes/  # Configurações da marca, convite de membros e faturamento
    │       └── projetos/       # Listagem e controle de status de projetos
    │
    ├── components/             # Componentes Visuais Componentizados e Reutilizáveis
    │   ├── DesignDocument/     # Renderizadores de slides do lado do cliente
    │   │   ├── HtmlSlideRenderer.tsx  # Renderizador estrito para html-design antigo
    │   │   └── IRSlideRenderer.tsx    # Renderizador reativo e escalável para ir-design
    │   ├── DesignIR/           # Componentes internos de desenho do DesignIR
    │   │   └── IRSlideView.tsx # Renderizador element-by-element de formas/textos
    │   ├── Editor/             # Componentes da tela de edição do canvas
    │   │   ├── IRCanvasEditor.tsx     # Canvas interativo com suporte para drag & resize
    │   │   ├── ColorPickerPanel.tsx   # Painel de controle de preenchimento e bordas
    │   │   └── TransformPanel.tsx     # Ajustes manuais de X, Y, Largura e Altura
    │   └── Fabrica/            # Componentes internos da Fábrica de IA
    │       ├── ArtifactPanel.tsx      # Sidebar interativa de previews do chat
    │       └── FolderPicker.tsx       # Escolha da pasta de destino antes da geração
    │
    ├── hooks/                  # Custom Hooks para Gerenciamento de Estado Reativo
    │   ├── useFabricaWs.ts     # Conexão WebSocket resiliente e reidratação de chat
    │   └── useBrandPermissions.ts     # Validador reativo de permissões de usuário (RBAC)
    │
    ├── lib/                    # Utilitários Globais de Interface
    │   ├── api.ts              # Cliente HTTP Axios configurado com interceptor JWT
    │   ├── designContent.ts    # Extratores de preview, histórico de conversas e guards
    │   └── hooks.ts            # Hooks unificados de SWR para cacheamento de dados
    │
    └── styles/                 # CSS Modules Globais
        └── tokens.css          # Design Tokens (tamanhos, fontes, transições)
```

---

### 📂 Diretório `/docs` (Documentação e Histórico)
Este diretório armazena diretrizes operacionais, logs de sessão, auditorias de segurança e referências de engenharia:
```
docs/
├── AUDIT-2026-07-15.md                   # Auditoria de segurança e permissões de dados
├── CHECKLIST-PPTX-CANVA.md               # Detalhamento de compatibilidade Canva Connect
├── html-to-pptx-canva-brief.md           # Roteiro original de estruturação do export Canva
├── ROADMAP.md                            # Roadmap técnico de entrega do Designer
├── plano_execucao_claude.md              # [REMOVIDO DA RAIZ] Plano técnico manager-worker
├── CHECKLIST_SESSAO_2026_07_13_15.md     # [REMOVIDO DA RAIZ] Checklist de pendências técnicas
└── status_desenvolvimento_2026_07_15.md # [REMOVIDO DA RAIZ] Log de entrega e pendências de IA
```

---

## 📐 3. Padrões Arquiteturais Consolidados

### 1. Modelo de Segurança Multitenant (RBAC estrito)
* **Regra Relacional:** O acesso à plataforma é restrito pelo modelo `BrandMember` e `BrandRole` (`OWNER`, `EDITOR`, `VIEWER`). É expressamente proibido validar propriedade de marca usando a coluna antiga `Brand.userId`.
* **Isolamento de Rotas:** Toda rota no escopo de `/api/brands/:slug` passa pelo middleware `requireBrandRole`. O endpoint filtra mídias, mídias externas, posts, versões e pastas utilizando a FK `brandId`.
* **Segurança de Memória:** O escopo do `brandId` é repassado para todas as consultas do Prisma de forma estrita para evitar o vazamento de dados entre inquilinos (*cross-tenant leaks*).

### 2. Formato Intermediário de Design (DesignIR)
* **Estrutura Declarativa:** Em vez de lidar com código HTML/CSS bruto complexo, o sistema unificou o fluxo visual no `DesignIR` (`frontend/src/components/DesignIR`).
* **Operações por Patch:** Modificações feitas no canvas do editor são convertidas em patches estruturados JSON (`lib/designIR/patcher.ts`). Isso garante edições incrementais, permitindo recursos de *Undo/Redo* sem perda de integridade do slide.
* **Preservação de Versões:** Toda alteração de design salva pelo editor armazena uma cópia histórica leve (snapshot) usando a tabela relacional `PostVersion`.

### 3. Manager-Worker de IA & Gestão de Custo
* **Geração em Lote:** O pipeline de IA utiliza uma orquestração em duas etapas:
  * **Etapa 1:** O *Manager* (Gemini Pro) gera um plano de design estruturado (JSON Skeleton) e o persiste no banco de dados Postgres.
  * **Etapa 2:** O *Worker* (Gemini Flash) roda em segundo plano consumindo a fila do Redis (BullMQ), montando slide por slide de forma assíncrona.
* **Sessões Fatiadas:** As conversas da Fábrica são salvas no Redis fatiadas em três chaves (`:meta`, `:messages`, `:design`). Isso reduz em mais de 70% o uso de tráfego de rede e latência no processamento concorrente do Redis.
* **Fallback de Reabertura:** Quando a sessão expira do cache Redis (TTL de 24 horas), o backend é capaz de ler o histórico da conversa e recriar o WebSocket reidratado a partir do banco PostgreSQL de forma invisível para o usuário.

### 4. Entrega e Integração com o Canva Connect API
* **Exportação Assíncrona:** A exportação para o Canva é processada pela fila assíncrona do BullMQ. Slides são gerados graficamente utilizando um cluster do Puppeteer (`raster.ts`), salvos no Cloudflare R2 e enviados ao Canva usando as credenciais OAuth 2.0 / PKCE recuperadas do usuário para máxima velocidade e estabilidade.

---

## 🛠️ 4. Padrões de Código e Diretrizes de Engenharia

1. **Ausência de Supressões de Linter/Tipagem:**
   * É proibido o uso de `// @ts-ignore` ou `any` genéricos para "enganar" o compilador. O build do frontend e do backend precisa passar sem erros de TypeScript (`tsc --noEmit` limpo).
2. **Modularização de Imports no Backend:**
   * O projeto roda em ESM (ECMAScript Modules). Todos os imports internos locais do backend **devem incluir obrigatoriamente a extensão do arquivo** (ex: `import { prisma } from './prisma.js';`).
3. **Escrita Cirúrgica (Mínimo Impacto):**
   * Edições de código devem ser cirúrgicas utilizando o utilitário `replace` para garantir alteração de menor escopo possível, preservando formatações e sem alterar lógicas alheias ao escopo da tarefa.
4. **Higiene e Governança:**
   * Arquivos temporários e scripts de testes de uso único (extensão `.tmp` ou `.py` na raiz) devem ser apagados após sua validação e execução para manter o repositório limpo.

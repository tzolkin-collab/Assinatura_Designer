export type DocItem = {
  slug: string;
  title: string;
  description: string;
  emoji?: string;
  markdown: string;
};

export const DOCS: DocItem[] = [
  {
    slug: 'manual-do-usuario',
    emoji: '👥',
    title: 'Manual do Usuário',
    description: 'Aprenda a utilizar todas as funções do aplicativo (Fábrica de IA, Editor Canvas, Histórico, Mídias e Canva).',
    markdown: `# Manual do Usuário — Designer Assinatura

Bem-vindo ao **Designer Assinatura**! Esta é uma ferramenta interna exclusiva desenvolvida para que designers, estrategistas e clientes colaborem na criação e edição rápida de criativos visuais (apresentações, propostas comerciais e posts) de alta qualidade.

O sistema une a inteligência artificial (Google Gemini) a um editor visual interativo de co-criação, entregando as peças finais diretamente no seu workspace do Canva.

---

## 📖 Sumário
1. [Acesso e Organização de Equipe (Cargos e Permissões)](#1-acesso-e-organizacao-de-equipe-cargos-e-permissoes)
2. [Fábrica de IA: Gerando Novos Designs](#2-fabrica-de-ia-gerando-novos-designs)
3. [Editor Visual: Editando Elementos no Canvas](#3-editor-visual-editando-elementos-no-canvas)
4. [Biblioteca de Mídia: Uploads e Reutilização](#4-biblioteca-de-midia-uploads-e-reutilizacao)
5. [Co-criação e Histórico de Versões (Undo/Redo)](#5-co-criacao-e-historico-de-versoes-undoredo)
6. [Exportação para o Canva](#6-exportacao-para-o-canva)
7. [Transparência de Custos de IA ("IA hoje")](#7-transparencia-de-custos-de-ia-ia-hoje)

---

## 1. Acesso e Organização de Equipe (Cargos e Permissões)

O Designer Assinatura é organizado em torno de **Marcas (Brands)**. Cada Marca possui sua própria galeria de designs, biblioteca de mídias, equipe de usuários e configurações de identidade visual (Brand Book).

### Convites de Equipe
Se você é um **Owner** (Dono) ou **Admin** (Administrador) de uma marca, você pode convidar novos membros para colaborar:
1. Acesse as **Configurações** no menu lateral.
2. Vá para a aba **Equipe**.
3. Clique em **Convidar Membro**.
4. Digite o e-mail do convidado e selecione a permissão apropriada (cargo).
5. O sistema gerará um **link de convite seguro de uso único**. Copie e envie para o novo membro criar sua conta e acessar diretamente.

### Níveis de Permissões (RBAC)
Para garantir a segurança, cada membro possui um papel definido:

| Cargo | O que pode fazer |
|---|---|
| 👑 **OWNER (Dono)** | Acesso total. Gerencia faturamento, exclui a marca, altera configurações críticas e convida membros. |
| 🛡️ **ADMIN (Administrador)** | Gerencia a equipe (convida e remove membros) e tem acesso total de edição e criação. |
| ✍️ **EDITOR (Designer)** | Cria novos designs na Fábrica de IA, edita slides no Canvas e realiza a exportação para o Canva. |
| 👁️ **VIEWER (Cliente)** | Visualiza a galeria de posts, navega pelo histórico, deixa comentários ou solicitações de alteração, mas **não pode** realizar edições diretas ou exclusões. |

---

## 2. Fábrica de IA: Gerando Novos Designs

A **Fábrica de IA** é onde a mágica da criação em lote acontece. Ela permite que você descreva em linguagem natural o que deseja criar e a IA monte o deck inteiro de slides em minutos.

### Como gerar um novo design:
1. No painel principal da sua marca, acesse a aba **Fábrica** no menu lateral esquerdo.
2. **Escolha a Pasta:** Antes de escrever seu prompt, selecione a pasta ou subpasta de destino na galeria (utilize o botão \`Escolher Pasta\`). Isso mantém o seu workspace organizado.
3. **Descreva seu Conteúdo:** No campo de texto, insira o prompt (briefing). Quanto mais detalhes você fornecer, melhor será o resultado.
   - *Exemplo de bom prompt:* \`"Crie uma apresentação institucional de 8 slides para a empresa de tecnologia CyberFlow. Detalhe na introdução a missão de integrar IA em processos, inclua um slide com 3 pilares de serviços, um slide de portfólio de clientes e termine com um call-to-action para agendamento de chamadas."\`
4. **Gerando:** Clique em **Gerar Design**. O sistema usará o pipeline inteligente em duas etapas:
   - Primeiro, o *Manager* planeja a estrutura conceitual de textos dos slides.
   - Depois, o *Worker* renderiza graficamente cada slide na fila em segundo plano. Você pode acompanhar o progresso em tempo real pelo painel lateral (**ArtifactPanel**).

---

## 3. Editor Visual: Editando Elementos no Canvas

Depois que o design é gerado, você pode fazer ajustes manuais finos e milimétricos no **Editor Visual** (semelhante ao Figma ou Canva).

### O Canvas Interativo
Dê um duplo clique em qualquer post na galeria para abrir o editor. Nele, você pode:
- **Selecionar:** Clique em qualquer caixa de texto, imagem ou forma geométrica.
- **Mover:** Arraste o elemento selecionado para qualquer posição do slide.
- **Redimensionar:** Use as alças de controle nos cantos e laterais dos elementos para aumentar ou diminuir o tamanho.
- **Seleção Múltipla:** Pressione e arraste o mouse sobre vários elementos, ou segure a tecla \`Shift\` enquanto clica neles para selecioná-los em lote.

### Painéis Laterais de Edição
Conforme o que você seleciona, o painel lateral de propriedades se adapta:

* **Painel de Transformação (TransformPanel):**
  - Permite digitar valores exatos para as coordenadas horizontais (\`X\`), verticais (\`Y\`), largura (\`Largura\`) e altura (\`Altura\`) do elemento.
* **Painel de Texto (TextPanel):**
  - Modifique o conteúdo de texto diretamente.
  - Altere a tipografia (fontes homologadas pelo Brand Book da marca), tamanho do texto, cor da fonte, alinhamentos (esquerda, centro, direita, justificado) e formatação (negrito, itálico).
* **Painel de Cores e Estilos (ColorPickerPanel):**
  - Altere a cor de preenchimento de formas e caixas.
  - Configure bordas (cor, espessura e arredondamento dos cantos).
  - Controle a opacidade/transparência de fundos e elementos.
  - Aplique e configure efeitos de sombra projetada (Shadow).
* **Painel de Seleção Múltipla (MultiSelectPanel):**
  - Exibe opções para alinhar os elementos selecionados de forma automática (alinhar à esquerda, alinhar ao topo, centralizar, distribuir espaços igualmente).

---

## 4. Brandbook Inteligente — Memória Visual da Marca

O **Brandbook Inteligente** é o coração da identidade visual no Designer Assinatura. Ele centraliza diretrizes de marca, paleta de cores, logotipos e grafismos vetoriais — e toda essa informação alimenta a IA para garantir consistência em cada design gerado.

### Como adicionar o Brandbook da marca:
1. Acesse **Configurações** > **Biblioteca de Mídia**.
2. Clique em **Adicionar Brandbook Completo** (botão laranja com ícone de estrela).
3. Escolha a forma de importação:
   - **Arquivos (PDF / ZIP / SVG / PNG):** Arraste ou selecione o manual da marca em um dos formatos suportados.
   - **Importar do Canva:** Cole a URL ou ID de um design/template criado no Canva (ex: \`https://www.canva.com/design/DAG.../edit\`).
4. Clique em **Processar e Indexar Brandbook** (ou **Importar e Indexar do Canva**).

### O que a IA extrai automaticamente:
| Informação | O que acontece |
|---|---|
| 📜 **Diretrizes de Marca** | Tom de voz, regras de identidade visual, proibições e personalidade da marca salvas na memória da IA. |
| 🎨 **Paleta de Cores** | Todos os hexadecimais detectados são indexados e ficam disponíveis como atalhos de cor no editor. |
| 🔡 **Tipografias Primárias** | Os nomes das famílias de fontes são registrados para padronização dos designs gerados. |
| 🖼️ **Logotipos (LOGOTYPE)** | O logotipo oficial é detectado automaticamente. O sistema pede confirmação antes de substituir o logo atual. |
| ✦ **Grafismos de Marca (GRAPHIC_ELEMENT)** | Estrelas, grafismos de moldura, separadores e padrões de fundo são vetorizados e catalogados. |
| 🔧 **Ícones e Ilustrações (ILLUSTRATION)** | Conjuntos de ícones de linha (caixas, sacolas, relógios, etc.) são pescados e indexados na biblioteca de mídia. |

### Resultado visível após a indexação:
- Uma tela de confirmação exibe a paleta de cores detectada, a contagem de SVGs classificados por tipo e um preview do logotipo detectado.
- Se um novo logotipo foi identificado, você pode clicar em **Substituir pela Nova Logo** para atualizá-lo oficialmente na marca.
- Todos os SVGs ficam disponíveis na **Biblioteca de Mídia** filtráveis pela tag \`brandbook\`.

### Guia de Prompts para criar assets com IA externa:
Se você quiser criar assets antes de subir o Brandbook, use este prompt base no **Midjourney, DALL-E 3 ou Recraft v3**:
\`\`\`
Vector brand identity kit for "[Nome da Marca]", minimalist visual identity,
flat vector shapes, brand mark logo, graphic patterns, decorative borders and icons,
isolated on clean white background, brand color palette [Sua Paleta Hex]
--no realistic, 3d, photo
\`\`\`
Dica: Gere os vetores no **Recraft.ai** e converta para SVG antes do upload, ou deixe a IA do Designer pescar e vetorizar automaticamente ao subir a imagem/PDF.

---

## 5. Biblioteca de Mídia: Uploads e Reutilização

A **Biblioteca de Mídia** armazena todas as imagens, ícones, logotipos e grafismos vetoriais da marca.

### Como gerenciar e usar assets:
- **Upload Centralizado:** Vá em **Configurações** > **Biblioteca de Mídia** para fazer upload de arquivos usando arrastar e soltar (Drag & Drop).
- **Formatos Suportados:** Imagens estáticas (PNG, JPG, WEBP) e vetores (SVG).
- **Fontes de Assets:** Cada arquivo é rotulado com a sua origem — *Upload*, *Drive*, *Canva*, *Gerado por IA* ou *Brandbook*.
- **Filtros:** Use os chips de filtro por fonte e por tags para localizar rapidamente ícones, logotipos ou grafismos específicos.
- **Uso no Editor:** Dentro do editor visual, clique em uma caixa de imagem e selecione **Substituir Imagem**. Um modal abrirá listando todos os arquivos da biblioteca da marca, permitindo trocar o ativo instantaneamente ou fazer o upload de um novo direto pelo editor.

---
`,
  },
  {
    slug: 'documentacao-tecnica',
    emoji: '🛠️',
    title: 'Documentação Técnica',
    description: 'Guia arquitetural, modelo de dados, segurança RBAC, agentes de IA, Brandbook Inteligente e integração Canva.',
    markdown: `# Documentação Técnica — Designer Assinatura

Editar criativos gerados por IA exige segurança. O Designer Assinatura conta com mecanismos para você testar ideias sem medo de perder o progresso.

### Co-criação com o Chat de IA (Patches)
Caso você queira modificar os slides usando inteligência artificial no editor:
1. Abra o chat de IA lateral dentro do editor do post.
2. Peça alterações textuais ou visuais específicas.
   - *Exemplos:* \`"IA, mude o título do slide 3 para vermelho"\` ou \`"Escreva um texto mais curto para o slide 1"\`.
3. A IA analisará o seu pedido e aplicará modificações (patches) direcionadas aos slides indicados, sem alterar os demais elementos que você já organizou manualmente.

### Histórico de Versões
Toda alteração feita por você no editor (ou modificações sugeridas pelo Chat de IA) gera um registro histórico.
- **Undo/Redo Local:** Utilize os atalhos de teclado comuns (\`Ctrl + Z\` para desfazer, \`Ctrl + Y\` para refazer) ou as setas no topo do painel do editor para desfaçamentos rápidos durante a sessão.
- **Painel de Versões (Versões Salvas no Banco):** No painel de histórico, você pode ver um registro cronológico de salvamentos automáticos e alterações feitas pela IA.
  - Cada versão detalha a data, o autor (seu nome ou a indicação "IA") e uma breve descrição.
  - Se você ou a IA cometerem um erro, basta selecionar uma versão anterior no painel e clicar em **Restaurar Versão** para voltar a apresentação exatamente ao estado que ela estava naquele momento.

---

## 6. Exportação para o Canva

A exportação para o Canva é o passo de entrega final do seu design. A Canva Connect API é integrada para disponibilizar o conteúdo gerado direto no seu painel do Canva como artes prontas.

### Como exportar:
1. **Conecte sua Conta Canva:** A primeira vez que tentar exportar, você será redirecionado para autorizar o Designer Assinatura a acessar sua conta Canva (fluxo seguro OAuth).
2. **Solicite a Exportação:** No editor de design ou na galeria, clique em **Exportar para o Canva**.
3. **Processamento Assíncrono:** A exportação roda em segundo plano. Nosso servidor renderizará cada slide como uma imagem estática de altíssima definição (preservando perfeitamente todas as fontes e layouts que você vê no editor) e enviará o pacote para o seu Canva.
4. **Pronto para Postar:** O sistema notificará quando terminar e disponibilizará um link direto. Ao abrir o Canva, o deck completo estará lá, organizado como um novo design pronto para download ou publicação pelo seu time.

---

## 7. Transparência de Custos de IA ("IA hoje")

Para manter o controle financeiro do contrato, o Designer Assinatura possui contabilidade transparente de tokens consumidos pela IA por cada marca.

- **Indicador "IA hoje":** Exibido na Fábrica e na Galeria de posts. Ele mostra em tempo real quantos tokens de geração a sua marca consumiu no dia e qual é o limite diário configurado para evitar surpresas no final do mês.
- **Aba "Gastos de IA":** Localizada em **Configurações** > **Gastos de IA**. Mostra relatórios analíticos do consumo em dinheiro estimado e tokens divididos **por modelo de IA** (como Gemini Pro e Gemini Flash) mês a mês.
- **Bloqueio Automático:** Se a marca atingir o teto orçamentário diário ou mensal contratado, a geração de novos designs é pausada temporariamente para evitar cobranças excedentes não autorizadas, sendo restabelecida automaticamente no ciclo seguinte ou por liberação administrativa do Owner.
- **Mensagem de Créditos Esgotados:** Se a conta corporativa global do Gemini estiver sem saldo, um aviso no topo do app indicará que novas criações estão suspensas até a recarga. As funções de edição e visualização de designs salvos continuam liberadas normalmente.
`,
  },
  {
    slug: 'documentacao-tecnica',
    emoji: '🛠️',
    title: 'Documentação Técnica',
    description: 'Guia arquitetural, modelo de dados, segurança RBAC, agentes de IA, otimização e integração Canva.',
    markdown: `# Documentação Técnica — Designer Assinatura

Este documento detalha as decisões de engenharia, arquitetura de sistemas, modelagem de segurança (RBAC) e padrões de desenvolvimento que regem o ecossistema do **Designer Assinatura**. Ele serve como guia de referência para engenheiros, desenvolvedores e administradores de infraestrutura do projeto.

---

## 1. Arquitetura e Stack Tecnológica

O sistema é estruturado como um monorepo modular composto por duas partes principais integradas por APIs REST e WebSockets, utilizando serviços externos de banco de dados, cache e armazenamento:

\`\`\`
                  ┌─────────────────────────────┐
                  │          FRONTEND           │
                  │   Next.js (React 19, TS)    │
                  └──────────────┬──────────────┘
                                 │
                         HTTPS / WebSockets
                                 │
                                 ▼
                  ┌─────────────────────────────┐
                  │           BACKEND           │
                  │     Node.js Express ESM    │
                  └──────────────┬──────────────┘
                                 │
         ┌───────────────────────┼──────────────────────┐
         ▼                       ▼                      ▼
┌─────────────────┐     ┌─────────────────┐    ┌─────────────────┐
│ BANCO DE DADOS  │     │ CACHE & QUEUES  │    │ OBJECT STORAGE  │
│  PostgreSQL     │     │  Redis / BullMQ │    │  Cloudflare R2  │
│  (Prisma ORM)   │     └─────────────────┘    └─────────────────┘
└─────────────────┘
\`\`\`

### Tecnologias Core:
1. **Frontend (\`/frontend\`):** Next.js (utilizando o App Router, TypeScript, React 19 e CSS Modules). Gerenciamento de estado local para interações em tempo real com o Canvas e reidratação do chat via WebSocket.
2. **Backend (\`/backend\`):** Node.js rodando com suporte nativo a ESM (ECMAScript Modules), Express e TypeScript.
3. **Persistência de Dados:** PostgreSQL orquestrado com o Prisma ORM.
4. **Cache & Filas:** Redis e BullMQ para processamento de filas assíncronas (como renderização massiva e exportação para o Canva).
5. **Storage:** Cloudflare R2 (API S3 compatível) para armazenamento durável de mídias de marcas (Assets) e arquivos temporários.
6. **Renderização Gráfica:** Cluster gerenciado do Puppeteer (Chromium headless) no servidor para rasterização de imagens.

---

## 2. Modelo de Segurança e Isolamento (RBAC)

O Designer é um sistema **multitenant** corporativo de uso interno. Para evitar vazamentos de dados entre inquilinos (*cross-tenant data leaks*), o isolamento de acessos no banco e nas rotas de API segue regras estritas.

### O Modelo \`BrandMember\`
A propriedade direta de marcas pelo campo legado \`Brand.userId\` foi **totalmente descontinuada**. Todo o controle de acesso é baseado na tabela pivot \`BrandMember\` e no respectivo enum de privilégios \`BrandRole\`:

- **\`OWNER\`**: Dono absoluto. Possui controle de faturamento, exclusão de marca e controle de equipe.
- **\`ADMIN\`**: Administrador de equipe. Pode convidar novos membros, mudar privilégios e gerenciar mídias/designs.
- **\`EDITOR\`**: Usuário operacional (designer). Cria novos posts, edita o canvas e exporta para o Canva.
- **\`VIEWER\`**: Acesso de leitura (cliente). Visualiza designs e galerias, aprova ou solicita revisões, mas é impedido de realizar edições diretas ou modificações destrutivas.

### Middleware Unificado de Autorização
Toda rota no backend que interage sob o escopo de uma marca deve obrigatoriamente validar o acesso usando o middleware \`requireBrandRole\`.
- O middleware extrai a relação do usuário com a marca (\`brandId\` / \`brandSlug\`).
- Qualquer requisição feita por um usuário sem relacionamento ativo com a marca retornará HTTP \`403 Forbidden\`.
- O ID da marca resolvido pelo middleware é repassado estritamente para as queries do Prisma:
  \`\`\`typescript
  // Exemplo de isolamento obrigatório em consultas
  const posts = await prisma.post.findMany({
    where: {
      brandId: currentBrandId, // Isolamento estrito
    }
  });
  \`\`\`

### Segurança em Convites
O fluxo de convite de equipe utiliza tokens criptográficos de uso único, com data de expiração rápida, armazenados na tabela \`BrandInvite\`. O link gerado exige o aceite explícito do convidado no frontend antes de vincular a conta na tabela \`BrandMember\`.

---

## 3. Formato Intermediário de Design (DesignIR) e Editor

Para evitar a manipulação instável de HTML/CSS cru pela IA e no frontend, o sistema implementa um formato declarativo chamado **DesignIR** (Design Intermediate Representation).

### Estrutura Declarativa
O \`DesignIR\` define um slide como um array de elementos posicionados estruturalmente (composto por caixas de texto, formas geométricas, imagens e vetores).
- Cada elemento possui propriedades específicas de transformação (\`x\`, \`y\`, \`width\`, \`height\`, \`rotation\`), estilos (\`fill\`, \`stroke\`, \`opacity\`, \`shadow\`) e conteúdo.
- O frontend consome essa especificação reativamente no componente \`IRSlideRenderer\` (\`frontend/src/components/DesignDocument/IRSlideRenderer.tsx\`), desenhando as caixas correspondentes e anexando os controles de manipulação e redimensionamento interativos.

### Mutação por Patches
Ao invés de trafegar o JSON completo do deck a cada movimento no editor, as edições são compiladas em **patches de mutação incrementais** (\`frontend/src/lib/designIR/patcher.ts\`).
- Modificações de posição, cor ou texto geram um patch direcionado contendo as novas propriedades do elemento.
- No backend, o motor \`lib/designIR/aiPatch.ts\` aplica o patch ao modelo principal e incrementa o histórico.
- Isso viabiliza:
  1. Operações de **Undo/Redo** locais em memória rápidos.
  2. Salvamento histórico persistente de grandes alterações no banco usando \`PostVersion\`.
  3. Previews de "Aceitar/Descartar" modificações propostas via IA.

---

## 4. Pipeline de Agentes de IA (Manager-Worker) e Custo

A geração e modificação inteligente de designs no Designer Assinatura utiliza um modelo estruturado de orquestração de IA para reduzir latência e custos computacionais.

### Funcionamento do Pipeline Manager-Worker
A geração de decks extensos é dividida em dois papéis distintos:
1. **Manager (Gemini Pro):** É o cérebro conceitual. Ele lê o briefing (prompt), aplica as diretrizes visuais do *Brand Book* e planeja a estrutura global da apresentação em formato JSON estruturado (Slide Skeleton).
2. **Worker (Gemini Flash):** Executa o trabalho de layout em segundo plano. Ele consome a fila no Redis e popula os slides um a um, aplicando cópias de texto detalhadas, estilos e posicionamento de elementos sob o padrão \`DesignIR\`.

### Mecanismos de Resiliência da IA
Para evitar travamento de filas de processamento devido a instabilidades na API do Google Gemini, o backend adota:
- **Controle de Timeout por Modelo:** Timeouts estritos são definidos por tentativa baseando-se no peso do modelo (25s para modelos Flash, 150s para modelos Pro).
- **Mecanismo de Circuit Breaker (Disjuntor):** Monitora falhas consecutivas de rede ou lentidão extrema dos modelos de IA. Se duas tentativas falharem consecutivas em uma janela de 5 minutos, o modelo entra em cooldown de 3 minutos, promovendo um fallback automático para o próximo modelo disponível.
- **Retry com Fallback:** Se uma requisição de IA falha por instabilidade (ex: erro 503 do Gemini), o pipeline tenta novamente promovendo a chamada de forma transparente.

### Guardrails e Auditoria de Custos de IA
- Cada chamada à API do Gemini tem seu consumo em tokens exato persistido no banco de dados (\`AiUsage\`).
- O backend monitora o teto diário de tokens permitidos por marca. Se a marca atinge o limite diário de tokens, novas solicitações na Fábrica de IA são bloqueadas.
- O frontend busca essas métricas estruturadas pelo endpoint \`GET /brands/:slug/ai-usage\` para plotar os dashboards de faturamento por modelo em tempo real.

---

## 5. Otimização de Sessões de Chat (Redis)

Nas versões anteriores do projeto, toda mensagem de chat causava tráfego excessivo ao ler e salvar dados brutos em uma única chave de string do Redis. Para decks gigantescos (acima de 200 slides), o payload de tráfego de rede estourava a CPU do Redis.

### Fatiamento de Chaves de Sessão
O backend implementa o **Fatiamento de Sessão de Chat**. Cada sessão de chat ativa possui chaves divididas no Redis (prefixadas com \`:v2\` para evitar colisão com chaves incompatíveis legadas):
1. **\`:meta\` (Redis HASH):** Metadados curtos da sessão (título, marca dona, status, configurações).
2. **\`:messages\` (Redis LIST):** Linha do tempo de mensagens. Adições utilizam operações \`RPUSH\` atômicas de complexidade \$O(1)\$.
3. **\`:design\` (Redis STRING):** O payload completo do design (\`DesignIR\`). Esta chave só é lida ou gravada quando há uma mudança estrutural nas caixas ou slides.

### Reidratação Automática
Para evitar o consumo persistente de RAM do Redis, as chaves de sessão possuem um tempo de vida (TTL) de 24 horas. Se uma sessão expira do cache Redis, o backend intercepta a conexão e reidrata a sessão a partir do banco PostgreSQL de forma transparente ao usuário.

---

## 6. Fila de Exportação Canva e Renderização

A Canva Connect API não aceita estruturas flexíveis criadas elemento por elemento. A única entrega de arte suportada pela API do Canva de forma consistente é a injeção de imagens estáticas renderizadas de alta qualidade.

\`\`\`
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Solicitação │ ──► │ Fila BullMQ  │ ──► │  Puppeteer   │ ──► │ Cloudflare R2│
│  no Editor   │     │   (Redis)    │     │  (raster.ts) │     │ (Storage S3) │
└──────────────┘     └──────────────┘     └──────┬───────┘     └──────┬───────┘
                                                 │                    │
                                                 ▼                    ▼
                                          ┌──────────────┐     ┌──────────────┐
                                          │ Canva API    │ ──► │ Design Pronto│
                                          │ OAuth/Upload │     │  no Canva    │
                                          └──────────────┘     └──────────────┘
\`\`\`

### Processamento por Fila (BullMQ)
Toda a renderização e upload das páginas é delegada para os workers do BullMQ. O request HTTP de exportação encerra imediatamente após colocar o Job na fila, devolvendo um ID para o frontend acompanhar o progresso via canal WebSocket.

### Cluster de Puppeteer e Rasterização (\`raster.ts\`)
A geração das imagens estáticas ocorre no servidor:
- O módulo \`raster.ts\` utiliza **Puppeteer Cluster** com isolamento por contexto (\`CONCURRENCY_CONTEXT\`). Isso evita a sobrecarga de iniciar múltiplos browsers Chromium na mesma CPU.
- A concorrência máxima de renderizações simultâneas é regulada dinamicamente com base na memória disponível no servidor (\`RASTER_CONCURRENCY\`).
- São definidos timeouts estritos por página no Puppeteer para evitar travamento de slots por scripts órfãos.
- As imagens geradas são salvas no Cloudflare R2 e enviadas para o Canva Connect API através de requests autenticados pelo token OAuth 2.0 PKCE do usuário logado.

---

## 7. Padrões de Desenvolvimento e Governança

Ao dar manutenção no código-fonte, os seguintes padrões arquiteturais devem ser mantidos sem exceção:

1. **Importações ESM no Backend:**
   - O backend roda estritamente sob módulos ECMAScript (ESM). Todos os caminhos de importação locais internos **devem obrigatoriamente incluir a extensão do arquivo** (ex: \`import { prisma } from './lib/prisma.js';\`).
2. **Qualidade de Tipagem TypeScript:**
   - É proibido desligar validações do linter ou utilizar declarações de tipo \`any\` / \`@ts-ignore\` para contornar verificações do compilador. O build de produção deve rodar limpo (\`tsc --noEmit\`).
3. **Gerenciamento de Banco e Migrations:**
   - Nunca utilize \`prisma db push\` em ambientes de desenvolvimento que reflitam alterações globais ou de produção. Todas as modificações no \`schema.prisma\` devem gerar uma migration estruturada na pasta \`prisma/migrations\` via \`prisma migrate dev\` para manter a integridade dos schemas do banco e evitar drift.
4. **Isolamento de Testes:**
   - Sempre execute a suíte de testes de integração (\`npm test\` no frontend e backend) após qualquer refatoração para garantir a integridade do isolamento cross-tenant e rotas RBAC.
`,
  },
];

export const getDocBySlug = (slug: string) => DOCS.find((d) => d.slug === slug);

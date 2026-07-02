export type DocItem = {
  slug: string;
  title: string;
  description: string;
  emoji?: string;
  markdown: string;
};

export const DOCS: DocItem[] = [
  {
    slug: 'inicio-rapido',
    emoji: '🚀',
    title: 'Início Rápido',
    description: 'Crie sua primeira marca e gere a primeira arte.',
    markdown: `# Início Rápido

## 1) Criar uma marca

- Vá em **Galeria de Marcas**.
- Clique em **Nova Marca**.
- Defina o nome e a cor de destaque.

## 2) Configurar Branding

- Acesse **Configurações → Branding**.
- Preencha nome, história, site e Instagram.
- Defina as cores da marca e fontes.

## 3) Gerar na Fábrica

- Acesse **Fábrica**.
- Use o chat para pedir uma arte.
- A ferramenta **Imagem** gera um criativo e salva automaticamente.

## 4) Encontrar na Galeria

- Após a geração, você é direcionado para a **Galeria** da marca.
- Abra o **preview** e use **Download**.

## 5) Organizar por pastas

- Na Galeria da marca, clique em **Criar Pasta**.
- Use o seletor em cada card para mover uma arte para uma pasta.
`,
  },
  {
    slug: 'fabrica',
    emoji: '🏭',
    title: 'Fábrica',
    description: 'Como usar o chat + preview para criar artes.',
    markdown: `# Fábrica

## Visão geral

A Fábrica é um chat de criação com um painel de **Preview**.

## Ferramentas

- **Imagem**: gera uma imagem final e salva na Galeria.
- **Animação**: reservado para o fluxo de animação.

## Preview

- O preview mostra o último resultado.
- Você pode ir para a **Galeria** para baixar e organizar.
`,
  },
  {
    slug: 'galeria',
    emoji: '🎨',
    title: 'Galeria',
    description: 'Histórico de artes, preview, download e pastas.',
    markdown: `# Galeria

## O que é

A Galeria reúne tudo que foi gerado por marca.

## Preview

- Clique no botão de ampliar para abrir a visualização.
- Dentro do preview você pode baixar e mover para pasta.

## Download

- Use o botão **Download** no card ou no modal de preview.

## Pastas

- Clique em **Criar Pasta** no topo da seção Pastas.
- Use o seletor em cada item para escolher a pasta.
`,
  },
  {
    slug: 'configuracoes',
    emoji: '⚙️',
    title: 'Configurações',
    description: 'Branding, agente e referências.',
    markdown: `# Configurações

## Branding

Você define diretrizes de marca, cores e fontes.

## Agente IA

Configura o comportamento do agente e parâmetros gerais.

## Referências

Organiza benchmarks e insumos visuais para orientar as gerações.
`,
  },
  {
    slug: 'api-backend',
    emoji: '🔗',
    title: 'API & Backend',
    description: 'Rotas principais e conceitos de dados.',
    markdown: `# API & Backend

## Autenticação

As rotas de API exigem token.

## Recursos

- **Brands**: marcas do usuário.
- **Posts**: itens gerados e metadados.
- **Folders**: organização por pastas dentro da marca.

## Observação

Se você atualizar o schema do banco (Prisma), reinicie o backend para recarregar o client.
`,
  },
];

export const getDocBySlug = (slug: string) => DOCS.find((d) => d.slug === slug);

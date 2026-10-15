# Revisão de design da interface do Designer (12/10/2026)

Escopo: telas do frontend vistas no navegador com o projeto Amanda Coelho (desktop ~800 px de largura útil e mobile 375 px). Não cobre as artes geradas. Cobertura: Galeria de projetos, Visão geral, Galeria do projeto, Fábrica, Editor, Cérebro da IA e Branding. Não foram abertos: Mídia, Apresentações publicadas, Configurações gerais, Onboarding, login.

## O que está bom
- Identidade coerente: fundo quente, serifada nos títulos, Inter no corpo, cartões brancos com sombra suave.
- Acessibilidade básica ok na Galeria: nenhum `<img>` sem `alt`, 1 botão sem nome, 1 texto abaixo de 11,5 px (o "+4" dos avatares).
- Sidebar com rótulo acessível em todos os links.
- Mobile da Galeria de projetos funciona (menu hambúrguer, cartões em coluna única).
- A tela do Cérebro explica bem o que a ficha faz e mostra o progresso ("71% configurado").

## Problemas, por prioridade

### Alta
1. **Fábrica bloqueada para o dono sem explicação útil.** Em Amanda Coelho, o campo vem desativado com "Você não faz parte desta marca". O Gustavo é o proprietário listado na Galeria, mas não é membro. Ou a permissão está errada, ou a mensagem deveria dizer como entrar e quem pode adicionar.
2. **Título mostra o slug.** Fábrica e Galeria do projeto exibem `amanda-coelho` em vez de "Amanda Coelho". A Galeria de projetos já tem o nome certo, então o dado existe.
3. **Miniaturas vazias na Galeria do projeto.** Vários cartões de 7 slides aparecem em branco enquanto outros mostram a capa. O usuário não sabe se está carregando ou quebrado.
4. **Decks indistinguíveis.** Todos os decks de teste têm o mesmo título ("Estratégia para uma vida mais extraordinária") e só a data diferencia. Falta versão, status ou nota do revisor no cartão. Os decks de teste também poluem a vista (limpeza pendente, ver pendências do projeto).

### Média
5. **Salto de layout na Galeria do projeto.** Quando a barra "IA hoje" carrega, o bloco de ações sobe e empurra "Pastas do Projeto" uns 40 px para baixo. Reservar a altura resolve.
6. **Branding não reflete a ficha.** O Logotipo aparece vazio ("Arraste ou clique") mesmo com 14 variantes de logo na ficha e na biblioteca. Dá a impressão de que a marca não tem logo.
7. **Rótulos de cor colidem em Branding.** O código hex (`#410C1C`) fica ao lado de "Remover" e quase encosta. "Remover" tem contraste baixo e fica no mesmo nível de importância que o nome da cor.
8. **Sidebar longa e repetida.** Dois ícones de engrenagem (Configurações gerais e do projeto) e o ícone de painel duas vezes (Minhas Marcas e Visão geral) são difíceis de distinguir sem passar o mouse. Agrupar por seções com títulos curtos ajuda.
9. **Entrada de arquivo nativa no Cérebro.** O "Escolher arquivos / Nenhum arquivo escolhido" é o controle padrão do navegador e destoa do resto. O Branding já tem uma área de arrastar e soltar, que serve de modelo.
10. **Indicador de status sem rótulo na Fábrica.** O ponto vermelho no topo não diz o que significa. O "Aprovação: Auto / Manual" é pequeno e de baixo contraste.

### Baixa
11. **Tokens de cor inconsistentes** (`globals.css`): `--color-success` é `#10f300` (verde neon) e `--color-success-light` é `#f0f7ff` (azulado). O neon tem contraste ruim sobre fundo claro e o "light" não combina com verde.
12. **Estados de carregamento em texto puro.** "Carregando projeto…", "Carregando a ficha do projeto…" e "Abrindo última apresentação…" sobre fundo vazio, às vezes por vários segundos. Um esqueleto da página daria percepção de velocidade.
13. **Mobile:** o campo de busca da Galeria corta o placeholder ("Buscar pro"). O editor e a Fábrica não foram testados em 375 px e provavelmente precisam de revisão (layout em duas colunas).
14. **Botão "Aplicar no slide" desativado** ocupa a largura toda em cinza forte e chama mais atenção que o campo. Melhor mostrá-lo como secundário até haver texto.

## Sugestão de ordem
1. Itens 1 e 2: pequenos e visíveis em toda a Fábrica e Galeria.
2. Item 3 e 4: miniatura com estado de carregamento e identificação do deck no cartão.
3. Itens 5, 6 e 7: ajustes pontuais de layout.
4. Itens 8 a 14: passada de consistência (tokens, sidebar, esqueletos, mobile do editor).

## Limites desta revisão
- Janela de ~800 px; telas largas não foram vistas.
- Só o tema claro foi visto.
- Contraste foi avaliado a olho, sem medição, exceto pelos tokens.
- Nenhuma alteração de código foi feita.

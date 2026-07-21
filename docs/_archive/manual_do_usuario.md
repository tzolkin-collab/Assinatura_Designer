# Manual do Usuário — Designer Assinatura

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
2. **Escolha a Pasta:** Antes de escrever seu prompt, selecione a pasta ou subpasta de destino na galeria (utilize o botão `Escolher Pasta`). Isso mantém o seu workspace organizado.
3. **Descreva seu Conteúdo:** No campo de texto, insira o prompt (briefing). Quanto mais detalhes você fornecer, melhor será o resultado.
   - *Exemplo de bom prompt:* `"Crie uma apresentação institucional de 8 slides para a empresa de tecnologia CyberFlow. Detalhe na introdução a missão de integrar IA em processos, inclua um slide com 3 pilares de serviços, um slide de portfólio de clientes e termine com um call-to-action para agendamento de chamadas."`
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
- **Seleção Múltipla:** Pressione e arraste o mouse sobre vários elementos, ou segure a tecla `Shift` enquanto clica neles para selecioná-los em lote.

### Painéis Laterais de Edição
Conforme o que você seleciona, o painel lateral de propriedades se adapta:

* **Painel de Transformação (TransformPanel):**
  - Permite digitar valores exatos para as coordenadas horizontais (`X`), verticais (`Y`), largura (`Largura`) e altura (`Altura`) do elemento.
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

## 4. Biblioteca de Mídia: Uploads e Reutilização

A **Biblioteca de Mídia** armazena todas as imagens, ícones, logotipos e fontes personalizados da marca.

### Como gerenciar e usar assets:
- **Upload Centralizado:** Vá em **Configurações** > **Biblioteca de Mídia** para fazer upload de arquivos usando arrastar e soltar (Drag & Drop).
- **Formatos Suportados:** Imagens estáticas (PNG, JPG, WEBP) e vetores (SVG).
- **Uso no Editor:** Dentro do editor visual, clique em uma caixa de imagem e selecione **Substituir Imagem**. Um modal abrirá listando todos os arquivos da biblioteca da marca, permitindo trocar o ativo instantaneamente ou fazer o upload de um novo direto pelo editor.

---

## 5. Co-criação e Histórico de Versões (Undo/Redo)

Editar criativos gerados por IA exige segurança. O Designer Assinatura conta com mecanismos para você testar ideias sem medo de perder o progresso.

### Co-criação com o Chat de IA (Patches)
Caso você queira modificar os slides usando inteligência artificial no editor:
1. Abra o chat de IA lateral dentro do editor do post.
2. Peça alterações textuais ou visuais específicas.
   - *Exemplos:* `"IA, mude o título do slide 3 para vermelho"` ou `"Escreva um texto mais curto para o slide 1"`.
3. A IA analisará o seu pedido e aplicará modificações (patches) direcionadas aos slides indicados, sem alterar os demais elementos que você já organizou manualmente.

### Histórico de Versões
Toda alteração feita por você no editor (ou modificações sugeridas pelo Chat de IA) gera um registro histórico.
- **Undo/Redo Local:** Utilize os atalhos de teclado comuns (`Ctrl + Z` para desfazer, `Ctrl + Y` para refazer) ou as setas no topo do painel do editor para desfaçamentos rápidos durante a sessão.
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

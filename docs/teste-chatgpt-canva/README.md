# Teste: ChatGPT + Canva com a marca da Amanda Coelho

> Preparado em 22/11/2026. Responde a uma pergunta: **o fluxo ChatGPT + Canva, bem configurado, entrega o que o Designer prometia?** Se sim, o Designer sai do escopo e a entrega vira essa configuração. Se não, o teste mostra exatamente o que falta e onde.
>
> Duração estimada: 1h de configuração e 1h de teste. Ninguém rodou este teste ainda.

## O que tem nesta pasta

| Arquivo | Para quê |
|---|---|
| `1-instrucoes-do-projeto.txt` | Colar nas **instruções do Projeto** no ChatGPT. Traz o fluxo de trabalho e a memória da Amanda (§11.10), com o texto da Gabriela sem alteração. São cerca de 3.500 caracteres. |
| `2-cerebro-global.md` | **Anexar como arquivo** do Projeto. São as regras globais, a regra de foto, a base do motor de imagem, os modos e o collab (§3.1 a §9.1), extraídos sem alteração de `backend/src/lib/designerBrain/prompts.ts`. |
| `3-briefing-lote1.txt` | O briefing do lote 1 que a Gabriela escreveu: 5 slides, com direção de arte por slide. |
| `4-texto-aprovado-lote1.txt` | Só o texto aprovado do lote 1, para conferir palavra por palavra. |

## Passo 1: Brand Kit no Canva (precisa de Canva pago: Pro, Teams ou Business)

Criar um Brand Kit chamado **Amanda Coelho**:

- [ ] **Cores:** `#410C1C` vinho profundo · `#8E242E` vermelho vinho · `#D8E9F3` azul-gelo · `#FCF9EB` off-white/creme. Só essas quatro.
- [ ] **Fontes:** enviar os arquivos, não escolher parecidas.
  - Queens: `D:\Códigos\Tzolkin\Projetos\projeto-assinatura\designer\insumos-amanda\fontes\Queens\Queens-Regular.ttf`. Não usar o `QueensVar.ttf`, que é variável, a não ser que o Regular falhe.
  - Aeonik: `D:\Códigos\Tzolkin\Projetos\projeto-assinatura\designer\insumos-amanda\fontes\Aeonik\` (pelo menos Regular, Medium e Bold).
  - Definir Queens para **títulos** e Aeonik para **subtítulos e corpo**.
  - ⚠️ As duas fontes são comerciais. O Canva pede confirmação de licença para incorporação. Confirmar com a Gabriela que a licença da Amanda cobre isso.
- [ ] **Logos:** as variantes oficiais estão no Drive da Gabriela, pasta "AMANDA COELHO" (PDF de logos com 14 variantes). Não há cópia local. Subir pelo menos a versão para fundo claro e a versão para fundo escuro.
- [ ] **Fotos reais:** as 8 fotos do álbum de 05/10 que a Gabriela mandou estão em `D:\Códigos\Tzolkin\Projetos\projeto-assinatura\docs\WhatsApp Image 2026-10-05 at 19.03.*.jpeg`. Subir para a pasta de mídia da marca.
- [ ] Opcional: criar um **Brand Template** de apresentação 16:9 com as cores e as fontes, se a Gabriela já tiver um layout que aprova.

## Passo 2: Projeto no ChatGPT (Plus, Pro ou Team)

1. Criar um Projeto chamado **Amanda Coelho**.
2. Em instruções do projeto: colar o conteúdo de `1-instrucoes-do-projeto.txt`. Se a tela recusar pelo tamanho, me avise: as fontes públicas divergem sobre o limite.
3. Em arquivos do projeto: anexar `2-cerebro-global.md`. Se a Gabriela tiver o manual visual da Amanda em PDF, anexar também.
4. Conectar o **app Canva** no ChatGPT, com a mesma conta do Canva que tem o Brand Kit, e conferir que o Brand Kit aparece.

## Passo 3: o teste

Abrir uma conversa **dentro do Projeto**, colar o conteúdo de `3-briefing-lote1.txt` e rodar três rotas. Cada rota numa conversa nova:

| Rota | Como pedir | O que ela prova |
|---|---|---|
| **A. Imagem do ChatGPT** (o fluxo de hoje da Gabriela) | "Gere os 5 slides como imagem, um arquivo por slide." | Teto de qualidade visual. |
| **B. App Canva** | "Crie esta apresentação no Canva usando o Brand Kit Amanda Coelho." | Se dá para ter marca e edição sem regerar. |
| **C. Designer** (referência) | O deck que o Designer gerou para este mesmo lote. Se não houver, gerar custa ~US$ 0,40 e grava na conta da Amanda: pedir OK antes. | Ponto de comparação. |

Depois da rota B, testar a edição **sem regerar**, no Canva e também pelo chat:

1. trocar a frase de um slide;
2. trocar uma área reservada por uma foto real da Amanda;
3. trocar a cor de fundo de um slide;
4. trocar a versão do logo.

**Teste extra de foto (rota A):** anexar uma foto real da Amanda e pedir o slide 01 com ela. Conferir se o rosto continua o dela. Modelos de imagem costumam redesenhar a pessoa, o que fere a regra §5 do cérebro.

## Passo 4: a planilha de notas (preencher com a Gabriela, não por nós)

Para cada rota, uma linha por slide:

| Critério | A | B | C |
|---|---|---|---|
| Texto idêntico ao aprovado (conferir com `4-texto-aprovado-lote1.txt`, acentos inclusos) | | | |
| Queens nos títulos e Aeonik no apoio (não uma fonte parecida) | | | |
| Só as 4 cores da paleta | | | |
| Arquétipo de composição diferente do slide anterior | | | |
| Nenhuma pessoa gerada; foto real com rosto preservado | | | |
| Nenhum item proibido (círculos decorativos, caixas, sombra, degradê, ícones, numeração de slide, palavras a mais) | | | |
| Editável sem regerar: texto / foto / cor / logo (marcar cada um) | | | |
| **A Gabriela usaria como está?** (sim / com ajuste / não) | | | |
| Tempo até a versão final | | | |

**Como decidir:**
- **B ganha ou empata com A em qualidade e passa na edição:** o Designer sai do escopo. A entrega passa a ser esta configuração, com manutenção do Brand Kit e do Projeto para cada marca.
- **A ganha em qualidade, mas B não edita direito:** o fluxo dela continua ChatGPT + Canva (com o Grab Text para o texto). Nossa entrega é o Projeto com o cérebro, e não um app.
- **Nenhuma rota serve:** o problema está nas regras ou no padrão de qualidade, não na ferramenta, e isso é uma conversa com a Gabriela, não código.

## O que não foi verificado

- O limite de caracteres das instruções de Projeto (uma fonte diz 8.000; não há número oficial).
- Se o app Canva no ChatGPT usa de fato o Brand Kit e as fontes enviadas. As notícias do lançamento (fev/2026) dizem que sim, mas uma página de ajuda do Canva ainda diz que o Brand Kit não está disponível no ChatGPT.
- Se a licença das fontes Queens e Aeonik permite enviar ao Canva.

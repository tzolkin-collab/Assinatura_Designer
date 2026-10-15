# Achados do exemplo "Amanda Coelho"

> **Data:** 2026-10-05 · **Natureza:** levantamento. **Nada foi corrigido**: este arquivo só registra erros e inconsistências, de sistema e visuais, para resolvermos depois.
> **Convenção:** ✅ funcionou · ❌ erro · ⚠️ inconsistência · 🟡 HIPÓTESE (não confirmada) · Prioridade **P0** bloqueia a promessa do cérebro · **P1** aparece para a Gabi · **P2** acabamento.

---

## 1. O que foi criado

| Item | Valor |
|---|---|
| Marca (projeto-base) | `amanda-coelho`, id `b9e8615a-4b1c-4fdc-889e-a75a1279b818`, **banco real**, visível para toda a equipe |
| Dono | `brtzolkin@gmail.com`; demais contas entram como editoras pela sincronização da equipe interna |
| Configuração | memória do §11.10 do cérebro em "Instruções do agente"; paleta `#410C1C #8E242E #D8E9F3 #FCF9EB`; fontes `Queens, Aeonik` |
| Apresentação de exemplo | post `cac74ba1-2a3d-466e-8ebc-1af4056b5ebe`, 7 slides, 1920×1080, status `READY` |
| Como foi gerada | pipeline direto (script), com o cérebro **ligado** (`DESIGNER_BRAIN_BRANDS=amanda-coelho`), código local = #58 + #59 + #61 + `main` |
| Sem | logo, fontes (arquivos), fotos reais: a pasta "Elementos Desinger" ainda não chegou |
| Custo e tempo | 240 s · 33 056 tokens de entrada · 10 023 de saída · 4 chamadas do artista (`gemini-3.1-pro-preview`) |

### Texto usado (completo, na ordem, um bloco por slide)

Texto de **exemplo**, sem nenhum fato sobre a Amanda (sem biografia, número, cliente ou caso). A única frase dela é a do moodboard.

1. **Estratégia para uma vida mais extraordinária** · Uma forma de pensar negócios, carreira e escolhas com clareza, repertório e coragem.
2. **Todo resultado começa em uma decisão** · Antes de qualquer plano, existe uma pergunta: o que realmente vale a pena construir? Quando a resposta é clara, o caminho deixa de ser ruído e passa a ser direção. Estratégia não é complicar; é escolher com consciência o que fica e o que sai.
3. **Crescer sem direção cansa** · Muita energia vai para tarefas que parecem urgentes e não levam a lugar nenhum. Sem um critério claro, cada oportunidade parece igual, e a agenda se enche de compromissos que não conversam com o futuro que se quer viver.
4. **Três movimentos para ganhar clareza** · Primeiro, enxergar o cenário como ele é, sem filtros. Depois, decidir com critério, assumindo o que se escolhe e o que se abandona. Por fim, executar com consistência, ajustando o rumo sem perder a essência.
5. **Negócios sólidos nascem de decisões conscientes** · Empresas duradouras não dependem de sorte nem de pressa. Elas se apoiam em posicionamento claro, em pessoas bem escolhidas e em hábitos de gestão que se repetem mesmo quando ninguém está olhando.
6. **Uma vida extraordinária também é planejada** · O que se constrói no trabalho precisa caber na vida que se deseja. Tempo, energia e propósito entram na mesma conta: não há estratégia boa que exija abrir mão de tudo o que importa.
7. **O próximo passo é uma boa conversa** · Se faz sentido pensar o seu momento com mais método e mais coragem, o primeiro movimento é simples: sentar, olhar o cenário e decidir juntos por onde começar.

---

## 2. O que funcionou

| ✅ | Evidência |
|---|---|
| Quantidade e ordem | 7 slides, na ordem, um bloco por slide |
| Texto completo | os 7 blocos aparecem inteiros; só **2 slides** têm texto a mais (ver S1 e S2) |
| Nenhuma imagem gerada ou de banco | 0 `<img>` nos 7 slides |
| Paleta oficial | só vinho `#410C1C`, vermelho `#8E242E`, azul-gelo `#D8E9F3` e creme `#FCF9EB` |
| Sem degradê, ícone 3D, blob ou texto sobre rosto | conferido nos 7 slides |
| Contraste do texto principal | claro sobre escuro e escuro sobre claro em todos |
| Checagem de texto em código | **acusou** exatamente os 2 slides que divergem (1 e 4) |
| Nenhum slide de fallback | 0 slides genéricos; todos com `htmlRender` |

---

## 3. Achados de SISTEMA

| # | Pri. | Achado | Evidência | Onde mexer depois |
|---|---|---|---|---|
| S1 | **P0** | **Logo ausente vira "logo inventado" em texto.** Sem ativo de logo, o artista escreveu "AMANDA COELHO" em caixa alta na capa, imitando um wordmark. A memória da Amanda proíbe "logo inventado". Não existe regra para "logo ausente". | Slide 1; a checagem acusou `"amanda", "coelho"` como texto a mais | Regra de "ativo ausente": reservar o espaço do logo, nunca digitar o nome |
| S2 | **P0** | **Numeração "01 02 03" inventada.** A memória proíbe "numeração técnica visível sem pedido" (§11.9). O layout de lista a acrescentou. | Slide 4; a checagem acusou `"01", "02", "03"` | Proibições da marca viram verificação em código, não só prompt |
| S3 | **P0** | **A geração entrega o deck com divergência de texto e não corrige.** A checagem acusa, mas o status fica `READY` e não há laço de correção. Quem vê precisa ler a análise do chat. | `status=READY`, `needs_review`, 2 desvios | Reentrada automática nos slides divergentes (o "ajuste cirúrgico" já existe para a recusa) |
| S4 | **P0** | **O revisor visual não pegou o defeito mais visível.** Deu nota 82 e "totalmente alinhada", **sem citar** o slide 3 (título atravessando a divisão de cores) nem os blocos lisos. Citou como defeito uma linha decorativa de baixo contraste. | Revisão completa: 3 desvios, nenhum sobre o slide 3 | Reviewer com checagens objetivas (sobreposição, margem) além do juízo do modelo |
| S5 | **P0** | **A fonte da marca não é aplicada e ninguém é avisado.** A marca tem `Queens, Aeonik`; o artista usou **Playfair Display e Manrope**. Nada na tela ou no resultado diz que a fonte oficial não carregou. | `fontes=["Playfair Display","Manrope"]` | Upload de fonte (já conhecido) **e** aviso explícito de substituição |
| S6 | **P1** | **A mensagem de feedback se contradiz.** Sai "O texto de 2 slide(s) não confere com o texto aprovado. **Peça aprovada.** Direção de arte sofisticada…": o prefixo da checagem de texto foi colado ao feedback do revisor, que diz "aprovada". | `pendingReview.feedback` | Montar uma mensagem única, sem dois veredictos |
| S7 | **P1** | **Os 7 slides reservam espaço de foto**, inclusive citação, lista e fechamento. O briefing dizia "onde fizer sentido", e ele não discriminou. O deck só fica completo com 7 fotos. | `data-photo-slot` ×7 | Dar à IA e ao usuário um jeito de dizer "este slide não tem foto" |
| S8 | **P1** | **A apresentação nasce sem nome** e vira "Arte cac74ba1" na galeria (já era assim em 15 de 15 artes). O primeiro título do slide estava disponível. | `Post.name = null` | Nomear a partir do título da capa ou perguntar |
| S9 | **P1** | **Duas chaves escondidas ligam o cérebro:** a variável de ambiente `DESIGNER_BRAIN_BRANDS` e a memória em "Instruções do agente". Sem a variável a marca gera pelo caminho antigo, **sem avisar**. Sem UI para ligar/desligar. | `isDesignerBrainEnabled` por slug exato, sem prefixo | Mover o interruptor para a configuração da marca |
| S10 | **P1** | **Edição pós-geração usa o contexto antigo.** Editar um slide (IA ou chat) não carrega o cérebro nem a regra de espaço de foto: pode desfazer o que o cérebro garantiu. | `editHtmlSlide` não recebe `designerBrain` (limite já registrado no PR #58) | Ligar o cérebro à edição |
| S11 | **P1** | **O fluxo do chat com o cérebro não foi exercitado.** A geração foi pelo pipeline. A trava "sem texto aprovado" e a aprovação do roteiro existem no código, mas não passaram por uma conversa real. | geração por script | Rodar o fluxo completo pelo chat, com login |
| S12 | **P2** | **Criação de marca incompleta.** `POST /brands` cria a marca **sem** `BrandConfig`; o `slug` remove acento de forma ruim (existe `assinatura-marca-pr-pria` no banco); **todo administrador vira dono de toda marca nova** (13 donos hoje), o que bagunça o agrupamento "Proprietário" da galeria. | rota `brands.ts` e `internalTeam.ts` | Criar a configuração junto; slug sem lacunas; um dono só |
| S13 | **P2** | Um passo de **10 158 tokens de entrada e 238 de saída** aparece com papel `artist`; pelo tamanho parece ser a revisão visual. 🟡 | steps #9 | Conferir o rótulo do papel no rastro |

---

## 4. Achados VISUAIS

### 4.1 Por slide

| Slide | Pri. | Achado |
|---|---|---|
| **1 Capa** | P1 | Metade direita é um bloco **vermelho chapado, vazio**: não parece "área de foto", parece tela inacabada. Linha vertical branca fina colada na divisão. A linha decorativa vermelha some no fundo vinho (o revisor acusou). "AMANDA COELHO" em texto minúsculo e espaçado, no lugar do logo (S1). |
| **2** | P2 | Retângulo azul-gelo vazio com borda de 1 px: lê-se como **imagem que não carregou**. A margem esquerda do retângulo não alinha com nenhuma outra margem. |
| **3** | **P0** | **Layout quebrado.** O título "Crescer sem direção cansa" **atravessa a divisão** entre o fundo azul e o creme ("direção" cruza a linha). O bloco vermelho flutua sem alinhamento com o título nem com a caixa vinho do texto, que também flutua. Três elementos em posições aparentemente soltas. |
| **4** | P1 | Numeração "01 02 03" (S2). A primeira linha separadora é colorida e as outras cinzas. Retângulo azul vazio, alto, ocupando um terço do slide. |
| **5** | P2 | Meio slide é um bloco vermelho liso, sem indicação de foto. Tipografia boa, mas o resto é só cor. |
| **6** | **P1** | **Hierarquia invertida.** O título aprovado ("Uma vida extraordinária também é planejada") virou um **rótulo minúsculo em caixa alta (~12 px na tela de 1280)** e o corpo virou a citação grande. A moldura creme ao lado, com borda, parece vazia. |
| **7 Fechamento** | P2 | Uma **aba vermelha solta** pousa na divisão das duas cores, sem função aparente. Metade esquerda azul vazia. Nenhum contato, assinatura ou logo. |

### 4.2 Transversais

| # | Pri. | Achado |
|---|---|---|
| V1 | **P0** | **Fórmula repetida em 6 de 7 slides:** bloco de cor + título + texto. O documento pede "assimetria intencional", "grandes áreas de respiro" e **não repetir** a fórmula "título + subtítulo + foto + logo". O resultado lê-se como **template**, que a memória da Amanda diz evitar. |
| V2 | **P0** | **As áreas de foto não são reconhecíveis como áreas de foto:** blocos lisos em três cores diferentes (vermelho, azul-gelo, creme), ora chapados, ora com borda. Quem olha vê "blocos de cor". Não há moldura, proporção nem pista de que ali entra uma fotografia. |
| V3 | P1 | **Nenhum logo, monograma "A—C" ou assinatura em nenhum slide.** A identidade depende só de cor e fonte. |
| V4 | P1 | **Playfair Display no lugar da Queens**: serifada de alto contraste, mais pesada que a Queens do brandbook; combina com Manrope, não com Aeonik. A "assinatura tipográfica" da marca não aparece (S5). |
| V5 | P1 | Texto pequeno em vários rótulos (rótulo do slide 6, "AMANDA COELHO", numeração): numa tela de 1920 px projetada, ficam difíceis de ler. 🟡 estimado pela imagem, não medido em pixels. |
| V6 | P2 | O primeiro slide e o último usam o mesmo recurso (metade colorida, metade texto) com a ordem invertida, sem uma ideia visual própria de abertura ou de fecho. |

### 4.3 Contra os testes do documento

| Teste | Resultado |
|---|---|
| 1. Slide sem foto: "design completo com área fotográfica planejada" | 🟡 **parcial**: não gerou pessoa, mas a área é um bloco liso e não "planejada" |
| 4. Excesso de texto (conteúdo longo, quantidade fechada) | 🟡 o texto coube em todos, mas **não houve teste de estouro** |
| 5. Continuidade (5 + 5) | não executado |
| Proibições da Amanda (§11.9) | ❌ "logo inventado" (S1) e "numeração técnica visível" (S2) |

---

## 5. Pendências já conhecidas (de antes deste exemplo)

Seguem valendo e **não** foram corrigidas aqui: upload e uso de fonte `.otf/.ttf`; editor com troca de foto no ar (PR #59 aberto); planner força capa e encerramento; checagem só de texto (sem quantidade, logo, cor, margem); a Gabi ainda precisa mandar logo, fontes, paleta e **fotos reais**; PRs #58, #59, #61, #62, #63, #64 e #65 **não estão no ar**.

---

## 6. Como reproduzir

1. Código: `main` + PRs #58, #59 e #61 (ou tudo mergeado).
2. Variável no backend: `DESIGNER_BRAIN_BRANDS=amanda-coelho`.
3. Marca `amanda-coelho` com a memória do §11.10 em "Instruções do agente".
4. Pipeline direto com o texto da seção 1 como `sourceCopy` e o briefing: *"Apresentação de 7 slides com o texto aprovado fornecido, na ordem, um bloco por slide. Nenhuma foto foi fornecida ainda: reserve a área da foto onde fizer sentido."*

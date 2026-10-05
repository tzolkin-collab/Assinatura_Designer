# Checklist — Cérebro de IA do Designer

> **Origem:** documento "CÉREBRO DE IA DO SISTEMA DESIGNER" (Gabriela, 04/10/2026) cruzado com
> `docs/ROADMAP.md`, `docs/PLANO-CONSOLIDACAO.md` e `docs/ACABAMENTOS-DESIGNER.md`
> (este último só existe na branch `docs/acabamentos-designer`).
> **Levantado em:** 2026-10-05
> **Estado (05/10):** cérebro ainda não implementado. As 4 branches pendentes do plano antigo já estão no `main`
> (seção D). Este arquivo é o plano de trabalho a validar.
> **Convenção:** ☐ pendente · ◐ parcial (módulo pronto e testado, ainda não ligado à geração) · ☑ feito · 🟡 HIPÓTESE (não verificado) · ❓ depende de decisão

---

## Resumo da arquitetura a implementar

O prompt de cada geração é montado em **camadas isoladas**, na ordem abaixo. Regras fixas não se repetem
nos projetos, e a identidade de um projeto nunca contamina outro.

| # | Camada | O que guarda | Muda? |
|---|---|---|---|
| 1 | Cérebro global | Fidelidade, foto real, hierarquia, revisão, formatos | Nunca |
| 2 | Projeto-base | Essência, paleta, tipografia, logo, fotos, proibições | Por projeto |
| 3 | Desdobramento / collab | Só o que muda: contexto, parceiro, protagonismo | Opcional |
| 4 | Criação | Briefing + modo de produção (apresentação, imagem avulsa, e-book A4) | A cada pedido |

- **Ordem de montagem** (o que vai ao modelo): global → projeto-base → collab → modo → regra de foto → ativos → briefing → checklist de revisão.
- **Prioridade em caso de conflito:** texto aprovado > regras globais > projeto-base > collab > modo > ativos > instrução da peça.
- São duas ordens diferentes e não devem ser confundidas.

---

## A. Antes de começar (bloqueios)

| ☐ | Item | Objetivo | Pedido | Quem |
|---|---|---|---|---|
| ☐ | Regra de foto real | Saber se a proibição de foto gerada/stock vale para todos os projetos | Responder se vale também para a Assinatura | Gustavo |
| ☐ | Quem gera a peça ❓ | Decidir entre HTML + Nano Banana só nas imagens, ou Nano Banana gerando o slide inteiro | Escolher (recomendação: manter HTML) | Gustavo / Gabriela |
| ☐ | Ativos da Amanda em arquivo | Ter logo, fontes, paleta e moodboards de verdade | Compartilhar a subpasta Fontes e os arquivos, ou enviar ZIP | Gabriela |
| ☐ | Fotos reais da Amanda | Rodar o Teste 2 | Enviar as fotos | Gabriela |
| ☑ | Branches pendentes | Ter a base limpa antes de construir | Feito em 05/10: 4 branches mergeadas (PRs #53 a #56). Ver seção D | Gustavo |
| ☐ | Checagem final por IA | Cumprir "revisar antes de marcar final" | Aprovar o custo extra de uma 2ª passada de IA | Gustavo |
| ☐ | Status do texto | Separar texto visível de fala, contexto e interno | Confirmar que o usuário marca o status bloco a bloco | Gustavo |
| ☐ | Quais são as 5 alterações pendentes | A ata de 02/10 cita ~15 alterações, ~10 subidas e ~5 faltando | Confirmar se eram as 4 branches da seção D, já mergeadas 🟡 | Gustavo |

---

## B. Entregas do cérebro (§15 do documento)

| ☐ | Item | Objetivo | Pedido |
|---|---|---|---|
| ◐ | Prompt global persistente | Regras fixas que valem para todos os projetos, sem repetir em cada um | Guardar o §3.1 como instrução fixa, separada dos projetos. **Feito:** texto literal em `lib/designerBrain/prompts.ts`, ligado ao planner, ao artista e ao reviewer **atrás do flag por marca** (ver "Como ligar"). **Falta:** edição de slide e ferramentas de edição do chat |
| ☐ | Projeto-base | Cada marca ter sua memória isolada | Campos independentes: plataforma de marca, manual visual, logo, fonte, paleta, fotos, elementos |
| ☐ | Collab / desdobramento | Herdar a base e guardar só o que muda | Tipo (interno/parceria), contexto, logo e manual do parceiro, % de protagonismo |
| ◐ | Seleção de modo | Cada tipo de peça ter regras próprias | Escolher entre apresentação 16:9, imagem avulsa e e-book A4. **Feito:** regras dos 3 modos no módulo. **Falta:** seletor na UI e tipo de post do e-book A4 |
| ◐ | Galeria de fotos reais | A IA só usar foto fornecida | Biblioteca por projeto + anexos por demanda. **Feito:** a biblioteca da marca já é a fonte, e o editor ganhou a aba **Fotos** (colocar, trocar, enquadrar, remover; só foto da biblioteca; cada troca vira versão). **Falta:** biblioteca por projeto (hoje é por marca) e o artista "ver" a foto |
| ◐ | Editor: trocar foto depois | A foto entrar depois sem refazer a arte | **Feito (com o cérebro ligado):** o artista reserva a área como `data-photo-slot`; o editor troca a foto sem IA. Validado com geração real e uma foto de teste. **Falta:** editar texto direto, mover/redimensionar, reordenar slides |
| ◐ | Sem foto, sem pessoa gerada | Nunca fabricar rosto nem stock | Reservar área limpa na arte, sem texto técnico dentro dela. **Feito:** regra §5.1 anexada quando há foto ou área fotográfica. **Feito (só com o flag ligado):** o resolver não gera foto nem busca Unsplash, "regenerar" não faz nada, e o chat deixa de oferecer IA/Remix/Unsplash. Marcas sem o flag seguem como antes |
| ◐ | Status do texto | Texto visível ≠ fala, contexto ou interno | Campo por bloco: aprovado, em revisão, apoio, fala, contexto, interno, não exibir. **Feito:** regra em código (`interno` e `não exibir` nunca chegam ao modelo). **Falta:** campo no briefing e na UI |
| ◐ | Amanda como piloto | Validar o sistema com um projeto completo | Carregar a memória do §11. **Feito:** memória em `seeds/amandaCoelho.ts`. **Falta:** projeto-base no banco, ativos e fotos |
| ◐ | Montagem do prompt | Camadas na ordem certa | global → projeto → collab → modo → foto → ativos → briefing → checklist. **Feito:** `assembleDesignerBrain` (função pura, 21 testes) e chamado no pipeline para marcas com o flag. **Falta:** briefing e ativos entrarem pelo montador (hoje o pipeline os entrega por caminho próprio) |
| ☐ | Revisão antes de "final" | Não entregar peça com erro ou invenção | Checar texto, quantidade, acentos, logo, cores, margens, fotos |
| ☐ | Galeria de projetos | Trocar "galeria de marcas" por projetos | Nova home e página interna do projeto, conforme os mockups do documento |

**Observação sobre os mockups:** os dados mostrados neles (92% configurado, 38 fotos, Belong, Governo de Minas)
são ilustrativos e não são requisito. Usar só o layout.

---

## C. Testes obrigatórios (§14 do documento)

O cérebro só é considerado pronto depois de passar nos 8 testes, antes de replicar para outros projetos.

| ☐ | Teste | Objetivo | Como executar |
|---|---|---|---|
| ☐ | 1. Slide sem foto | Provar que não gera pessoa | Texto + identidade Amanda, sem foto. Esperado: área fotográfica planejada |
| ☐ | 2. Slide com foto real | Preservar traços da pessoa | Enviar foto da Amanda. Esperado: usa a foto real |
| ☐ | 3. Texto de contexto | Fala não vira texto na arte | Fala separada do texto visível. Esperado: não aparece |
| ☐ | 4. Excesso de texto | Não cortar nem criar slide por conta própria | Conteúdo longo em quantidade fechada. Esperado: sinaliza a limitação |
| ☐ | 5. Continuidade | Lote 2 continuar o lote 1 | Gerar 5 slides e depois mais 5. Esperado: sem nova capa |
| ☐ | 6. Identidade isolada | Nada da Amanda vazar | Trocar de projeto. Esperado: nenhuma cor ou fonte dela permanece |
| ☐ | 7. E-book A4 | Parecer publicação, não slide esticado | Mesmo conteúdo em A4 |
| ☐ | 8. Collab | Herdar sem contaminar | Criar collab da Amanda com protagonismo e sair dele |

---

## D. Herdado do plano antigo

Origem: `docs/ACABAMENTOS-DESIGNER.md` (21/09) e `docs/PLANO-CONSOLIDACAO.md` (20/07).

### Branches com trabalho pronto

> **05/10:** as 4 primeiras foram revisadas em integração (backend `tsc` limpo + 725 testes; frontend `tsc` limpo + 128 testes;
> sem conflito, sem migration) e mergeadas no `main` (`e519e33`). A validação foi por testes e compilação, **não** por geração
> real nem com o app rodando.

| ☐ | Branch | Objetivo | Estado |
|---|---|---|---|
| ☑ | `fix/svg-sanitizacao` | Fechar o XSS por SVG | Mergeada, PR #53 |
| ☑ | `fix/brandbook-ingestao` | Ingestão sem prompt preso à Assinatura | Mergeada, PR #54 |
| ☑ | `feat/orientacoes-tempo-real` | Orientações e "Pausar e enviar" no chat (substitui `/btw`) | Mergeada, PR #55 |
| ☑ | `feat/custo-por-deck` | Custo estimado por deck | Mergeada, PR #56 |
| ☐ | `docs/acabamentos-designer` | Trazer o plano de 21/09 para o `main` | Só existe na branch, sem PR. Mergear (só documentação) |
| ☐ | PR #50 (Jules) — extrair modais de `BrandGaleriaPage` | Refatoração da página de galeria | Aberto. Mexe em `galeria/page.tsx`, que a "Galeria de projetos" vai reformular: decidir antes de construir |

**Ainda não verificado em ambiente vivo (precisa de alguém exercitando o app):**

| ☐ | Item | Como verificar |
|---|---|---|
| ☐ | Upload de SVG sanitizado | Enviar um SVG com `<script>` e conferir que o arquivo gravado vem limpo |
| ☐ | Ingestão de brandbook | Rodar com os 2 PDFs reais da Assinatura (`backend/scripts/testBrandbookExtraction.ts`) |
| ☐ | Orientações e Pausar | Enviar uma orientação no meio de um deck de 30 slides e ver o lote em que ela entrou |
| ☐ | Chip de custo | Gerar um deck e comparar o custo estimado com o uso real |

### Ajustes no código atual que conflitam com o cérebro

| ☐ | Item | Objetivo | Pedido |
|---|---|---|---|
| ◐ | Remover geração de pessoa e stock | Alinhar à regra de foto real | Bloqueado nas marcas com o flag (seção D.1). Nas demais o `imageResolver` ainda gera foto, usa Unsplash e "Remix IA": só mudam se a regra passar a valer para todos |
| ☐ | Planner pedindo imagem de pessoa | Não pedir o que não pode ser gerado | `imageHint` inclui "pessoa, equipe, depoimento" |
| ☐ | Checklist pré-geração do chat | Não perguntar "IA / Remix / Unsplash" | Substituir pelos templates de briefing do §12 |
| ☐ | Upload de fonte `.otf/.ttf` | Usar Queens e Aeonik de verdade | Hoje só entram Google Fonts. Já estava no plano de 21/09 |
| ☐ | Gravação da memória pelo chat | Impedir que o bot altere o projeto sem pedir | `updateBrandMemory` grava "sem pedir permissão"; exigir aprovação |
| ☐ | Slides de fallback silenciosos | Não entregar deck "pronto" com slide genérico | Avisar e sinalizar em vez de preencher o lote |
| ☐ | Revisão ver todo o deck | Checar quantidade, texto e acentos, não só uma amostra | O reviewer visual amostra ~8 slides |

---

## D.1 Como ligar o cérebro para um caso específico

O cérebro é opt-in por marca. **Padrão: desligado em todas**, e a geração segue exatamente como antes.

1. Defina a variável de ambiente no backend (e no worker): `DESIGNER_BRAIN_BRANDS=amanda-coelho` (slugs separados por vírgula).
2. A marca precisa existir com esse slug, com **cores e fontes** cadastradas (elas continuam vindo da configuração da marca, inclusive o carregamento de fonte).
3. A memória do projeto vem de **"Instruções do agente"** da marca. Se estiver vazia, usa o seed do repositório (`seeds/index.ts`, hoje só `amanda-coelho`). Sem nenhuma das duas, a geração **falha com mensagem clara**, em vez de seguir com as regras erradas.
4. Para desligar: tirar o slug da lista.

**O que muda quando ligado:** o artista, o planner e o reviewer recebem global + memória + modo + regra de foto + revisão no lugar das diretrizes legadas; o resolver não gera foto nem usa Unsplash; o chat não oferece IA/Remix/Unsplash; o que o chat "aprendeu" não reescreve a memória.

**Ainda NÃO coberto quando ligado:**
- editar um slide depois de gerado (`editHtmlSlide` e a ferramenta de edição do chat) usa o contexto legado;
- carrossel usa o modo "imagem avulsa" (o documento não define modo de carrossel);
- e-book A4 não existe como tipo de peça;
- status do texto por bloco ainda não tem campo no briefing (hoje o texto vem do briefing como antes);
- nada disso foi exercitado com geração real, só com testes automatizados.

---

## E. Fora desta etapa

Segundo a ata de 02/10 ("foco em ajuste funcional, sem desenvolvimento novo desconectado") e o §15 do documento
("não é necessário cadastrar todos os projetos agora"):

- Cadastrar Assinatura, RUBRICA e outros projetos (a mesma ficha serve depois).
- Integração com Adobe e servidor MCP.
- Quotas, equipe de workers e camadas de asset.
- Automação da planilha de links.

---

## F. Ordem proposta

1. Resolver os bloqueios da seção A.
2. ~~Revisar e mergear as branches da seção D, começando pelo SVG.~~ Feito em 05/10. Falta decidir o PR #50 e trazer o plano de 21/09.
3. Modelar projeto-base e collab sobre o que o plano de 21/09 já desenhou, sem criar modelo paralelo.
4. Implementar o prompt global e a montagem em camadas (seção B).
5. Carregar a Amanda e rodar os 8 testes (seção C).
6. Só então replicar a estrutura para os outros projetos.

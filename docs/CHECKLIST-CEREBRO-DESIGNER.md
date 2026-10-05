# Checklist — Cérebro de IA do Designer

> **Origem:** documento "CÉREBRO DE IA DO SISTEMA DESIGNER" (Gabriela, 04/10/2026) cruzado com
> `docs/ROADMAP.md`, `docs/PLANO-CONSOLIDACAO.md` e `docs/ACABAMENTOS-DESIGNER.md`
> (este último só existe na branch `docs/acabamentos-designer`).
> **Levantado em:** 2026-10-05
> **Estado:** nenhuma implementação iniciada. Este arquivo é o plano de trabalho a validar.
> **Convenção:** ☐ pendente · ☑ feito · 🟡 HIPÓTESE (não verificado) · ❓ depende de decisão

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
| ☐ | Branches pendentes | Ter a base limpa antes de construir | Autorizar o merge das 4 branches após revisão | Gustavo |
| ☐ | Checagem final por IA | Cumprir "revisar antes de marcar final" | Aprovar o custo extra de uma 2ª passada de IA | Gustavo |
| ☐ | Status do texto | Separar texto visível de fala, contexto e interno | Confirmar que o usuário marca o status bloco a bloco | Gustavo |
| ☐ | Quais são as 5 alterações pendentes | A ata de 02/10 cita ~15 alterações, ~10 subidas e ~5 faltando | Confirmar se são as 4 branches da seção D 🟡 | Gustavo |

---

## B. Entregas do cérebro (§15 do documento)

| ☐ | Item | Objetivo | Pedido |
|---|---|---|---|
| ☐ | Prompt global persistente | Regras fixas que valem para todos os projetos, sem repetir em cada um | Guardar o §3.1 como instrução fixa, separada dos projetos |
| ☐ | Projeto-base | Cada marca ter sua memória isolada | Campos independentes: plataforma de marca, manual visual, logo, fonte, paleta, fotos, elementos |
| ☐ | Collab / desdobramento | Herdar a base e guardar só o que muda | Tipo (interno/parceria), contexto, logo e manual do parceiro, % de protagonismo |
| ☐ | Seleção de modo | Cada tipo de peça ter regras próprias | Escolher entre apresentação 16:9, imagem avulsa e e-book A4 |
| ☐ | Galeria de fotos reais | A IA só usar foto fornecida | Biblioteca por projeto + anexos por demanda |
| ☐ | Sem foto, sem pessoa gerada | Nunca fabricar rosto nem stock | Reservar área limpa na arte, sem texto técnico dentro dela |
| ☐ | Status do texto | Texto visível ≠ fala, contexto ou interno | Campo por bloco: aprovado, em revisão, apoio, fala, contexto, interno, não exibir |
| ☐ | Amanda como piloto | Validar o sistema com um projeto completo | Carregar a memória do §11 (essência, paleta, tipografia, proibições) |
| ☐ | Montagem do prompt | Camadas na ordem certa | global → projeto → collab → modo → foto → ativos → briefing → checklist |
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

### Branches com trabalho pronto e não mergeado

> Comparação feita contra o `main` local (`d7ab464`, 25/08). Conferir também o remoto.

| ☐ | Branch | Objetivo | Pedido |
|---|---|---|---|
| ☐ | `fix/svg-sanitizacao` | Fechar o XSS por SVG | Revisar e mergear primeiro: projetos novos recebem logos e arquivos |
| ☐ | `fix/brandbook-ingestao` | Ingestão sem prompt preso à Assinatura | Revisar e mergear |
| ☐ | `feat/orientacoes-tempo-real` | Orientações e "Pausar e enviar" no chat (substitui `/btw`) | Revisar e mergear |
| ☐ | `feat/custo-por-deck` | Custo estimado por deck | Revisar e mergear |
| ☐ | `docs/acabamentos-designer` | Trazer o plano de 21/09 para o `main` | Mergear (só documentação) |

### Ajustes no código atual que conflitam com o cérebro

| ☐ | Item | Objetivo | Pedido |
|---|---|---|---|
| ☐ | Remover geração de pessoa e stock | Alinhar à regra de foto real | `imageResolver` hoje gera foto de pessoa, usa Unsplash e "Remix IA". Depende da seção A |
| ☐ | Planner pedindo imagem de pessoa | Não pedir o que não pode ser gerado | `imageHint` inclui "pessoa, equipe, depoimento" |
| ☐ | Checklist pré-geração do chat | Não perguntar "IA / Remix / Unsplash" | Substituir pelos templates de briefing do §12 |
| ☐ | Upload de fonte `.otf/.ttf` | Usar Queens e Aeonik de verdade | Hoje só entram Google Fonts. Já estava no plano de 21/09 |
| ☐ | Gravação da memória pelo chat | Impedir que o bot altere o projeto sem pedir | `updateBrandMemory` grava "sem pedir permissão"; exigir aprovação |
| ☐ | Slides de fallback silenciosos | Não entregar deck "pronto" com slide genérico | Avisar e sinalizar em vez de preencher o lote |
| ☐ | Revisão ver todo o deck | Checar quantidade, texto e acentos, não só uma amostra | O reviewer visual amostra ~8 slides |

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
2. Revisar e mergear as branches da seção D, começando pelo SVG.
3. Modelar projeto-base e collab sobre o que o plano de 21/09 já desenhou, sem criar modelo paralelo.
4. Implementar o prompt global e a montagem em camadas (seção B).
5. Carregar a Amanda e rodar os 8 testes (seção C).
6. Só então replicar a estrutura para os outros projetos.

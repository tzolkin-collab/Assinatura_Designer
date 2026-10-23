# P03: Avisos de conflito, de texto que não cabe e pendência objetiva

**Camada A (Gabi).** Antes de tudo, leia `docs/aceite/README.md` e siga as regras da seção 3.
**Depende de:** #124 mergeado (toca o pipeline e `pipeline.ts`: roda **sozinho**, sem outro pacote em paralelo).

## Objetivo
Implementar três comportamentos do documento da Gabi que hoje não existem:
1. **Conflito entre versões do texto** (§2): "não escolher silenciosamente; marcar o conflito e impedir que seja chamado de final".
2. **Texto que não cabe** (Teste 4, excesso de texto): preservar o texto, não criar slide extra **e avisar a limitação**.
3. **Critério não atendido vira "pendência objetiva"** (§13 passo 8), em vez de a peça ser dada como pronta.

## Contexto
- Teste 4 hoje: parcial. Texto preservado, sem slide extra, **sem aviso**.
- Status do texto é **campo do briefing**, não marca no texto. O painel "Briefing da peça" (PR #119, em `main`) produz as marcas `[APROVADO]`, `[FALA]`/`[APOIO]`, `[CONTEXTO]`, `[INTERNO]` que o backend lê em `copyBlocks.ts` e `textStatus.ts`. Mantenha parser e testes.
- Havia uma trava de rascunho no MCP (PR #118): `export_file` e `export_to_canva` não exportam rascunho. Reaproveite o conceito, não duplique.
- O revisor é do mesmo modelo que gera; nota alta dele não é validação da Gabi.
- 🟡 Não localizei onde hoje se detecta "conflito". Comece procurando (`grep` por `conflito`, `versão`, `final`) antes de projetar.

## Passos
1. Mapeie, por leitura, onde nasce o estado de uma peça (rascunho/final), onde o texto é medido e onde o revisor produz critérios. Liste arquivos reais encontrados.
2. Desenhe o mínimo: como o conflito é detectado (duas versões do mesmo bloco aprovado), onde o aviso aparece (Fábrica/editor) e o que impede o "final".
3. Implemente com testes primeiro nos casos: duas versões divergentes; texto acima do limite; critério reprovado que vira pendência listada.
4. Mostre na tela (API de mentira ou backend local isolado). Sem geração paga sem autorização.

## Aceite
- [ ] Conflito marcado e peça **não** pode ser tratada como final enquanto houver conflito.
- [ ] Texto longo gera aviso visível com o motivo, sem cortar nem inventar texto.
- [ ] Pendências objetivas listadas por critério, não só uma nota.
- [ ] Testes novos e suíte existente verdes; `tsc` limpo; tela conferida.

## Não fazer
Não escolher versão silenciosamente. Não reescrever copy. Não mudar o formato persistido sem decisão. Se o desenho exigir migration, **pare e pergunte**.

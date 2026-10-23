# P05: Seletor de modo, "Nova imagem" e e-book A4 (ADIADO para 02/11: não executar)

**Status: adiado em 19/10 por decisão do Gustavo.** Leia `docs/aceite/README.md`.

## Por que está parado
Direção de 19/10: **não adicionar features; corrigir e finalizar o que existe.** Esta tarefa é feature nova: o e-book A4 exige formato de peça, tela e renderizador novos, e **gera custo adicional**. Combinado de 06/10 com a Gabi: **comunicar qualquer demanda que gere custo adicional** antes de construir.

**Só volta se a Gabi aprovar escopo e custo.** Reabrir depois da homologação (29/10) e da resposta dela ao FUP.

## No Core
Tarefa "[Designer] [Adiado] Seleção de modo e ações 'Nova imagem' / 'Novo e-book A4' no projeto-base" (02/11 a 04/11). A pergunta à Gabi está na tarefa de FUP.

## Estado do código (conferido em 19/10)
Só existem "Nova apresentação" e "Novo collab". O **Teste 7 (E-book A4) não existe** como peça: ele fica "não existe, adiado" no checklist, e isso deve ser dito à Gabi **antes** da homologação, não descoberto nela.

## Defeito relacionado (este sim é correção, ver P07)
O modo **Auto vira Manual sozinho** e a Fábrica pergunta "Qual o destino da peça?" antes de gerar. Reproduzir antes de corrigir.

## Se for reaberto
Reutilizar o pipeline `html-design`, sem motor, formato ou fila novos. Primeiro entregar ao Gustavo uma estimativa de custo e esforço (separando seletor/Nova imagem, que é pequeno, de e-book A4, que é grande), em `docs/aceite/propostas/modos-e-ebook.md`, e **parar** até a aprovação.

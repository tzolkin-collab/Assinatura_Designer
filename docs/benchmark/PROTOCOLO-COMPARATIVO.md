# Protocolo de comparação — Designer × Claude Design × ChatGPT

> Objetivo: dar número a "igualar ou superar o Claude Design e o ChatGPT" (dor 3) e a "custo menor que a assinatura dos concorrentes" (dor 4).
> Sem isso, as duas metas são esperança, não meta. Origem: `docs/ACABAMENTOS-DESIGNER.md` §1.3.
> Status: **protocolo pronto; nenhuma rodada executada.** O lado do Designer tem baseline em `BASELINE-DESIGNER.md` (quando o script de baseline for executado).

## 1. Entradas fixas (as mesmas nas três ferramentas)

| Item | Regra |
|---|---|
| Brandbook | Os dois PDFs reais da Assinatura (`ID Rebranding` e `Plataforma de Marca`), enviados do mesmo jeito em cada ferramenta. Nenhum ajuste manual de cor ou fonte antes da rodada. |
| Fontes | Anotar, em cada ferramenta, se Aileron e Monument Extended puderam ser usadas. Se não, registrar a substituta. É um resultado, não um defeito do teste. |
| Idioma | Português do Brasil. |
| Formato | Apresentação 16:9. |

## 2. Os três briefings

Textos prontos para colar. Não editar entre ferramentas.

**A. Briefing curto (uma frase)**
> Crie uma apresentação comercial de 8 slides apresentando os serviços de consultoria da Assinatura Marca Própria para empreendedores do setor de cosméticos.

**B. Briefing com copy oficial**
> Crie uma apresentação de 10 slides usando exatamente o texto abaixo, um bloco por slide, sem reescrever nem inventar números.
> *(Colar aqui um roteiro real de 10 blocos fornecido pela Gabriela. Usar sempre o mesmo texto.)*

**C. Deck longo**
> Crie uma apresentação de 30 slides sobre o processo completo de criação de uma marca própria de cosméticos, do briefing ao lançamento, com capa, agenda, uma seção por etapa e encerramento.

## 3. O que medir

| Métrica | Como medir | Onde está o dado |
|---|---|---|
| Tempo até o 1º slide | Cronômetro, do envio do briefing até o primeiro slide visível. | Manual. No Designer, também em `GenerationRun`/`GenerationStep`. |
| Tempo até o deck completo | Cronômetro. | Idem. |
| Custo (US$) | **Designer:** `GET /posts/:id/cost` (estimativa por tokens). **Outras:** preço da assinatura ÷ nº de decks que o plano cobre no mês, e anotar o teto de uso. | Ver §5. |
| Fidelidade de marca | Checklist de 8 itens abaixo, 1 ponto cada. | Manual, ver §4. |
| Correções até "aprovável" | Contar pedidos de ajuste até a Gabriela dizer "pode enviar". Teto de 10. | Manual. |
| Editabilidade | Abrir o resultado no PowerPoint e no Canva. O texto é texto? Dá para trocar uma imagem? Dá para mover um bloco? | Manual, 0 a 3. |

## 4. Checklist de fidelidade de marca (0 a 8)

1. O logo aparece e está legível (versão correta para o fundo).
2. O logo não some nem vira um quadrado vazio em nenhum slide.
3. A tipografia é Aileron (texto) e Monument Extended (destaques curtos), ou a substituta declarada.
4. As cores usadas pertencem à paleta oficial de 6 cores.
5. Nenhum par texto/fundo com contraste ruim.
6. O tom de voz bate com a plataforma de marca (personalidade e posicionamento).
7. Ícones e grafismos são os da marca, sem ícone inventado.
8. Nenhuma frase ou número inventado (no briefing B, o texto é exatamente o fornecido).

## 5. Como registrar

Uma linha por combinação (3 briefings × 3 ferramentas = 9 linhas). Modelo em `SCORECARD.csv`.

- **Avaliadores:** Gabriela (uso), Pedro e Matheus (criação). **Às cegas**: quem avalia não sabe qual ferramenta gerou cada deck (exportar tudo em PDF, embaralhar e renomear).
- **Conflito de interesse:** quem operou o Designer não pontua o Designer.
- **Rodadas:** 2 por combinação; usar a mediana (o resultado de IA varia).
- **Custo dos concorrentes:** registrar a fonte e a data do preço consultado; os planos mudam.

## 6. Como ler o resultado

| Resultado | Decisão |
|---|---|
| Designer ≥ os outros em fidelidade **e** editabilidade, custo menor | Meta cumprida. Priorizar o resto do plano. |
| Designer perde em fidelidade | Fases 1 a 3 (Brand Kit, brandbook, assets) antes de qualquer outra coisa. |
| Designer perde em editabilidade | Fase 4 (editor) sobe de prioridade. |
| Designer perde em tempo | Só então abrir a Fase 6 (equipe de workers em paralelo). Antes disso, paralelismo é custo sem prova de ganho. |

## 7. Limitações declaradas

- Três briefings não representam todos os usos; servem para comparar, não para provar superioridade geral.
- Os planos dos concorrentes mudam de preço e de limite; a comparação vale para a data da rodada.
- Avaliação humana tem viés mesmo às cegas (o visual de cada ferramenta costuma denunciá-la).

# P02: Variedade de composição (teste justo)

**Camada A (Gabi).** Antes de tudo, leia `docs/aceite/README.md` e siga as regras da seção 3.
**Bloqueios:** chave Gemini nova e **autorização** (1 deck na conta da Amanda, ~US$ 0,40).

## Objetivo
Descobrir se o Designer chega perto da variedade que a Gabi obtém no ChatGPT quando recebe **os mesmos insumos**, e decidir o que construir.

## Contexto
- Nota atual de variedade: 3 em 10 (avaliação do PO, não da Gabi).
- Medição de 15/10 (mapa de ocupação 16×9, distância média entre pares de slides; métrica grosseira): GPT da Gabi 0,12 a 0,47 por lote (mediana ~0,25); decks da Amanda 0,05 a 0,18; teste 3 (0,47) e Assinatura (0,52) mostram que o artista consegue variar com contexto menos engessado.
- A variedade do GPT vem da **direção de arte por slide escrita no prompt dela**: um arquétipo de composição por imagem, fundo, hierarquia, elemento editorial, regra de não repetir divisão nem posição de título em slides consecutivos, lista de proibições (sem sombra, degradê, círculos, várias caixas, "estética de template"). O Designer recebe só o texto de cada slide.
- O **teste justo ainda não foi feito**. Insumo: `docs/benchmark/lote1-gabriela/` (prompt de ~9,5 mil caracteres; conversa de origem em `chatgpt.com/share/6ac41d50-5488-83e9-84b7-1bc6dd2878ec`).
- Ferramentas: `backend/scripts/aceiteCerebro.ts gpt1`, `renderizarDeck.ts`, `medirVariedade.cjs` (rodar sobre pasta de PNGs `*-slideN.png`).
- O visual chapado que ela pede é o que HTML/CSS faz bem; textura orgânica, ilustração e recorte de pessoa não.

## Passos
1. Peça autorização. Rode `aceiteCerebro.ts gpt1` (1 deck), renderize os slides em PNG e meça com `medirVariedade.cjs`.
2. Compare com a mediana do GPT dela (~0,25) e com a linha de base da Amanda. Diga o que a métrica **não** mede.
3. Decida pelo resultado, sem implementar ainda:
   - variedade **subiu** → falta um campo de **direção de composição por slide** na entrada e no planner;
   - **não subiu** → o limite está no artista e na ficha → propor uma **biblioteca de composições da marca**.
4. Escreva a proposta (escopo, arquivos prováveis em `designerBrain/*`, planner, tela do briefing, custo e riscos) em `docs/aceite/propostas/variedade.md`.

## Aceite
- [ ] Números do antes (Amanda) e do teste justo, com o comando e os arquivos.
- [ ] Conclusão com a hipótese descartada e a escolhida.
- [ ] Proposta com escopo que cabe até 29/10, ou o que fica fora, dito claramente.
- [ ] Deck de teste listado para limpeza.

## Não fazer
Não implementar antes de o Gustavo aprovar a proposta. Não afirmar que a métrica valida estética. Não trocar o motor `html-design`.

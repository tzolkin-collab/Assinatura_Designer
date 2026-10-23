# P10: WP5, retirar System Prompt e Preferências e Regras

**Camada B (ajustes do Gustavo).** Antes de tudo, leia `docs/aceite/README.md` e siga as regras da seção 3.
**Depende de:** #124 mergeado. **Toca `pipeline.ts`:** rode sozinho.

## Objetivo
Executar D1, D2 e D3:
- **D1:** a ficha do Cérebro é a fonte de verdade de cores, fontes e logo. Branding deixa de ter campos próprios para isso.
- **D2:** aposentar o **System Prompt** por marca (copiar uma vez para as notas da ficha).
- **D3:** retirar **Preferências e Regras** (a lista que o chat grava).

## Contexto
- Arquivos que o checklist do PO aponta: `brain/skills.ts`, `memory.ts`, `redis.ts`, tela Agente, `pipeline.ts`.
- O mapeamento de 19/10 (`wf_d763bfff-cd3`, só leitura) concluiu várias coisas **por inferência** (marcadas no relatório). Releia o código antes de confiar.
- **Apagar dados só com backup conferido e aprovação por escrito** (D8). Nada de migration destrutiva aqui: comece desligando o uso, sem apagar linhas.
- Copiar o System Prompt para as notas da ficha é uma ação **por marca em dados reais**: entregue como script que simula por padrão e grava só com `--apply`, e peça autorização.
- Regras globais e cérebro: ver D4 a D6 e D11 em `docs/po/designer-checklist.md`.

## Passos
1. Mapeie, por `git grep`, tudo que lê System Prompt e Preferências/Regras (backend, worker, pipeline, MCP, telas). Liste arquivo:linha.
2. Diga o que muda no comportamento da geração quando isso sai (o que hoje entra no prompt e deixa de entrar). Se a arte puder mudar, **declare** e proponha a medição.
3. Implemente em commits pequenos: (a) para de ler; (b) tira a interface; (c) script de cópia do System Prompt para a ficha (simula por padrão).
4. Testes: o pipeline monta o contexto sem esses dois blocos; nada quebra em marca que ainda tem os dados.

## Aceite
- [ ] Nenhuma tela, menu ou texto oferece System Prompt nem Preferências e Regras.
- [ ] Geração monta contexto só pela ficha e camadas do Cérebro.
- [ ] Nenhuma linha de banco apagada; nenhuma migration destrutiva.
- [ ] Script de cópia com simulação e `--apply`, testado em simulação.
- [ ] Suíte verde, `tsc` limpo, telas conferidas, remoções listadas arquivo a arquivo.

## Não fazer
Não apagar dados. Não rodar o `--apply` sem autorização. Não decidir sozinho o destino do conteúdo que não couber nas notas da ficha: **pergunte**.

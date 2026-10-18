# Handoff: Designer, revisão de produto e próximos passos (17/10/2026)

Para quem continuar (Gustavo, Lucas, Saleco ou outra sessão do Claude Code). Complementa o `HANDOFF-CEREBRO-DA-IA.md` (estado de 15/10). **Onde este documento contradiz aquele, vale este.**

## 1. Em uma frase

O Cérebro da IA tem as 3 primeiras camadas (global, projeto-base, desdobramento). A quarta, a **Criação (briefing da peça)**, só existe como chat livre, e é nela que estão os itens que a Gabriela vai testar. O Designer **ainda não foi validado por ela** e o prazo estimado em 02/10 (segunda ou terça seguinte) já passou.

## 2. O que a Gabriela pediu (fontes primárias)

| Fonte | Onde |
|---|---|
| Documento "CÉREBRO DE IA DO SISTEMA DESIGNER" (04/10) | `C:\Users\gusta\Downloads\CÉREBRO DE IA DO SISTEMA DESIGNER.docx` (fora do repositório). Texto literal de §3.1, §5.1, §6.1, §7 e §9.1 em `backend/src/lib/designerBrain/prompts.ts` |
| Ata da reunião de 02/10 | Drive dela, pasta "IA + ASSINATURA", doc "01. Documento para controle de tarefas gerais" (resumo do Gemini, não as palavras dela) |
| Reunião de 06/10 e pedidos por WhatsApp | Registros do Core (a transcrição não abre pelo Drive) |
| Checklist Operacional preenchido (15/10) | `docs/CHECKLIST OPERACIONAL - preenchido 2026-10-15.docx` (rascunho; o Google Doc dela **não** foi alterado) |

**Pontos que decidem o desenho (e que eu tinha entendido errado antes):**
- **Status do texto é um campo do briefing** (§4 e §15), não uma marca no texto. O template do §12 separa `TEXTO APROVADO POR SLIDE`, `FALA / CONTEXTO NÃO VISÍVEL` e `INFORMAÇÕES INTERNAS OU PROIBIDAS`. O status vem de qual campo o texto ocupa.
- **§2:** em conflito entre versões do texto, "não escolher silenciosamente; marcar o conflito e impedir que seja chamado de final". Não implementado.
- **§13 passo 8:** critério não atendido vira "pendência objetiva".
- **§8 e §3.1 item 3:** variar composição; começar pela função do slide e só depois o layout. A variedade é requisito.
- **§4 (fonte):** "usar fonte oficial quando disponível". O arquivo de fonte **não é bloqueio** (a ata simplificou para fonte em imagem).
- **O que ela quer no dia a dia (WhatsApp):** gerar como faz no ChatGPT e colar no Canva, **trocando fotos, cores, fontes e logo sem regerar**. Só a troca de foto existe no editor.
- **Combinado de 06/10:** "tirar dúvidas direto com a Gabriela antes de presumir" e "comunicar qualquer demanda que gere custo adicional". Teto de **R$ 200/mês** de API.

## 3. Estado (conferido em 17/10)

**Notas por componente (0 a 10, avaliação minha, não da Gabriela):** ficha 8,5 · regras globais 8 · montagem em camadas 7,5 · foto real 7,5 · editor de fotos 8 · fonte própria 8 · desdobramento 6 · status do texto 4 · revisão antes de "final" 5 · galeria/home 5,5 · seleção de modo 3 · e-book A4 1 · variedade 3 · briefing por modo 2 · avisos de conflito 2 · 8 testes 4. **Geral: cerca de 5.**

**Os 8 testes (15/10):** passaram 1, 3 e 6; parciais 4 (sem aviso) e 8 (só automatizado); não rodados 2 e 5; o 7 não existe.

**PRs (GitHub, conferidos em 17/10):**
- **Mergeados em 15/10:** a pilha inteira #74 a #91 (ficha, visão geral, Cérebro, importação de manual, pipeline lê a ficha, desdobramento, Amanda como ficha, enquadramento, foto real no chat, ativos, fonte própria, redesign #88, Fábrica #89, vários pesos #90, consolidação #91) e depois #92 a #108 (MCP, ajustes, mobile, código morto).
- **Abertos:** #109 (layout desktop), #110 (leitura sem requestAnimationFrame), #111 (lista leve da galeria), **#112 a #114 (MCP lotes 1A a 1C)** e **#115 (botão de status do texto na Fábrica)**. #114 e #115 estão mergeáveis, com o Vercel passando e sem revisão.
- **Ordem de merge do MCP:** #112, #113, #114. O #115 é independente.
- **Auto-fix está ligado no #115.**

**Dados de banco** (ficha da Amanda a 71%, 0 fotos reais, 16 arquivos de fonte) vêm do checklist e do handoff de 15/10. **Não reconsultei o banco em 17/10.**

## 4. Onde está o plano (Tzolkin Core)

Tenant "Assinatura Marca Própria": `7d5f75ba-5dd0-4136-a30c-c9c3372c346e`. Contratação "Designer": `7b59ff31-1f30-4227-ab58-16ee612c342c`. Convenção: título com prefixo `[Designer]`, descrição em Markdown, horários em -03:00.

**Criado em 17/10 (todos com critério de aceite):**
- Registros concluídos: "Revisão de produto (17/10)…" (com as notas) e "MCP lote 1C fechado + status do texto (PRs #114 e #115)".
- Tarefas, com prazo **sugerido** (ajustar): decisão de escopo do MCP × contrato (18 a 19/10); FUP Gabriela, perguntas de produto (18 a 20/10); fotos reais e Teste 2 (19 a 20/10); formulário de briefing "Apresentação" (19 a 21/10); variedade de composição (19 a 21/10); avisos de conflito e de texto que não cabe (20 a 22/10); seletor de modo e ações "Nova imagem" / "Novo e-book A4" (21 a 23/10).

**Atualizado em 17/10:** "Fechar as ~5 alterações" (agora só aguarda a confirmação dela), "Galeria de projetos", "Fluxo de desdobramento e collab", "FUP: fotos reais" (renomeada), "8 testes" (agora com o estado de 15/10). **Fechadas como concluídas:** "Cérebro global, modos e regra de foto real", "Sanitização de SVG e avisos de fontes" e "Carregar o projeto-piloto Amanda" (o que sobrou foi movido para tarefas próprias).

**Não verificado e não alterado:** "Acessos por workspace e perfil admin" e "Ajustar interface de preview e exportação de slides" (ambas vencidas em 16/10).

## 5. Próximos passos, em ordem

1. **Decidir o escopo do MCP** (tarefa de decisão). A ata de 02/10 diz "ajuste funcional, sem desenvolvimento novo desconectado" e o checklist lista o servidor MCP como **fora da etapa**. A integração ChatGPT/Designer aparece como futura (P3). Antes de abrir os lotes 2 a 4 (32 de 52 ferramentas), comunicar à Gabriela se houver custo adicional.
2. **Mandar à Gabriela a mensagem de FUP** (rascunho aprovado só em texto, **não enviado**): briefing no chat ou em tela separada; o que trocar sem regerar; imagem avulsa e e-book A4 nesta etapa; usar as 8 fotos do álbum de 05/10; o projeto-exemplo e o doc "regras gerais para outras IDs".
3. **Fotos reais e Teste 2:** abrir cada JPEG (`WhatsApp Image 2026-10-05 at 19.03.*.jpeg`, na pasta do projeto) antes de subir; `scripts/loadAmandaPhotos.ts` simula por padrão e `--apply` grava no banco e no R2 compartilhados; depois `scripts/teste2FotoReal.ts`. **Precisa de autorização para gravar.**
4. **Variedade:** rodar `backend/scripts/aceiteCerebro.ts gpt1` (lote 1 dela em `docs/benchmark/lote1-gabriela/`) e medir com `medirVariedade.cjs`. **Grava 1 deck na conta da Amanda e custa ~US$ 0,40: pedir autorização**; apagar depois só com autorização.
5. **Formulário de briefing "Apresentação"** (§12.1), que **gera as mesmas marcas** `[APROVADO]`, `[FALA]`, `[CONTEXTO]`, `[INTERNO]` que o backend já lê. Isso mantém o parser e os testes (`copyBlocks.ts`, `textStatus.ts`). O botão do #115 fica como atalho.
6. **Avisos** de conflito de versões e de texto que não cabe; depois **seletor de modo** e as ações que faltam. O e-book A4 precisa de formato de peça, tela e renderizador novos: é custo adicional, decidir antes.
7. Verificar o que ficou sem checagem (seção 7) e preencher o Checklist Operacional com evidência e versão.

## 6. O que fiz em 17/10 (resumo)

- **MCP #114:** tela de consentimento oferece o escopo `designer.export` (quadro "Exportar", desmarcado por padrão), docs atualizados, guardas provados por quebra intencional (4 de 4). Frontend 218 testes, backend 407, `tsc` limpo.
- **#115:** botão "Status do texto" na Fábrica. Frontend 228 testes. Visto só em celular, com API de mentira, **sem tocar no banco real**.
- **Revisão de produto** contra o documento original, com correção de três coisas que eu tinha dito errado: o status é campo (não marca), o redesign #88 foi prometido a ela em 07/10, e o arquivo de fonte não é bloqueio.
- **Core organizado** (seção 4) e **memória** da sessão salva (onde estão os pedidos dela e a orientação de estudar a fonte primária antes de propor).

## 7. Não verificado (não presuma que funciona)

- Tela de consentimento do #114 no navegador.
- Botão do #115 em desktop; envio real à IA com marcas (só os testes do parser).
- **Troca de cor, fonte e logo sem regerar**, **privacidade por projeto** ("privados por padrão"; a página `/projetos` diz que todos têm acesso a todos os projetos da equipe) e **acessos por workspace** (Saulo master financeiro; erro de acesso da Gabriela em 02/10).
- Upload de SVG com `<script>`, ingestão de brandbook, orientações no meio do deck e chip de custo em ambiente vivo.
- Regras globais na edição de slide e nas ferramentas do chat (podem ainda usar o contexto antigo).

## 8. Como rodar sem tocar nos dados reais

- **Frontend com API de mentira:** `NEXT_PUBLIC_API_URL=http://localhost:4010/api pnpm exec next dev -p 3100` (em `frontend/`) e um servidor Node mínimo na 4010 que responde `{data: ...}`: `GET /api/brands/:slug` com `myRole: 'OWNER'`, `POST /api/fabrica/sessions`, `GET .../ai-usage` com `cost`, `taxRate`, `models`. Login falso: `localStorage.auth_token` e cookie `auth_token` quaisquer. Sem o WebSocket, a Fábrica fica "Reconectando", mas o campo de mensagem funciona.
- **Backend local:** use `designer-backend-local` (porta 4000, fila isolada `BULLMQ_PREFIX=dev-local`). **Nunca** `designer-backend`: ele usa o prefixo de produção e o worker consumiria jobs de outros usuários. O banco e o Redis continuam sendo os reais.
- **Testes:** `cd backend && pnpm exec vitest run` e `cd frontend && pnpm exec vitest run`, mais `pnpm exec tsc --noEmit` em cada um.

## 9. Armadilhas

- **A pasta mudou:** de `Projeto Assinatura` para `projeto-assinatura` (o repositório está em `designer/`). Caminhos antigos em handoffs não funcionam.
- **Porta 3100** pode estar ocupada por outro app seu (`apps/web/server.mjs`). Não encerre.
- Na tela de consentimento do MCP, `describeAccess` mostra "· pode exportar"; escopo desconhecido é recusado (400).
- O **Core cria atividades como "planejado"**: registros de fatos já ocorridos precisam de `status: done`. `listar_atividades` devolve arquivo grande; resuma com script.
- **Nada foi mergeado nem enviado à Gabriela por mim.** O classificador de permissões bloqueia `gh pr merge` sem revisão: só com autorização explícita.
- Credenciais: a **troca das senhas das contas do seed e o redeploy do backend depois dos merges do MCP** são uma pendência registrada com o Gustavo em 16/10. **Não sei se já foi feita**; confirmar antes de assumir.
- Arquivo solto local: `handoff.md` na raiz (proposta de Design em lote de 06/10, anterior a tudo isto), não commitado.

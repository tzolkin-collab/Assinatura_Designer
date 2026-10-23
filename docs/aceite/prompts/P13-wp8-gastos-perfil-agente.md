# P13: Telas globais: Gastos, Perfil e Agente IA (decidir antes de construir)

**Ajuste do Gustavo, com um pedaço ligado à Gabi** (o teto de R$ 200/mês de API foi combinado com ela em 06/10).
Antes de tudo, leia `docs/aceite/README.md`. **Depende de:** #122 mergeado. Arquivos: `configuracoes/*`, `routes/settings.ts`.

Três tarefas no Core, todas `[Worker]`: "Gastos de IA Globais", "Agente IA Geral" e "Meu Perfil". **Cada uma já tem um escopo mínimo (corrigir o que existe) e um ampliado (feature).** A regra de 19/10 manda ficar no mínimo, salvo decisão do Gustavo.

## Gastos de IA Globais
- **Mínimo (fazer):** corrigir "U$" para "US$"; formatar o mês ("outubro de 2026"); mostrar a parcela de imposto **ou** tirar a frase que diz que ela está destacada; ajustar a descrição para "por modelo".
- **Ampliado (só se o Gustavo aprovar, é feature nova e a Gabi deve ser avisada do custo):** quebra por marca; barra "usado do mês × R$ 200" com aviso em 80% e 100%.
- Por que importa: os tetos que existem no código são em **tokens por dia** (20 mi global, 5 mi por marca), não em R$/mês. A tela **não mostra o teto contratado**.
- **Mostrar o gasto por modelo** já ajuda a identificar um modelo inesperado (houve gasto de R$ 200 em 18-19/10 com `gemini-4-argon`, que nada no código usa). Não tente explicar o incidente aqui.
- O app registra tokens do `usageMetadata` e **estima** o custo pela tabela de preços do Designer. **É estimativa, não fatura da Google**; a tela deve dizer isso.

## Agente IA Geral
- Trocar "Configure" por "Consulte" (a tela é só leitura: modelos e tetos vêm de variáveis de ambiente).
- Remover "(Gemini 2.0)" e a nota sobre "loop infinito do Chromium" sem relação com a tela. Indicar de onde vem cada valor.
- **Fora do escopo:** editar modelos e tetos pela tela.

## Meu Perfil (é segurança: priorizar)
- Exigir a **senha atual** (ou avisar quando a conta é só Google) e campo de confirmação.
- **A API deve recusar senha curta com erro 400** (hoje salva o nome e ignora a senha, respondendo "sucesso").
- Mostrar o papel e o estado das conexões, em leitura.
- Decidir sobre invalidar o token no "Sair" (custo médio; pode ficar para depois).

## Passos
1. Leia a tela e a rota de cada uma e confirme o achado de 19/10 (foi feito **por leitura de código**, tela não validada no navegador).
2. Implemente só o mínimo, em commits pequenos, com teste que falha antes e passa depois (senha curta na API, por exemplo).
3. Verifique na tela com usuário administrador; para o Perfil, com um usuário de e-mail/senha e outro de Google.

## Aceite
- [ ] Nenhum texto promete o que a tela não faz.
- [ ] Senha curta pela API devolve erro (teste automatizado); trocar a senha sem a atual falha.
- [ ] Suíte verde, `tsc` limpo, telas conferidas.
- [ ] **Se o Gustavo aprovar o ampliado**, o teto visível e o alerta, com a Gabi avisada.

## Não fazer
Não bloquear geração ao atingir o teto sem decisão. Não expor chaves nem valores de `.env`. Não construir o ampliado sem aprovação.

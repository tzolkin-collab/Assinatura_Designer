# Migrations — banco COMPARTILHADO ⚠️

Este backend usa o PostgreSQL `assinatura_designer` (easypanel.landcriativa.com:9000),
que é **compartilhado** com outro app: `Projetos/Outros/Gabriela-apresentação` (funil
de diagnóstico Next.js).

Esse outro app é dono de duas tabelas que **NÃO** estão (e não devem estar) no
`schema.prisma` deste projeto:

| Tabela | Dono | Conteúdo |
|---|---|---|
| `diagnostic_responses` | Gabriela-apresentação (`src/lib/db.ts`) | respostas do quiz/diagnóstico |
| `data_deletion_requests` | Gabriela-apresentação (LGPD) | solicitações de exclusão de dados |

## 🚫 NUNCA rode `prisma db push` neste projeto

`db push` faz sync declarativo: ele tenta deixar o banco idêntico ao `schema.prisma`
e **dropa qualquer tabela que não esteja no schema** — ou seja, apagaria as tabelas
da Gabriela (e os dados reais delas). Já aconteceu de ser barrado por isso.

## ✅ Workflow seguro

O projeto está baselined em `migrations/0_init` (estado atual marcado como aplicado).

- **Aplicar migrations pendentes:** `npm run db:migrate` (`prisma migrate deploy`).
  `migrate deploy` só roda os arquivos de migration — nunca dropa tabelas fora deles,
  nunca reseta o banco, nunca detecta "drift".
- **Ver estado:** `npm run db:status`.
- **Regerar o client:** `npm run db:generate`.

## Como criar uma nova migration (sem `migrate dev`)

`prisma migrate dev` faz detecção de drift e, por causa das tabelas da Gabriela,
vai querer **resetar o banco**. Não use. Em vez disso:

1. Edite o `schema.prisma`.
2. Gere o SQL diffando o histórico de migrations (NÃO o banco) contra o schema,
   usando um shadow database descartável (qualquer Postgres vazio):
   ```
   npx prisma migrate diff \
     --from-migrations ./prisma/migrations \
     --to-schema-datamodel ./prisma/schema.prisma \
     --shadow-database-url "postgresql://.../shadow_vazio" \
     --script > prisma/migrations/<timestamp>_<nome>/migration.sql
   ```
   (diffar pelo histórico, e não por `--from-url DATABASE_URL`, garante que as tabelas
   da Gabriela nunca apareçam num `DROP`.)
3. Aplique com `npm run db:migrate`.

### Alternativa para mudanças pequenas (ex: adicionar valor de enum)

Para um ALTER pontual, dá pra aplicar SQL direto sem migration formal:
```
npx prisma db execute --schema prisma/schema.prisma --file alteracao.sql
```
Foi assim que `PRESENTATION` foi adicionado ao enum `PostType`. Depois é só refletir
a mudança no `schema.prisma` e rodar `npm run db:generate`.

## Longo prazo

Separar de vez: dar ao app da Gabriela um banco próprio, ou mover as tabelas dele
para um schema Postgres dedicado (ex: `gabriela.diagnostic_responses`) com `multiSchema`,
deixando o Prisma deste projeto só no `public`.

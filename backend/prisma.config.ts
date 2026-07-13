import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  earlyAccess: true,
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL,
    // Só usado por comandos de desenvolvimento (migrate dev/diff --from-migrations).
    // Precisa apontar para um database DESCARTÁVEL: o Prisma reseta este banco.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});

// Gera o hash bcrypt da senha do login rootSystem para colocar no .env (ROOT_ADMIN_PASSWORD_HASH).
// A senha vem da variável ROOT_ADMIN_PASSWORD (não vai para o histórico do shell nem para o código):
//   ROOT_ADMIN_PASSWORD='...' pnpm exec tsx scripts/hashRootAdminPassword.ts
import bcrypt from 'bcrypt';

const password = process.env.ROOT_ADMIN_PASSWORD;
if (!password || password.length < 12) {
  console.error('Defina ROOT_ADMIN_PASSWORD com pelo menos 12 caracteres.');
  process.exit(1);
}
// Aspas simples: o hash tem "$" e o dotenv expandiria sem elas.
void bcrypt.hash(password, 12).then((hash) => {
  console.log(`ROOT_ADMIN_PASSWORD_HASH='${hash}'`);
});

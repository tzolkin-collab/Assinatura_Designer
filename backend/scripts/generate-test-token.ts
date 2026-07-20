import '../src/config';
import jwt from 'jsonwebtoken';
import { config } from '../src/config';

const userId = process.argv[2];
const role = process.argv[3] || 'ADMIN';

if (!userId) {
  console.error('Uso: npx tsx scripts/generate-test-token.ts <userId> [role]');
  process.exit(1);
}

const token = jwt.sign({ userId, role }, config.jwtSecret, { expiresIn: '7d' });
console.log(token);

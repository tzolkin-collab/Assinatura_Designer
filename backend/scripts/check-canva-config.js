// Script de diagnóstico rápido para configuração do Canva.
// Rode: node scripts/check-canva-config.js

import dotenv from 'dotenv';
dotenv.config();

const clientId = process.env.CANVA_CLIENT_ID;
const clientSecret = process.env.CANVA_CLIENT_SECRET;
const redirectUri = process.env.CANVA_REDIRECT_URI;

console.log('=== Diagnóstico Canva ===\n');

if (!clientId) {
  console.log('❌ CANVA_CLIENT_ID não configurado');
} else {
  console.log(`✅ CANVA_CLIENT_ID: ${clientId}`);
}

if (!clientSecret) {
  console.log('❌ CANVA_CLIENT_SECRET não configurado');
} else if (clientSecret === 'COLE_AQUI_SUA_CLIENT_SECRET') {
  console.log('⚠️  CANVA_CLIENT_SECRET ainda está com o placeholder');
} else {
  console.log(`✅ CANVA_CLIENT_SECRET: ${clientSecret.slice(0, 4)}...${clientSecret.slice(-4)} (${clientSecret.length} caracteres)`);
}

if (!redirectUri) {
  console.log('❌ CANVA_REDIRECT_URI não configurado');
} else {
  console.log(`✅ CANVA_REDIRECT_URI: ${redirectUri}`);
}

if (clientId && clientSecret && clientSecret !== 'COLE_AQUI_SUA_CLIENT_SECRET' && redirectUri) {
  console.log('\n✅ Configuração completa. Reinicie o backend se ainda não reiniciou.');
} else {
  console.log('\n❌ Configuração incompleta. Preencha as variáveis no backend/.env e reinicie o backend.');
  process.exit(1);
}

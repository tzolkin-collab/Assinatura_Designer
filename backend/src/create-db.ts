import pg from 'pg';
import fs from 'fs';
import path from 'path';

const { Client } = pg;

// Use default postgres DB to create the new DB
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';

async function createDatabaseAndSchema() {
  console.log('🔄 Conectando ao SGBD para criar o banco "assinatura"...');
  
  // Connect to default DB
  let client = new Client({ connectionString });
  
  try {
    await client.connect();
    
    // Check if db exists
    const res = await client.query(`SELECT 1 FROM pg_database WHERE datname = 'assinatura'`);
    if (res.rowCount === 0) {
      console.log('🛠 Banco de dados "assinatura" não existe. Criando...');
      await client.query(`CREATE DATABASE assinatura;`);
      console.log('✅ Banco "assinatura" criado com sucesso.');
    }
    
    if (res.rowCount !== 0) {
      console.log('✅ Banco "assinatura" já existe.');
    }
  } catch (err) {
    console.error('❌ Erro ao criar o banco:', err);
    process.exit(1);
  } finally {
    await client.end();
  }

  // Now connect to the new 'assinatura' database
  console.log('🔄 Conectando ao banco "assinatura" para rodar o init.sql...');
  
  const assinaturaUrl = connectionString.replace(/\/[^/]+$/, '/assinatura');
  client = new Client({ connectionString: assinaturaUrl });

  try {
    await client.connect();
    
    // We are compiling to CommonJS, so __dirname is available and import.meta is not allowed by tsc.
    const currentDir = __dirname;
    const sqlPath = path.join(currentDir, '..', 'init.sql');
    
    if (fs.existsSync(sqlPath)) {
      const sql = fs.readFileSync(sqlPath, 'utf8');
      await client.query(sql);
      console.log('✅ Schema "app" e tabelas criadas com sucesso no banco "assinatura".');
    }
    
    if (!fs.existsSync(sqlPath)) {
      console.error('❌ Arquivo init.sql não encontrado!');
    }

  } catch (err) {
    console.error('❌ Erro ao criar schema e tabelas:', err);
  } finally {
    await client.end();
  }
}

createDatabaseAndSchema();

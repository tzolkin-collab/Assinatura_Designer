const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({});
console.log('PrismaClient type:', typeof p);
p.$disconnect();

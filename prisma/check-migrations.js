// Bir marta ishlatiladigan skript: _prisma_migrations jadvalidan yozuvlarni ko'rsatadi.
// Ishga tushirish: node prisma/check-migrations.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT migration_name, finished_at, rolled_back_at
       FROM "_prisma_migrations"
       ORDER BY started_at;`
    );
    console.table(rows);
  } finally {
    await prisma.$disconnect();
  }
})();

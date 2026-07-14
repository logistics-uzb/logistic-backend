import { PrismaClient } from '@prisma/client';

import { seedTelegramGroups } from './seeders/telegram-groups.seeder';
import { seedTestUsers } from './seeders/test-users.seeder';

/**
 * Prisma seed entry point.
 *
 * Ishga tushirish:
 *   npx prisma db seed
 *
 * package.json ichida:
 *   "prisma": { "seed": "ts-node prisma/seed.ts" }
 *
 * Seederlar tartibi muhim emas — ular idempotent (upsert/findUnique bilan).
 * Yangi seeder qo'shsangiz shu yerga import qilib chaqiring.
 */

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const startedAt = Date.now();
  console.log('=== Seeding boshlandi ===');

  await seedTelegramGroups(prisma);
  await seedTestUsers(prisma);

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`=== Seeding tugadi (${elapsed}s) ===`);
}

main()
  .catch((err) => {
    console.error('Seed xatosi:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

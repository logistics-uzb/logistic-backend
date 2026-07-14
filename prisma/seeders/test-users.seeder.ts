import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

/**
 * Test/demo hisoblari — MTProto oqim va dispatcher API'ni sinash uchun.
 *
 * NB: Ishlab chiqarish DB'da BU SEEDER ISHGA TUSHIRILMASIN — parollar
 * ma'lum ekan degani. Faqat local/dev muhitida foydali.
 */

const DEFAULT_PASSWORD = 'Test1234!';

const USERS = [
  {
    fullName: 'Test Admin',
    username: 'testadmin',
    phone: '+998944681015',
    role: 'ADMIN' as const,
  },
  {
    fullName: 'Operator Alfa',
    username: 'op_alfa',
    phone: '+998900000001',
    role: 'DISPATCHER' as const,
  },
  {
    fullName: 'Operator Beta',
    username: 'op_beta',
    phone: '+998900000002',
    role: 'DISPATCHER' as const,
  },
];

export async function seedTestUsers(prisma: PrismaClient): Promise<void> {
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  console.log(`[test-users] ${USERS.length} ta test hisob upsert qilinmoqda...`);

  let created = 0;
  let existed = 0;
  for (const u of USERS) {
    const existing = await prisma.user.findUnique({
      where: { username: u.username },
    });
    if (existing) {
      existed++;
      continue;
    }
    await prisma.user.create({
      data: {
        ...u,
        password: passwordHash,
        isActive: true,
      },
    });
    created++;
  }
  console.log(
    `[test-users] Tayyor: ${created} yaratildi, ${existed} mavjud edi (parol=${DEFAULT_PASSWORD})`
  );
}

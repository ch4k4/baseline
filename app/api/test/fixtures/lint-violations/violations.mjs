// Contoh PELANGGARAN untuk test/prisma.test.ts. Tidak pernah dijalankan.
// Setiap baris di bawah melanggar satu aturan scripts/lint-guc.mjs.
export async function salah(prisma, tx, PrismaClient) {
  await tx.$queryRaw`SELECT set_config('app.current_tenant_id', ${'x'}, true)`;
  await tx.$executeRawUnsafe('SET LOCAL app.current_tenant_id = 1');
  await prisma.$transaction(async () => undefined);
  return new PrismaClient();
}

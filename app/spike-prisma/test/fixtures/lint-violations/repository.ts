// Berkas contoh PELANGGARAN untuk tes lint (tidak dikompilasi, tidak dijalankan).
export async function salah(prisma: any, tx: any) {
  await tx.$queryRaw`SELECT set_config('app.current_tenant_id', ${'x'}, true)`;
  await tx.$executeRawUnsafe('SET LOCAL app.current_tenant_id = 1');
  await prisma.$transaction(async () => undefined);
  const lain = new PrismaClient();
  return lain;
}
declare const PrismaClient: any;

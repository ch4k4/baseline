import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * Kanal pengiriman undangan untuk DEMO (ADR-002 sec.2.2: "token undangan
 * dikeluarkan melalui secure local/demo provisioning channel, bukan log").
 *
 * Setiap undangan menjadi satu berkas teks di folder outbox, mirip mail catcher.
 * Folder itu di LUAR repo (sama seperti KEK), karena isinya email dan token
 * sungguhan - walau sintetis.
 *
 * Yang sengaja TIDAK dilakukan:
 *   - token tidak dikembalikan ke admin yang mengundang. Kalau dikembalikan,
 *     admin dapat mendaftarkan akun atas nama email yang belum punya akun;
 *   - token dan email tidak dicetak ke console. Log bukan kanal pengiriman.
 *
 * Diganti penyedia email sungguhan sebelum data nyata (D-22).
 */

export function outboxDir(): string {
  return process.env.DEMO_OUTBOX_DIR ?? path.join(homedir(), '.saas-demo', 'outbox');
}

export function webBaseUrl(): string {
  return process.env.DEMO_WEB_BASE_URL ?? 'http://127.0.0.1:3000';
}

export interface InvitationMail {
  invitationId: string;
  to: string;
  tenantName: string;
  token: string;
  expiresAt: Date;
}

/** Menulis satu "email" undangan. Mengembalikan path berkas (untuk tes). */
export function deliverInvitation(mail: InvitationMail): string {
  const dir = outboxDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Nama berkas: waktu + id undangan. Tidak memuat email maupun token, supaya
  // daftar isi folder saja tidak membocorkan keduanya.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${stamp}-${mail.invitationId}.txt`);
  const link = `${webBaseUrl()}/invite?token=${encodeURIComponent(mail.token)}`;
  const body = [
    `To: ${mail.to}`,
    `Subject: Undangan bergabung dengan ${mail.tenantName}`,
    `Invitation-Id: ${mail.invitationId}`,
    '',
    `Anda diundang bergabung dengan ${mail.tenantName}.`,
    '',
    'Buka tautan berikut untuk menerima undangan:',
    link,
    '',
    `Tautan berlaku sampai ${mail.expiresAt.toISOString()} dan hanya dapat dipakai sekali.`,
    '',
  ].join('\n');
  // wx: tidak pernah menimpa berkas lain. mode 0600: hanya pemilik akun.
  writeFileSync(file, body, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  return file;
}

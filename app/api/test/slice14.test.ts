import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { bootstrap } from '../src/main.js';
import { claims } from './token-helper.js';

/**
 * Tes slice 14 - DEMO-0312: support session break-glass.
 *
 * Daftar tes wajib ADR-003 sec.5 yang dibuktikan DI SINI (sisa baris yang tidak
 * bergantung pada aplikasi ada di db/tests/slice14_test.sql):
 *
 *   * superadmin tanpa support session tidak membaca data tenant (sisi API);
 *   * token support membuka tenant sesinya, dengan permission set TETAP - bukan
 *     hak tenant_owner - dan nama anggota DI-MASKER;
 *   * READ_ONLY menolak mutasi di guard; READ_WRITE hanya sejauh yang disetujui,
 *     dan tidak dapat menyentuh role, membership, maupun undangan;
 *   * sesi kedaluwarsa dan sesi yang diakhiri langsung ditolak pada request
 *     berikutnya - bukan menunggu token habis;
 *   * tidak dapat membuka dua sesi aktif; tidak ada jalan memperpanjang;
 *   * logout session PLATFORM mengakhiri sesi support;
 *   * tenant SUSPENDED hanya READ_ONLY;
 *   * kejadian started/ended terlihat di audit TENANT dan audit PLATFORM, dan
 *     tenant menerima notifikasi.
 *
 * Akun yang dipakai: superadmin platform dan owner@alpha.demo. `user@alpha.demo`
 * TIDAK dipakai - akun itu sengaja dikunci tes rate limiting slice 6 selama lima
 * menit, dan tes yang memakainya lulus atau gagal tergantung urutan suite
 * (pelajaran slice 12, terulang di slice 13).
 */

const PORT = Number(process.env.TEST_PORT ?? 3209);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo#12345';

const ALPHA = '11111111-1111-1111-1111-111111111111';
const BETA = '22222222-2222-2222-2222-222222222222';
const SUPERADMIN_EMAIL = 'superadmin@demo.platform';
const SUPERADMIN_ID = 'dddddddd-0000-0000-0000-000000000001';
const RUN = randomBytes(3).toString('hex');

const ALASAN = 'Anggota tenant melaporkan daftar anggota tidak dapat dibuka sejak pagi';

let app: any;
let db: Client;
let mulai: Date;
let platform: string;
let ownerAlpha: string;

async function http(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return {
    status: res.status,
    text,
    body: (() => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    })() as any,
  };
}

async function loginPlatform(): Promise<string> {
  const r = await http('POST', '/api/v1/auth/login', {
    email: SUPERADMIN_EMAIL,
    password: PASSWORD,
  });
  assert.equal(r.status, 201, `login superadmin gagal: ${r.text}`);
  assert.equal(r.body.status, 'SESSION');
  return r.body.accessToken;
}

async function loginTenant(email: string, tenantId: string): Promise<string> {
  const r = await http('POST', '/api/v1/auth/login', { email, password: PASSWORD });
  assert.equal(r.status, 201, `login ${email} gagal: ${r.text}`);
  if (r.body.status === 'SESSION') return r.body.accessToken;
  const s = await http('POST', '/api/v1/auth/select-context', { ticket: r.body.ticket, tenantId });
  assert.equal(s.status, 201, s.text);
  return s.body.accessToken;
}

interface Dibuka {
  token: string;
  id: string;
  scope: string;
  forcedReadOnly: boolean;
}

/** Membuka sesi support lewat jalur produk, bukan lewat INSERT langsung. */
async function buka(
  tokenPlatform: string,
  opsi: Partial<{ tenantId: string; scope: string; reasonCode: string; durationMinutes: number; ticketReference: string | null; reasonText: string }> = {},
): Promise<Dibuka> {
  const r = await http(
    'POST',
    '/api/v1/platform/support-sessions',
    {
      tenantId: opsi.tenantId ?? ALPHA,
      reasonCode: opsi.reasonCode ?? 'TENANT_REPORTED_BUG',
      reasonText: opsi.reasonText ?? ALASAN,
      scope: opsi.scope ?? 'READ_ONLY',
      durationMinutes: opsi.durationMinutes ?? 30,
      ticketReference: opsi.ticketReference ?? `TIKET-${RUN}`,
    },
    tokenPlatform,
  );
  assert.equal(r.status, 201, `membuka sesi support gagal: ${r.text}`);
  return {
    token: r.body.supportToken,
    id: r.body.session.id,
    scope: r.body.session.scope,
    forcedReadOnly: r.body.forcedReadOnly,
  };
}

async function akhiri(tokenPlatform: string, id: string) {
  const r = await http('POST', `/api/v1/platform/support-sessions/${id}/end`, {}, tokenPlatform);
  assert.equal(r.status, 200, r.text);
  return r.body;
}

/** Baris sesi dibaca lewat koneksi superuser: tes memeriksa keadaan, bukan jawaban API. */
async function baris(id: string) {
  const { rows } = await db.query(
    `SELECT status, end_reason, scope, reason_code, ticket_reference,
            reason_text_ciphertext, expires_at, started_at
     FROM support_sessions WHERE id = $1`,
    [id],
  );
  return rows[0];
}

async function auditCount(eventType: string, tenantId: string | null, subjectId?: string) {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM audit_logs
     WHERE event_type = $1 AND occurred_at >= $2
       AND tenant_id IS NOT DISTINCT FROM $3
       AND ($4::uuid IS NULL OR subject_id = $4::uuid)`,
    [eventType, mulai, tenantId, subjectId ?? null],
  );
  return rows[0].n;
}

async function notifikasiUntuk(refId: string, type: string) {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM tenant_notifications WHERE ref_id = $1 AND type = $2`,
    [refId, type],
  );
  return rows[0].n;
}

before(async () => {
  process.env.PORT = String(PORT);
  app = await bootstrap(PORT);
  db = new Client({
    host: process.env.DEMO_DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DEMO_DB_PORT ?? 5432),
    database: process.env.DEMO_DB_NAME ?? 'saas_demo',
    user: process.env.DEMO_DB_SUPER ?? 'postgres',
    password: process.env.DEMO_DB_SUPER_PASSWORD,
  });
  await db.connect();
  mulai = (await db.query('SELECT clock_timestamp() AS t')).rows[0].t;

  platform = await loginPlatform();
  ownerAlpha = await loginTenant('owner@alpha.demo', ALPHA);
});

after(async () => {
  // Sesi support dan notifikasinya adalah keadaan bersama. Urutan pembersihan
  // mengikuti arah foreign key: notifikasi -> sesi support -> session platform.
  if (db) {
    await db.query('UPDATE tenants SET status = $2 WHERE id = $1', [BETA, 'ACTIVE']);
    // Disaring pada WAKTU adalah kekeliruan yang saya buat lebih dulu: kasus 6
    // sengaja MENUAKAN barisnya (started_at digeser dua jam ke belakang), sehingga
    // justru baris itu lolos dari saringan `started_at >= mulai` dan tertinggal -
    // lalu menggagalkan tes SQL slice 14 di jalur berikutnya. Tidak ada alur produk
    // yang membuat sesi support di baseline ini, jadi tabelnya memang kosong sebelum
    // tes: dibersihkan seluruhnya, dan pembersihannya DIBUKTIKAN.
    await db.query('DELETE FROM tenant_notifications');
    await db.query('DELETE FROM support_sessions');
    const { rows } = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM support_sessions',
    );
    assert.equal(rows[0].n, 0, 'pembersihan sesi support tidak tuntas');
  }
  await db?.end();
  await app?.close();
});

describe('slice 14 - support session break-glass (DEMO-0312)', () => {
  test('1. sesi support dibuka: baris, token, audit dua sisi, dan notifikasi tenant', async () => {
    const sesi = await buka(platform);

    const row = await baris(sesi.id);
    assert.equal(row.status, 'ACTIVE');
    assert.equal(row.scope, 'READ_ONLY');
    assert.equal(row.reason_code, 'TENANT_REPORTED_BUG');
    assert.equal(row.ticket_reference, `TIKET-${RUN}`);
    // Alasan bebas disimpan sebagai ciphertext, bukan teks.
    assert.ok(Buffer.isBuffer(row.reason_text_ciphertext));
    assert.ok(!row.reason_text_ciphertext.toString('utf8').includes('melaporkan'));

    // Token support membawa context SUPPORT, tenant sesi, dan id sesi. `sid`-nya
    // adalah session PLATFORM yang membukanya - itulah yang membuat logout platform
    // mematikannya (kasus 8).
    const c = claims(sesi.token);
    assert.equal(c.ctx, 'SUPPORT');
    assert.equal(c.tid, ALPHA);
    assert.equal(c.ssid, sesi.id);
    assert.equal(c.scp, 'READ_ONLY');
    assert.equal(c.sid, claims(platform).sid);
    assert.equal(c.mid, null);
    // exp tidak melampaui expires_at baris sesi (ADR-003 sec.2.2), DAN umurnya
    // memang sepanjang sesi - bukan 15 menit seperti access token biasa. Token
    // support tidak dapat diperbarui (tanpa refresh token), jadi umur 15 menit akan
    // mematikan sesi 30 menit di tengah jalan dan memaksa superadmin membuka sesi
    // break-glass baru berulang kali.
    //
    // Umurnya DIPATOK pada rentang yang sempit, bukan hanya "lebih besar dari umur
    // access token biasa". Pertidaksamaan yang longgar itulah yang membuat versi
    // pertama kasus ini gagal di mesin target dengan pesan yang tidak menyebut
    // sebabnya: di sana umur token menjadi 450 menit untuk sesi 30 menit, karena
    // umurnya dihitung dari `expires_at` hasil query mentah Prisma - dan Prisma
    // membaca timestamptz sebagai jam dinding sesi database lalu melabelinya UTC.
    // Sekarang umurnya datang dari hitungan database (detik), dan angkanya diperiksa.
    const umur = c.exp - c.iat;
    assert.ok(
      umur > 25 * 60 && umur <= 30 * 60 + 5,
      `umur token support ${umur} detik (${(umur / 60).toFixed(1)} menit), seharusnya ~30 menit`,
    );
    assert.ok(
      c.exp * 1000 <= new Date(row.expires_at).getTime() + 1000,
      `exp token ${new Date(c.exp * 1000).toISOString()} melewati expires_at baris ${new Date(row.expires_at).toISOString()}`,
    );

    // Kejadian terlihat di AUDIT TENANT dan AUDIT PLATFORM. audit_logs punya satu
    // kolom tenant_id, jadi "terlihat di keduanya" hanya mungkin sebagai dua baris.
    assert.equal(await auditCount('support.session.started', ALPHA, sesi.id), 1);
    assert.equal(await auditCount('support.session.started', null, sesi.id), 1);

    // Dan tenant diberi tahu (F-15), bukan hanya dicatat.
    assert.equal(await notifikasiUntuk(sesi.id, 'SUPPORT_SESSION_STARTED'), 1);

    // Tenant yang berhak membaca notifikasi keamanan melihatnya lewat jalur produk.
    const n = await http('GET', '/api/v1/notifications/security', undefined, ownerAlpha);
    assert.equal(n.status, 200, n.text);
    assert.ok(n.body.notifications.some((x: any) => x.ref_id === sesi.id));

    // Dan tenant melihat SESINYA, bukan hanya pemberitahuan bahwa ada sesi:
    // scope, alasan, dan waktunya (ADR-003 sec.2.4). Teks alasan tidak termasuk -
    // kuncinya milik platform.
    const milikTenant = await http('GET', '/api/v1/support-sessions', undefined, ownerAlpha);
    assert.equal(milikTenant.status, 200, milikTenant.text);
    const dilihatTenant = milikTenant.body.sessions.find((x: any) => x.id === sesi.id);
    assert.ok(dilihatTenant, 'tenant tidak melihat sesi support atas dirinya');
    assert.equal(dilihatTenant.scope, 'READ_ONLY');
    assert.equal(dilihatTenant.reason_code, 'TENANT_REPORTED_BUG');
    assert.equal(dilihatTenant.status, 'ACTIVE');
    assert.ok(!('reason_text' in dilihatTenant), 'teks alasan bocor ke tenant');
    assert.ok(!('reason_text_ciphertext' in dilihatTenant));

    await akhiri(platform, sesi.id);
  });

  test('2. permintaan yang tidak sah ditolak sebelum sesi ada', async () => {
    const buruk = [
      { reasonCode: 'APA_SAJA' },
      { reasonText: 'singkat' },
      { durationMinutes: 61 },
      { durationMinutes: 0 },
      { durationMinutes: 10.5 },
      { scope: 'READ_WRITE', reasonCode: 'SECURITY_INCIDENT' },
      { scope: 'ADMIN' },
      { ticketReference: 'budi@contoh.co.id' },
    ];

    for (const patch of buruk) {
      const r = await http(
        'POST',
        '/api/v1/platform/support-sessions',
        {
          tenantId: ALPHA,
          reasonCode: 'TENANT_REPORTED_BUG',
          reasonText: ALASAN,
          scope: 'READ_ONLY',
          durationMinutes: 30,
          ...patch,
        },
        platform,
      );
      assert.equal(r.status, 400, `${JSON.stringify(patch)} seharusnya 400: ${r.text}`);
    }

    // Tenant yang tidak ada: 404, bukan 400 - dan tidak membuka sesi apa pun.
    const hantu = await http(
      'POST',
      '/api/v1/platform/support-sessions',
      {
        tenantId: '99999999-9999-9999-9999-999999999999',
        reasonCode: 'TENANT_REPORTED_BUG',
        reasonText: ALASAN,
        scope: 'READ_ONLY',
        durationMinutes: 30,
      },
      platform,
    );
    assert.equal(hantu.status, 404, hantu.text);

    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM support_sessions WHERE started_at >= $1 AND status = 'ACTIVE'`,
      [mulai],
    );
    assert.equal(rows[0].n, 0, 'permintaan tidak sah meninggalkan sesi aktif');
  });

  test('3. token support membuka tenant sesinya dengan permission set tetap, nama ber-masker', async () => {
    // Satu sesi yang SUDAH BERAKHIR dibuat lebih dulu, supaya riwayat tenant pasti
    // berisi lebih dari satu baris. Tanpa itu, pemeriksaan "sesi support hanya
    // melihat barisnya sendiri" di bawah lulus hanya karena tidak ada baris lain -
    // yaitu lulus tanpa memeriksa apa pun.
    const riwayat = await buka(platform, { durationMinutes: 5 });
    await akhiri(platform, riwayat.id);

    const sesi = await buka(platform);

    // Hak yang dijawab adalah himpunan tetap, bukan permission sebuah membership.
    const me = await http('GET', '/api/v1/me/permissions', undefined, sesi.token);
    assert.equal(me.status, 200, me.text);
    assert.equal(me.body.kind, 'SUPPORT');
    assert.equal(me.body.tenantId, ALPHA);
    assert.deepEqual(me.body.permissions, [
      'audit.read',
      'members.read',
      'menus.read',
      'permissions.read',
      'roles.read',
    ]);
    assert.equal(me.body.support.scope, 'READ_ONLY');
    assert.equal(me.body.support.sessionId, sesi.id);

    // Membaca data tenant: boleh. Inilah yang tidak dapat dilakukan superadmin
    // tanpa sesi support (slice 13 kasus 2).
    const anggota = await http('GET', '/api/v1/members', undefined, sesi.token);
    assert.equal(anggota.status, 200, anggota.text);
    assert.ok(anggota.body.members.length > 0);

    // Nama DI-MASKER (ADR-003 sec.2.2 butir 3). Yang dibandingkan adalah jawaban
    // untuk MATA yang sama: owner melihat nama utuh, support tidak.
    const owner = await http('GET', '/api/v1/members', undefined, ownerAlpha);
    assert.equal(owner.status, 200, owner.text);
    const nama = owner.body.members.map((m: any) => m.display_name);
    const namaSupport = anggota.body.members.map((m: any) => m.display_name);
    assert.ok(nama.some((n: string) => n.length > 3 && !n.includes('***')), 'owner pun melihat masker');
    for (const n of namaSupport) {
      assert.match(n, /\*\*\*/, `nama tidak di-masker untuk sesi support: ${n}`);
    }
    assert.ok(!namaSupport.some((n: string) => nama.includes(n)), 'nama utuh lolos ke sesi support');
    // Email memang sudah ber-masker untuk semua pemanggil sejak slice 8.
    for (const m of anggota.body.members) assert.match(m.contact_email_masked, /\*\*\*@/);

    // BUKTI bahwa transaksi sesi ini benar-benar berjalan sebagai context SUPPORT
    // dan membawa id sesinya: lewat endpoint yang sama, sesi support hanya melihat
    // BARISNYA SENDIRI, sedangkan tenant melihat seluruh riwayatnya. Kalau unit of
    // work melupakan penanda sesi dan membuka transaksi tenant biasa, jawaban di
    // bawah akan berisi riwayat itu juga - dan tidak ada gejala lain yang terlihat.
    const dilihatSupport = await http('GET', '/api/v1/support-sessions', undefined, sesi.token);
    assert.equal(dilihatSupport.status, 200, dilihatSupport.text);
    assert.deepEqual(
      dilihatSupport.body.sessions.map((x: any) => x.id),
      [sesi.id],
      'sesi support melihat lebih dari barisnya sendiri',
    );

    const dilihatTenant = await http('GET', '/api/v1/support-sessions', undefined, ownerAlpha);
    const idTenant = dilihatTenant.body.sessions.map((x: any) => x.id);
    assert.ok(idTenant.includes(sesi.id) && idTenant.includes(riwayat.id),
      'tenant seharusnya melihat riwayat sesi, bukan hanya yang sedang berjalan');

    for (const path of ['/api/v1/roles', '/api/v1/permissions']) {
      const r = await http('GET', path, undefined, sesi.token);
      assert.equal(r.status, 200, `${path}: ${r.text}`);
    }

    // Hak platform TIDAK terbawa ke dalam sesi: token support bukan token platform.
    for (const path of ['/api/v1/platform/admins', '/api/v1/platform/support-sessions']) {
      const r = await http('GET', path, undefined, sesi.token);
      assert.equal(r.status, 403, `${path} seharusnya 403 untuk token support: ${r.text}`);
    }

    // Route identitas tertutup: sesi support tidak boleh menukar dirinya menjadi
    // session tenant biasa, dan tidak boleh mengakhiri session platform orang.
    for (const [method, path, body] of [
      ['POST', '/api/v1/me/context-switch', { tenantId: ALPHA }],
      ['POST', '/api/v1/auth/logout', {}],
      ['GET', '/api/v1/me/contexts', undefined],
    ] as const) {
      const r = await http(method, path, body, sesi.token);
      assert.equal(r.status, 403, `${path} seharusnya 403 untuk token support: ${r.text}`);
    }

    await akhiri(platform, sesi.id);
  });

  test('4. READ_ONLY menolak mutasi, termasuk menandai notifikasi tentang dirinya sendiri', async () => {
    const sesi = await buka(platform);

    const daftar = await http('GET', '/api/v1/members', undefined, sesi.token);
    const target = daftar.body.members[0];

    const patch = await http(
      'PATCH',
      `/api/v1/members/${target.membership_id}/profile`,
      { displayName: `Koreksi ${RUN}`, version: target.version },
      sesi.token,
    );
    assert.equal(patch.status, 403, `READ_ONLY seharusnya menolak mutasi: ${patch.text}`);

    // LUBANG YANG DITEMUKAN SAAT MENULIS SLICE INI: menandai notifikasi terbaca
    // memerlukan audit.read - permission BACA di route TULIS. Tanpa pemeriksaan
    // metode di guard, sesi support dapat menghapus peringatan tentang dirinya
    // sendiri dari layar tenant.
    const notif = await http('GET', '/api/v1/notifications/security', undefined, sesi.token);
    assert.equal(notif.status, 200, notif.text);
    const milikSendiri = notif.body.notifications.find((x: any) => x.ref_id === sesi.id);
    assert.ok(milikSendiri, 'sesi support tidak melihat notifikasi tentang dirinya');

    const tandai = await http(
      'POST',
      `/api/v1/notifications/security/${milikSendiri.id}/read`,
      {},
      sesi.token,
    );
    assert.equal(tandai.status, 403, `sesi support menandai notifikasinya terbaca: ${tandai.text}`);

    // Dan notifikasi itu benar-benar masih belum terbaca.
    const { rows } = await db.query<{ read_at: Date | null }>(
      'SELECT read_at FROM tenant_notifications WHERE id = $1',
      [milikSendiri.id],
    );
    assert.equal(rows[0].read_at, null);

    // Penolakan tercatat dengan sebabnya, dan membawa id sesi supportnya.
    const { rows: jejak } = await db.query<{ detail: any }>(
      `SELECT detail FROM audit_logs
       WHERE event_type = 'authz.denied' AND occurred_at >= $1
         AND detail->>'supportSessionId' = $2
       ORDER BY occurred_at DESC LIMIT 1`,
      [mulai, sesi.id],
    );
    assert.equal(jejak.length, 1, 'penolakan sesi support tidak tercatat');
    assert.equal(jejak[0].detail.reason, 'SUPPORT_READ_ONLY_ROUTE');
    assert.equal(jejak[0].detail.actorType, 'PLATFORM_SUPPORT');

    await akhiri(platform, sesi.id);
  });

  test('5. READ_WRITE hanya sejauh yang disetujui, dan mutasinya teraudit', async () => {
    const sesi = await buka(platform, {
      scope: 'READ_WRITE',
      reasonCode: 'DATA_CORRECTION_REQUESTED_BY_TENANT',
    });
    assert.equal(sesi.scope, 'READ_WRITE');
    assert.equal(sesi.forcedReadOnly, false);

    // Nama asli dibaca lewat mata OWNER (support hanya melihat masker), supaya tes
    // dapat memulihkannya sesudahnya. Tes yang mengubah data seed wajib
    // mengembalikannya - kalau tidak, tes lain lulus atau gagal karenanya.
    const ownerList = await http('GET', '/api/v1/members', undefined, ownerAlpha);
    const target = ownerList.body.members[0];
    const namaAsli = target.display_name;

    const patch = await http(
      'PATCH',
      `/api/v1/members/${target.membership_id}/profile`,
      { displayName: `Koreksi Support ${RUN}`, version: target.version },
      sesi.token,
    );
    assert.equal(patch.status, 200, `READ_WRITE seharusnya dapat memperbaiki profil: ${patch.text}`);
    // Jawabannya pun ber-masker: hak menulis tidak membuka masker.
    assert.match(patch.body.display_name, /\*\*\*/);

    // Satu nama event untuk "support mengubah sesuatu", dan baris audit service
    // ikut membawa id sesi supportnya.
    assert.equal(await auditCount('support.mutation', ALPHA, sesi.id), 1);
    const { rows: jejak } = await db.query<{ detail: any }>(
      `SELECT detail FROM audit_logs
       WHERE event_type = 'member.profile_updated' AND occurred_at >= $1
       ORDER BY occurred_at DESC LIMIT 1`,
      [mulai],
    );
    assert.equal(jejak[0].detail.supportSessionId, sesi.id);
    assert.equal(jejak[0].detail.actorType, 'PLATFORM_SUPPORT');

    // Yang TIDAK boleh (ADR-003 sec.2.2 butir 4): keamanan tenant.
    const dilarang: Array<[string, string, unknown]> = [
      ['PUT', `/api/v1/members/${target.membership_id}/roles`, { roleIds: [], version: 1 }],
      ['POST', `/api/v1/members/${target.membership_id}/suspend`, { version: 1 }],
      ['POST', '/api/v1/invitations', { email: `x-${RUN}@test.demo` }],
      ['POST', '/api/v1/roles', { code: `r${RUN}`, name: 'Peran Support' }],
    ];
    for (const [method, path, body] of dilarang) {
      const r = await http(method, path, body, sesi.token);
      assert.equal(r.status, 403, `${method} ${path} seharusnya 403 untuk sesi support: ${r.text}`);
    }

    // Pulihkan nama, lewat owner.
    const lagi = await http('GET', '/api/v1/members', undefined, ownerAlpha);
    const sekarang = lagi.body.members.find((m: any) => m.membership_id === target.membership_id);
    const pulih = await http(
      'PATCH',
      `/api/v1/members/${target.membership_id}/profile`,
      { displayName: namaAsli, version: sekarang.version },
      ownerAlpha,
    );
    assert.equal(pulih.status, 200, pulih.text);

    await akhiri(platform, sesi.id);
  });

  test('6. sesi kedaluwarsa ditolak pada request berikutnya, lalu ditutup dan diberitakan', async () => {
    const sesi = await buka(platform, { durationMinutes: 5 });

    // Sebelum dituakan: berlaku.
    const sebelum = await http('GET', '/api/v1/members', undefined, sesi.token);
    assert.equal(sebelum.status, 200, sebelum.text);

    // Dituakan lewat koneksi superuser. Ini satu-satunya cara menguji kedaluwarsa
    // tanpa menunggu: started_at dan expires_at digeser BERSAMAAN supaya CHECK
    // durasi tetap terpenuhi - baris yang tidak sah tidak akan membuktikan apa pun.
    await db.query(
      `UPDATE support_sessions
       SET started_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
       WHERE id = $1`,
      [sesi.id],
    );

    // Token masih bertanda tangan sah dan belum kedaluwarsa menurut klaimnya.
    // Yang menolaknya adalah BARIS sesi, diperiksa setiap request (F-18).
    const sesudah = await http('GET', '/api/v1/members', undefined, sesi.token);
    assert.equal(sesudah.status, 401, `sesi kedaluwarsa seharusnya 401: ${sesudah.text}`);
    assert.ok(claims(sesi.token).exp * 1000 > Date.now(), 'token sudah kedaluwarsa sendiri');

    // Statusnya masih ACTIVE sampai ada yang membereskannya - dan yang
    // membereskannya adalah jalur yang peduli (daftar atau pembukaan sesi baru),
    // karena baseline tidak punya job periodik. Dikatakan apa adanya.
    assert.equal((await baris(sesi.id)).status, 'ACTIVE');

    const daftar = await http('GET', '/api/v1/platform/support-sessions', undefined, platform);
    assert.equal(daftar.status, 200, daftar.text);

    const row = await baris(sesi.id);
    assert.equal(row.status, 'EXPIRED');
    assert.equal(row.end_reason, 'EXPIRED');
    // Tenant tahu sesinya sudah tertutup, bukan hanya tahu sesinya dibuka.
    assert.equal(await notifikasiUntuk(sesi.id, 'SUPPORT_SESSION_ENDED'), 1);
    assert.equal(await auditCount('support.session.ended', ALPHA, sesi.id), 1);
    assert.equal(await auditCount('support.session.ended', null, sesi.id), 1);
  });

  test('7. satu sesi aktif per superadmin; sesi yang diakhiri langsung ditolak', async () => {
    const sesi = await buka(platform);

    const kedua = await http(
      'POST',
      '/api/v1/platform/support-sessions',
      {
        tenantId: BETA,
        reasonCode: 'TENANT_REPORTED_BUG',
        reasonText: ALASAN,
        scope: 'READ_ONLY',
        durationMinutes: 15,
      },
      platform,
    );
    assert.equal(kedua.status, 409, `sesi kedua seharusnya 409: ${kedua.text}`);

    // Diakhiri: token yang sama langsung ditolak, tanpa menunggu kedaluwarsa.
    assert.deepEqual(await akhiri(platform, sesi.id), { status: 'ENDED' });
    const sesudah = await http('GET', '/api/v1/members', undefined, sesi.token);
    assert.equal(sesudah.status, 401, `sesi yang diakhiri seharusnya 401: ${sesudah.text}`);

    const row = await baris(sesi.id);
    assert.equal(row.status, 'ENDED');
    assert.equal(row.end_reason, 'MANUAL');
    assert.equal(await notifikasiUntuk(sesi.id, 'SUPPORT_SESSION_ENDED'), 1);

    // Mengakhiri dua kali: 409, bukan diam-diam berhasil.
    const ulang = await http(
      'POST',
      `/api/v1/platform/support-sessions/${sesi.id}/end`,
      {},
      platform,
    );
    assert.equal(ulang.status, 409, ulang.text);

    // Dan sesudah sesi berakhir, sesi baru boleh dibuka.
    const lagi = await buka(platform, { durationMinutes: 10 });
    await akhiri(platform, lagi.id);
  });

  test('8. logout session PLATFORM mengakhiri sesi support yang dibuka darinya', async () => {
    // Session platform TERSENDIRI supaya logout di sini tidak mematikan token
    // platform yang dipakai kasus lain.
    const platform2 = await loginPlatform();
    const sesi = await buka(platform2);

    const keluar = await http('POST', '/api/v1/auth/logout', {}, platform2);
    assert.equal(keluar.status, 201, keluar.text);

    const sesudah = await http('GET', '/api/v1/members', undefined, sesi.token);
    assert.equal(sesudah.status, 401, `token support hidup setelah logout platform: ${sesudah.text}`);

    const row = await baris(sesi.id);
    assert.equal(row.status, 'ENDED');
    assert.equal(row.end_reason, 'PLATFORM_LOGOUT');
    assert.equal(await notifikasiUntuk(sesi.id, 'SUPPORT_SESSION_ENDED'), 1);
  });

  test('10. READ_WRITE menuntut permission tersendiri, bukan sekadar alasan yang benar', async () => {
    // ADR-003 sec.2.2 butir 1 menyebut DUA syarat untuk READ_WRITE: alasan yang
    // mengizinkan perubahan DAN permission platform.support.start_write. Syarat
    // kedua tidak dapat diuji dengan akun demo mana pun - satu-satunya role platform
    // membawa seluruh katalog - jadi pemetaannya dilepas sesaat lewat koneksi
    // superuser. Inilah yang membuat tabel platform_role_permissions (slice 13)
    // punya arti: tanpa tabel itu, "permission tersendiri" hanya kalimat di dokumen.
    await db.query(
      `DELETE FROM platform_role_permissions
       WHERE role_code = 'platform_superadmin' AND permission_code = 'platform.support.start_write'`,
    );
    try {
      const r = await http(
        'POST',
        '/api/v1/platform/support-sessions',
        {
          tenantId: ALPHA,
          reasonCode: 'DATA_CORRECTION_REQUESTED_BY_TENANT',
          reasonText: ALASAN,
          scope: 'READ_WRITE',
          durationMinutes: 15,
        },
        platform,
      );
      assert.equal(r.status, 403, `READ_WRITE tanpa start_write seharusnya 403: ${r.text}`);

      // Dan READ_ONLY dengan alasan yang sama tetap boleh: yang hilang hanya hak
      // tulisnya, bukan hak membuka sesi.
      const ro = await buka(platform, { reasonCode: 'DATA_CORRECTION_REQUESTED_BY_TENANT' });
      assert.equal(ro.scope, 'READ_ONLY');
      await akhiri(platform, ro.id);
    } finally {
      await db.query(
        `INSERT INTO platform_role_permissions (role_code, permission_code)
         VALUES ('platform_superadmin', 'platform.support.start_write')
         ON CONFLICT DO NOTHING`,
      );
    }
  });

  test('11. session PLATFORM yang dicabut mematikan token support seketika', async () => {
    // Kasus ini ada karena uji mutasi A4: menghapus pemeriksaan "session platform
    // masih hidup" di guard TIDAK tertangkap oleh kasus 8, sebab logout juga
    // menutup baris sesi supportnya - dua penjaga yang saling menutupi.
    //
    // Di sini session platform dicabut TANPA melewati logout: pemakaian ulang
    // refresh token mencabut seluruh family beserta session-nya (slice 7). Baris
    // sesi support tetap ACTIVE, jadi yang dapat menolak token support hanyalah
    // pemeriksaan session platform.
    const masuk = await http('POST', '/api/v1/auth/login', {
      email: SUPERADMIN_EMAIL,
      password: PASSWORD,
    });
    assert.equal(masuk.status, 201, masuk.text);
    const platform3 = masuk.body.accessToken as string;
    const refresh = masuk.body.refreshToken as string;

    const sesi = await buka(platform3);
    assert.equal((await http('GET', '/api/v1/members', undefined, sesi.token)).status, 200);

    // Rotasi sekali, lalu pakai ULANG token yang sudah diputar: itu yang mencabut.
    const putar = await http('POST', '/api/v1/auth/refresh', { refreshToken: refresh });
    assert.equal(putar.status, 201, putar.text);
    const ulang = await http('POST', '/api/v1/auth/refresh', { refreshToken: refresh });
    assert.equal(ulang.status, 401, `pemakaian ulang seharusnya ditolak: ${ulang.text}`);

    // Baris sesi support MASIH ACTIVE - tidak ada yang menutupnya.
    assert.equal((await baris(sesi.id)).status, 'ACTIVE');

    // Dan token supportnya sudah mati.
    const sesudah = await http('GET', '/api/v1/members', undefined, sesi.token);
    assert.equal(sesudah.status, 401, `token support hidup setelah session platform dicabut: ${sesudah.text}`);

    // Dibersihkan lewat jalur produk: session platform baru, lalu akhiri sesinya.
    const lagi = await loginPlatform();
    await akhiri(lagi, sesi.id);
  });

  test('9. tenant yang tidak ACTIVE hanya READ_ONLY, walau READ_WRITE yang diminta', async () => {
    await db.query('UPDATE tenants SET status = $2 WHERE id = $1', [BETA, 'SUSPENDED']);
    try {
      const sesi = await buka(platform, {
        tenantId: BETA,
        scope: 'READ_WRITE',
        reasonCode: 'DATA_CORRECTION_REQUESTED_BY_TENANT',
      });
      // Diturunkan, bukan ditolak: kebutuhan support justru sering muncul saat
      // tenant disuspend (ADR-003 sec.2.2 butir 10). Penurunannya dikatakan kepada
      // pemanggil, supaya layar tidak menjanjikan hak yang tidak ada.
      assert.equal(sesi.scope, 'READ_ONLY');
      assert.equal(sesi.forcedReadOnly, true);
      assert.equal((await baris(sesi.id)).scope, 'READ_ONLY');
      assert.equal(claims(sesi.token).scp, 'READ_ONLY');

      const patch = await http(
        'PATCH',
        `/api/v1/members/00000000-0000-0000-0000-000000000001/profile`,
        { displayName: 'X', version: 1 },
        sesi.token,
      );
      assert.equal(patch.status, 403, patch.text);

      await akhiri(platform, sesi.id);
    } finally {
      await db.query('UPDATE tenants SET status = $2 WHERE id = $1', [BETA, 'ACTIVE']);
    }
  });
});

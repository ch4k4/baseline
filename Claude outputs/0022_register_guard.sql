-- 0022_register_guard.sql
-- Dijalankan sebagai app_owner.
--
-- Menutup lubang yang ditemukan saat baseline diarahkan menjadi fondasi produk
-- sungguhan: Lampiran A ADR ("sumber tunggal" fungsi SECURITY DEFINER dan policy
-- TO app_auth_definer) sudah melenceng dari database, dan tidak ada satu pun tes
-- yang mengawasinya. ADR sec.7 butir 7 dan Lampiran A sec.5 butir 4 menuntut
-- schema inspection test di CI sejak edisi pertama; test itu belum pernah ada.
--
-- APA YANG DITEMUKAN (bukan dugaan - dibaca dari pg_proc, pg_policies, dan
-- information_schema pada database demo):
--
-- 1. LIMA fungsi SECURITY DEFINER berjalan tanpa terdaftar sama sekali:
--    find_session, find_membership (keduanya dilewati SETIAP request),
--    create_refresh_token, get_active_key, get_key_version.
--    Kini terdaftar sebagai F-21..F-25.
--
-- 2. `crypto_keys` - tabel penyimpan DEK terbungkus - punya policy definer_read
--    dan grant kolom termasuk `wrapped_dek`, dan TIDAK tercantum di Lampiran A
--    sec.4 mana pun. Justru tabel paling sensitif yang luput dari daftar yang
--    dibaca reviewer Security.
--
-- 3. EMPAT tabel diberi grant TINGKAT TABEL, padahal Lampiran A sec.2 butir 4
--    menjanjikan column-level: `audit_logs`, `auth_selection_tickets`,
--    `refresh_tokens`, `sessions`. Akibatnya bukan teoretis - setiap kolom yang
--    DITAMBAHKAN kelak otomatis ikut terbaca jalur definer, tanpa seorang pun
--    memutuskannya. Berkas ini mempersempitnya menjadi kolom yang dinyatakan.
--
-- 4. Tiga entri register tidak punya isi di database: F-01
--    (resolve_tenant_by_host, beserta tabel `tenant_domains` yang tidak pernah
--    dibuat), F-03 (record_login_attempt, digantikan F-17 yang menghitung dari
--    audit_logs), dan F-08 (find_refresh_token, diserap rotate_refresh_token).
--    Ditandai belum-ada di `db/register.json`, dan tes menuntut ketiadaannya.
--
-- CARA MENJAGANYA supaya tidak terulang, dua lapis:
--
--   * setiap fungsi definer WAJIB membawa nomor registernya sebagai COMMENT.
--     Penulis migrasi berikutnya tidak dapat menambah fungsi tanpa menyatakan
--     nomor itu - dan untuk mendapat nomor, ia harus membuka Lampiran A;
--   * `db/register.json` memuat register dalam bentuk data, dan
--     `api/test/register.test.ts` membandingkannya dengan database. Dokumen
--     normatif TIDAK disalin ke sini (README induk sec.7 kriteria 1): yang ada di
--     repo adalah kontraknya sebagai data, dan nomor F-xx yang mengikat keduanya.
--
-- Aturan penulisan: ASCII murni.

\set ON_ERROR_STOP on

-- ------------------------------------------------- grant per kolom, bukan tabel
-- Urutannya penting: grant tingkat tabel harus DICABUT lebih dulu, kalau tidak ia
-- menaungi grant kolom di bawahnya dan pembatasan ini tidak berlaku apa pun.

-- audit_logs. INSERT: seluruh kolom (F-14 menulis barisnya). SELECT dipersempit
-- menjadi kolom yang benar-benar dibaca: `id` untuk RETURNING milik F-14, dan
-- empat kolom penghitung kegagalan F-17. Sisanya - termasuk `detail`, `tenant_id`,
-- dan kedua kolom subject - tidak lagi terbaca jalur definer.
REVOKE INSERT, SELECT ON audit_logs FROM app_auth_definer;
GRANT INSERT (id, occurred_at, tenant_id, event_type, outcome, actor_user_id,
              actor_session_id, actor_identifier_hash, subject_type, subject_id, detail)
  ON audit_logs TO app_auth_definer;
GRANT SELECT (id, occurred_at, event_type, outcome, actor_identifier_hash)
  ON audit_logs TO app_auth_definer;

-- auth_selection_tickets: seluruh kolom, dinyatakan satu per satu.
REVOKE INSERT, SELECT, UPDATE ON auth_selection_tickets FROM app_auth_definer;
GRANT INSERT (id, user_id, token_hash, created_at, expires_at, consumed_at)
  ON auth_selection_tickets TO app_auth_definer;
GRANT SELECT (id, user_id, token_hash, created_at, expires_at, consumed_at)
  ON auth_selection_tickets TO app_auth_definer;
GRANT UPDATE (consumed_at) ON auth_selection_tickets TO app_auth_definer;

-- sessions: SELECT dan INSERT seluruh kolom (tidak ada kolom personal di sini);
-- UPDATE tetap tiga kolom pencabutan seperti sebelumnya.
REVOKE INSERT, SELECT ON sessions FROM app_auth_definer;
GRANT INSERT (id, context_kind, tenant_id, user_id, membership_id, status,
              created_at, last_seen_at, expires_at, revoked_at, revocation_reason)
  ON sessions TO app_auth_definer;
GRANT SELECT (id, context_kind, tenant_id, user_id, membership_id, status,
              created_at, last_seen_at, expires_at, revoked_at, revocation_reason)
  ON sessions TO app_auth_definer;

-- refresh_tokens: seluruh kolom untuk ketiga operasi (rotasi menyentuh hampir
-- semuanya), dinyatakan satu per satu.
REVOKE INSERT, SELECT, UPDATE ON refresh_tokens FROM app_auth_definer;
GRANT INSERT (id, context_kind, tenant_id, session_id, token_hash, family_id,
              issued_at, expires_at, rotated_at, revoked_at, replaced_by_id)
  ON refresh_tokens TO app_auth_definer;
GRANT SELECT (id, context_kind, tenant_id, session_id, token_hash, family_id,
              issued_at, expires_at, rotated_at, revoked_at, replaced_by_id)
  ON refresh_tokens TO app_auth_definer;
GRANT UPDATE (rotated_at, revoked_at, replaced_by_id) ON refresh_tokens TO app_auth_definer;

-- ------------------------------------------------- nomor register sebagai COMMENT
COMMENT ON FUNCTION auth.find_identity_for_login(bytea) IS
  'F-02 pre-context: identitas untuk login dari blind index global';
COMMENT ON FUNCTION auth.list_login_contexts(uuid) IS
  'F-04 pre-context: daftar context login (baris TENANT per membership aktif + baris PLATFORM)';
COMMENT ON FUNCTION auth.create_selection_ticket(uuid, bytea, integer) IS
  'F-05 pre-context: tiket pemilihan context, TTL <= 5 menit';
COMMENT ON FUNCTION auth.consume_selection_ticket(bytea) IS
  'F-06 pre-context: pakai tiket pemilihan context, sekali pakai';
COMMENT ON FUNCTION auth.create_session(character varying, uuid, uuid, uuid, integer) IS
  'F-07 pre-context: buat session (menjaga batas ORANG; batas tenant dijaga composite FK)';
COMMENT ON FUNCTION auth.rotate_refresh_token(bytea, bytea, integer) IS
  'F-09 pre-context: rotasi refresh token, reuse -> REUSE_DETECTED';
COMMENT ON FUNCTION auth.revoke_session(uuid, character varying) IS
  'F-10 pre-context: cabut session';
COMMENT ON FUNCTION auth.revoke_token_family(uuid, character varying) IS
  'F-10 pre-context: cabut seluruh family refresh token';
COMMENT ON FUNCTION auth.find_invitation_for_acceptance(bytea) IS
  'F-11 pre-context: undangan untuk diterima, dari hash token';
COMMENT ON FUNCTION auth.accept_invitation(bytea, uuid, uuid, bytea, integer, bytea, integer, bytea) IS
  'F-12 pre-context: terima undangan (membership + profil + role) atomik';
COMMENT ON FUNCTION auth.get_platform_roles(uuid) IS
  'F-13 platform: role platform aktif milik satu identitas';
COMMENT ON FUNCTION auth.write_audit_event(character varying, character varying, uuid, uuid, uuid, bytea, character varying, uuid, jsonb) IS
  'F-14 cross-context: satu-satunya penulis audit_logs';
COMMENT ON FUNCTION auth.notify_tenant_security_event(uuid, text, uuid) IS
  'F-15 cross-context: notifikasi keamanan ke tenant, tanpa hak baca';
COMMENT ON FUNCTION auth.create_identity_for_invitation(bytea, uuid, bytea, bytea, integer, text) IS
  'F-16 pre-context: buat identitas baru saat undangan diterima';
COMMENT ON FUNCTION auth.count_recent_failures(bytea, integer, character varying) IS
  'F-17 pre-context: jumlah kegagalan untuk rate limiting (mengembalikan angka, bukan baris)';
COMMENT ON FUNCTION auth.find_support_session(uuid) IS
  'F-18 pre-context: validasi sesi support setiap request, fail-closed';
COMMENT ON FUNCTION auth.end_support_sessions_for_platform_session(uuid) IS
  'F-19 cross-context: akhiri sesi support yang menempel pada session platform';
COMMENT ON FUNCTION auth.menus_assert_hierarchy() IS
  'F-20 integritas: penjaga hierarki menu (siklus dan kedalaman), dipanggil trigger';

-- Lima yang sebelumnya berjalan TANPA terdaftar. Dua pertama adalah jalur yang
-- dilewati setiap request; dua terakhir membaca tabel DEK terbungkus.
COMMENT ON FUNCTION auth.find_session(uuid) IS
  'F-21 pre-context: baris session untuk verifikasi setiap request';
COMMENT ON FUNCTION auth.find_membership(uuid, uuid) IS
  'F-22 pre-context: membership aktif satu identitas pada satu tenant';
COMMENT ON FUNCTION auth.create_refresh_token(uuid, uuid, character varying, bytea, integer) IS
  'F-23 pre-context: refresh token baru untuk session yang sudah ada';
COMMENT ON FUNCTION auth.get_active_key(character varying, uuid) IS
  'F-24 kunci: DEK terbungkus yang ACTIVE untuk satu purpose+scope (tanpa KEK)';
COMMENT ON FUNCTION auth.get_key_version(character varying, uuid, integer) IS
  'F-25 kunci: DEK terbungkus versi tertentu, untuk membuka data lama';

COMMENT ON POLICY definer_read ON crypto_keys IS
  'F-24, F-25: hanya membaca DEK TERBUNGKUS. KEK tidak pernah ada di database.';

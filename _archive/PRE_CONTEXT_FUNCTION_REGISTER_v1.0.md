---
title: "Pre-context & Cross-context Database Access Register"
document_id: "PRE-CONTEXT-FUNCTION-REGISTER"
version: "1.0"
status: "Proposed; Security Review Pending"
last_updated: "2026-09-16"
supersedes: null
authority: "Satu-satunya daftar resmi fungsi SECURITY DEFINER dan policy TO app_auth_definer. Dokumen lain hanya merujuk register ini."
related_documents:
  - "ADR-001-SAAS-MULTI-TENANCY_v1.3.md"
  - "ADR-002-IDENTITY-MODEL_v1.1.md"
  - "ADR-003-PLATFORM-SUPERADMIN-SUPPORT-ACCESS_v1.1.md"
  - "INFRASTRUCTURE_SSOT_v1.5.md"
review_reference: "REVIEW_BASELINE_DOCS_v2_2026-09-16.md §1.1, §1.7, §1.8"
---

# Pre-context & Cross-context Database Access Register v1.0

## 1. Tujuan

Register ini adalah **sumber tunggal** untuk:

1. fungsi PostgreSQL `SECURITY DEFINER` yang dipakai sebelum tenant context terbentuk (pre-context) atau untuk menulis lintas context (cross-context);
2. policy RLS `TO app_auth_definer` yang memungkinkan fungsi tersebut membaca atau menulis baris yang dibutuhkan (keputusan **Opsi A**, ADR-001 v1.3 §3.7).

Menambah, mengubah, atau menghapus entri wajib melalui review Security dan pembaruan versi dokumen ini **sebelum** migration dibuat.

## 2. Model hak akses (Opsi A)

```text
app_owner          : pemilik schema/tabel; hanya pipeline migration; tidak dipakai runtime
app_auth_definer   : NOLOGIN, NOBYPASSRLS, NOINHERIT; pemilik fungsi di schema auth/audit_w;
                     memperoleh akses baris HANYA melalui policy "TO app_auth_definer" di §4
app_user           : LOGIN runtime, NOBYPASSRLS; EXECUTE pada fungsi §3; tidak ada policy §4
```

Aturan wajib:

1. `app_auth_definer` **tidak** memiliki `BYPASSRLS` dan bukan pemilik tabel, sehingga `FORCE ROW LEVEL SECURITY` tetap berlaku padanya. Akses hanya dari policy §4.
2. `app_user` **tidak** menjadi member `app_auth_definer` dan tidak dapat `SET ROLE app_auth_definer` (diverifikasi via `pg_auth_members`).
3. Policy §4 dibuat per tabel, per operasi (`SELECT`/`INSERT`/`UPDATE`), dan **tidak** memakai `FOR ALL`.
4. Grant tabel ke `app_auth_definer` dibatasi pada kolom yang tercantum di §4 (column-level `GRANT SELECT (col, ...)`).
5. Setiap fungsi: `SECURITY DEFINER`, `SET search_path = pg_catalog, auth, public` (schema eksplisit), `LANGUAGE sql` atau `plpgsql` tanpa `EXECUTE` dinamis, parameter bertipe tetap.
6. `REVOKE ALL ON FUNCTION ... FROM PUBLIC`; `GRANT EXECUTE ... TO app_user` hanya untuk fungsi yang dipakai runtime.
7. Fungsi mengembalikan kolom minimum; tidak mengembalikan plaintext maupun ciphertext data personal, kecuali entri yang ditandai "ciphertext diizinkan" dengan alasan.
8. Rate limit dan audit diterapkan di lapisan aplikasi di atas pemanggilan fungsi.
9. Schema inspection test di CI membandingkan `pg_proc`, `pg_policies`, `information_schema.column_privileges`, dan `pg_auth_members` terhadap register ini; perbedaan = build gagal.

## 3. Daftar fungsi

| ID | Fungsi | Tipe | Input | Output | Tabel yang disentuh (via §4) | Dipakai oleh | Test negatif minimum |
|---|---|---|---|---|---|---|---|
| F-01 | `auth.resolve_tenant_by_host(host text)` | Pre-context | host ternormalisasi | `tenant_id`, `status` | `tenant_domains` (S), `tenants` (S) | Tenant resolver | host tak terverifikasi → kosong; tenant PURGED → kosong |
| F-02 | `auth.find_identity_for_login(email_blind_index bytea)` | Pre-context | blind index global | `user_id`, `status`, `password_hash`, `password_algorithm`, `password_parameter_version`, `failed_attempts`, `locked_until` | `users` (S), `credentials` (S) | Login | index acak → kosong; tidak mengembalikan email/nama |
| F-03 | `auth.record_login_attempt(user_id uuid, succeeded boolean)` | Pre-context | user_id hasil F-02 | status lock | `credentials` (U: `failed_attempts`, `locked_until`) | Login | user_id acak → no-op tanpa error berbeda |
| F-04 | `auth.list_login_contexts(user_id uuid)` | Pre-context | user_id terverifikasi password | daftar `{context_kind, tenant_id, membership_id, tenant_display_name, status}` untuk membership aktif **dan** flag `has_platform_role` | `tenant_memberships` (S), `tenants` (S), `platform_role_assignments` (S) | Login, pemilihan context | user_id tanpa verifikasi tidak dapat dipanggil (dipanggil hanya setelah F-02 + verifikasi hash di aplikasi); tidak mengembalikan membership non-aktif |
| F-05 | `auth.create_selection_ticket(user_id uuid, ticket_hash bytea, expires_at timestamptz)` | Pre-context | hash tiket | `ticket_id` | `auth_selection_tickets` (I) | Login multi-context | TTL > 5 menit ditolak |
| F-06 | `auth.consume_selection_ticket(ticket_hash bytea, target_kind text, tenant_id uuid)` | Pre-context | hash tiket + target | `user_id`, `membership_id` atau platform flag | `auth_selection_tickets` (S,U), `tenant_memberships` (S), `platform_role_assignments` (S) | `POST /auth/select-context` | tiket kedaluwarsa/dipakai ulang; target bukan milik user |
| F-07 | `auth.create_session(...)` | Pre-context | user, context_kind, tenant_id/NULL, membership_id/NULL, refresh token hash, family, expiry | `session_id`, `refresh_token_id` | `sessions` (I), `refresh_tokens` (I) | Login, select-context, tenant switch | tenant_id tanpa membership aktif ditolak; context PLATFORM tanpa role platform ditolak |
| F-08 | `auth.find_refresh_token(token_hash bytea)` | Pre-context | hash | `refresh_token_id`, `session_id`, `family_id`, `context_kind`, `tenant_id`, status, expiry | `refresh_tokens` (S), `sessions` (S) | Refresh | hash salah → kosong |
| F-09 | `auth.rotate_refresh_token(old_id uuid, new_hash bytea, new_expiry timestamptz)` | Pre-context | id + hash baru | `new_refresh_token_id` atau `REUSE_DETECTED` | `refresh_tokens` (S,U,I), `sessions` (U) | Refresh | rotasi token sudah dirotasi → revoke family; concurrent rotation → satu pemenang |
| F-10 | `auth.revoke_session(session_id uuid, reason text)` / `auth.revoke_token_family(family_id uuid, reason text)` | Pre-context | id | jumlah baris | `sessions` (U), `refresh_tokens` (U) | Logout, reuse detection, platform revoke | id tak dikenal → 0 tanpa error berbeda |
| F-11 | `auth.find_invitation_for_acceptance(token_hash bytea)` | Pre-context | hash undangan | `invitation_id`, `tenant_id`, `tenant_display_name`, `status`, `expires_at`, `email_blind_index_global_hint` | `user_invitations` (S), `tenants` (S) | Halaman terima undangan | hash salah/kedaluwarsa → kosong; tidak mengembalikan email/role |
| F-12 | `auth.accept_invitation(invitation_id uuid, user_id uuid, display_name_ciphertext bytea, contact_email_ciphertext bytea, contact_email_blind_index_tenant bytea)` | Pre-context | hasil F-11 + identitas terautentikasi | `membership_id` | `user_invitations` (U), `invitation_roles` (S), `tenant_memberships` (I), `tenant_member_profiles` (I), `user_role_assignments` (I) | Terima undangan | identitas ≠ email undangan (dicek aplikasi sebelum panggil, dicek ulang via blind index); role milik tenant lain (dicegah composite FK); undangan dipakai ulang |
| F-13 | `auth.get_platform_roles(user_id uuid)` | Pre-context/platform | user_id dari session terverifikasi | daftar `role_code` aktif | `platform_role_assignments` (S) | Platform guard | user_id tanpa role → kosong |
| F-14 | `audit_w.write_event(p_tenant_id uuid, p_actor ..., p_action text, ...)` | Pre-context & cross-context | event tervalidasi | `audit_log_id` | `audit_logs` (I) | Audit login gagal, event platform, event support ke audit tenant | `metadata` melebihi batas/berisi field terlarang ditolak; action di luar allowlist ditolak |
| F-15 | `audit_w.notify_tenant_security_event(p_tenant_id uuid, p_type text, p_ref_id uuid)` | Cross-context | tenant + tipe allowlist | `notification_id` | `tenant_notifications` (I), `tenant_memberships` (S) | Notifikasi support session ke tenant owner | tipe di luar allowlist ditolak |

Kode: S = SELECT, I = INSERT, U = UPDATE. Nama fungsi final dapat berubah; ID tetap.

**Catatan F-02:** mengembalikan `password_hash` ke aplikasi diperlukan agar verifikasi Argon2id dilakukan di aplikasi (library yang ditinjau), bukan di database. Alternatif verifikasi di database (extension) tidak dipilih. Hash tidak boleh dicatat di log (DP SSOT §6.5).

## 4. Policy `TO app_auth_definer`

| Tabel | Operasi | Policy (indikatif) | Kolom yang di-grant |
|---|---|---|---|
| `tenant_domains` | SELECT | `USING (verified_at IS NOT NULL)` | `tenant_id, host, verified_at` |
| `tenants` | SELECT | `USING (status <> 'PURGED')` | `id, display_name, status` |
| `users` | SELECT | `USING (true)` | `id, email_blind_index, status` |
| `credentials` | SELECT, UPDATE | `USING (true)` / `WITH CHECK (true)` | SELECT: kolom hash & lock; UPDATE: `failed_attempts, locked_until` |
| `tenant_memberships` | SELECT, INSERT | `USING (status = 'ACTIVE')` / `WITH CHECK (status = 'ACTIVE')` | `id, tenant_id, user_id, status, joined_at` |
| `platform_role_assignments` | SELECT | `USING (revoked_at IS NULL)` | `user_id, role_code, revoked_at` |
| `auth_selection_tickets` | SELECT, INSERT, UPDATE | `USING (true)` | seluruh kolom |
| `sessions` | SELECT, INSERT, UPDATE | `USING (true)` / `WITH CHECK (context_kind IN ('TENANT','PLATFORM'))` | seluruh kolom kecuali tidak ada kolom personal |
| `refresh_tokens` | SELECT, INSERT, UPDATE | `USING (true)` | seluruh kolom |
| `user_invitations` | SELECT, UPDATE | `USING (true)` / `WITH CHECK (status IN ('ACCEPTED','EXPIRED'))` | kolom status, hash, tenant, expiry, `accepted_membership_id` |
| `invitation_roles` | SELECT | `USING (true)` | `tenant_id, invitation_id, role_id` |
| `tenant_member_profiles` | INSERT | `WITH CHECK (true)` | seluruh kolom |
| `user_role_assignments` | INSERT | `WITH CHECK (true)` | seluruh kolom |
| `audit_logs` | INSERT | `WITH CHECK (true)` | seluruh kolom |
| `tenant_notifications` | INSERT | `WITH CHECK (type IN ('SUPPORT_SESSION_STARTED','SUPPORT_SESSION_ENDED'))` | seluruh kolom |

Policy ini **permissive** dan hanya berlaku bagi role `app_auth_definer`; policy tenant untuk `app_user` tidak berubah. Integritas lintas tenant pada INSERT tetap dijaga composite FK `(tenant_id, …)`.

## 5. Test wajib (CI)

1. `app_user` pada setiap tabel §4 tanpa `app.current_tenant_id` → 0 baris / insert ditolak.
2. Setiap fungsi §3 dipanggil tanpa tenant context → mengembalikan data yang benar (membuktikan Opsi A bekerja).
3. `app_user` tidak dapat `SET ROLE app_auth_definer`; `app_auth_definer` tidak dapat login; tidak ada role runtime/auth dengan `rolbypassrls = true`.
4. Tidak ada fungsi `SECURITY DEFINER` di database yang tidak tercantum di §3; tidak ada policy `TO app_auth_definer` yang tidak tercantum di §4.
5. Test negatif per baris §3.
6. Fungsi tidak memuat `EXECUTE` dinamis (inspeksi `prosrc`) dan `proconfig` memuat `search_path`.

## 6. Change log

| Version | Date | Summary |
|---|---|---|
| 1.0 | 2026-09-16 | Register awal: model Opsi A, 15 fungsi, policy `TO app_auth_definer`, test CI |

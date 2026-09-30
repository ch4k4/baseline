---
title: "Data Protection and Field Encryption SSOT — UU PDP Baseline"
document_id: "DATA-PROTECTION-ENCRYPTION-SSOT"
version: "1.0"
status: "SUPERSEDED"
original_status: "Mandatory Engineering Baseline / Legal-DPO-Security Approval Pending"
superseded_by: "DATA_PROTECTION_ENCRYPTION_SSOT_v1.1.md"
superseded_date: "2026-09-16"
owner: "<DATA_PROTECTION_OWNER_PLACEHOLDER>"
last_updated: "2026-09-16"
jurisdiction: "Indonesia"
legal_baseline:
  - "Undang-Undang Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi"
  - "Peraturan Menteri Komunikasi dan Informatika Nomor 20 Tahun 2016 tentang Pelindungan Data Pribadi dalam Sistem Elektronik"
  - "Peraturan Pemerintah Nomor 71 Tahun 2019 tentang Penyelenggaraan Sistem dan Transaksi Elektronik"
related_ssot:
  - "INFRASTRUCTURE_SSOT_v1.2.md"
  - "GENERAL_FEATURE_BASE_SSOT_v1.2.md"
  - "ADR-001-SAAS-MULTI-TENANCY.md"
change_control: "Perubahan klasifikasi data, kewajiban enkripsi, algoritma, key hierarchy, exception, masking, logging, export, atau retention MUST diperbarui dan disetujui di dokumen ini sebelum implementasi."
---

> ⚠️ **SUPERSEDED — ARSIP, BUKAN DOKUMEN AKTIF.**
> Versi berlaku: [`DATA_PROTECTION_ENCRYPTION_SSOT_v1.1.md`](./DATA_PROTECTION_ENCRYPTION_SSOT_v1.1.md). Lihat `DOCUMENT_VERSION_INDEX.md`.
> Isi dan referensi versi di bawah bersifat historis dan **tidak boleh** dijadikan dasar implementasi, ticket, atau review.

# Data Protection and Field Encryption SSOT v1.0

## 1. Purpose dan batas keputusan

Dokumen ini menetapkan aturan teknis minimum untuk mengklasifikasikan dan mengenkripsi field yang mengandung Data Pribadi dalam platform SaaS multi-tenant.

Dokumen ini adalah **engineering control baseline**, bukan pendapat hukum dan bukan bukti kepatuhan UU PDP. Legal/DPO, Security, Privacy, dan pemilik domain wajib memvalidasi dasar pemrosesan, tujuan, minimisasi, retention, transfer, hak subjek data, dan aturan sektoral sebelum production.

> **Aturan utama:** setiap field baru wajib terdaftar pada Data Field Register dan memperoleh klasifikasi sebelum migration atau API contract disetujui. Field tanpa klasifikasi tidak boleh masuk production.

## 2. Dasar regulasi terverifikasi

Baseline diverifikasi pada 2026-09-16 terhadap sumber resmi:

1. [UU Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi](https://jdih.komdigi.go.id/produk_hukum/view/id/832/t/undangundang%2Bnomor%2B27%2Btahun%2B) membagi Data Pribadi menjadi data yang bersifat spesifik dan umum. Data spesifik mencakup kesehatan, biometrik, genetika, catatan kejahatan, data anak, dan data keuangan pribadi. Data umum mencakup nama lengkap, jenis kelamin, kewarganegaraan, agama, status perkawinan, serta kombinasi data yang dapat mengidentifikasi seseorang.
2. Pasal 34 UU PDP mengategorikan antara lain pemrosesan data spesifik, skala besar, pencocokan data, evaluasi/penskoran/pemantauan sistematis, teknologi baru, dan keputusan otomatis berdampak signifikan sebagai pemrosesan berisiko tinggi yang memerlukan penilaian dampak.
3. Pasal 35–39 UU PDP mewajibkan langkah teknis operasional berdasarkan sifat dan risiko data, menjaga kerahasiaan, melindungi dari pemrosesan tidak sah, dan mencegah akses tidak sah melalui sistem elektronik yang andal, aman, dan bertanggung jawab.
4. [Permenkominfo Nomor 20 Tahun 2016](https://jdih.komdigi.go.id/produk_hukum/view/id/553/t/peraturan%2Bmenteri%2Bkomunikasi%2Bdan%2Binformatika%2Bnomor%2B20%2Btahun%2B2016%2Btanggal%2B1%2Bdesember%2B2016) berstatus `BERLAKU` pada JDIH Komdigi saat verifikasi dan Pasal 15 ayat (2) menyatakan Data Pribadi yang disimpan dalam Sistem Elektronik harus dalam bentuk data terenkripsi.
5. [PP Nomor 71 Tahun 2019](https://jdih.komdigi.go.id/produk_hukum/view/id/695/t/common) mewajibkan pemrosesan melindungi Data Pribadi dari kehilangan, penyalahgunaan, akses/pengungkapan tidak sah, pengubahan, atau perusakan.

UU PDP tidak menentukan algoritma tertentu dan tidak memberikan daftar nama kolom database yang harus dienkripsi. Matriks dalam dokumen ini merupakan keputusan kontrol berbasis risiko yang menerjemahkan kewajiban tersebut ke arsitektur platform.

Aturan pelaksana dan regulasi sektoral dapat berubah. Legal/DPO wajib melakukan regulatory refresh sebelum production dan minimal setiap tahun atau saat ada perubahan peraturan.

## 3. Model perlindungan berlapis

Encryption control tidak boleh hanya mengandalkan satu lapisan.

| Layer | Scope | Requirement |
|---|---|---|
| Transport encryption | Browser, API, service, database, object storage, integration | TLS wajib; plaintext network dilarang di luar isolated local development |
| Infrastructure encryption at rest | Database volume, replica, snapshot, backup, object storage, log store, search storage | Wajib untuk seluruh storage yang dapat berisi Data Pribadi |
| Application field-level encryption | Field dengan direct identifier, specific/high-risk personal data, secret retrievable, dan free text berisiko | Wajib sesuai matriks bagian 6 |
| Hashing | Password, one-time token, recovery token, token yang tidak perlu dipulihkan | Wajib one-way; encryption reversible tidak digunakan |
| Tokenization | Payment instrument atau identifier yang diproses provider | Diprioritaskan; raw sensitive payment data tidak disimpan bila tidak diperlukan |
| Pseudonymization | Analytics, telemetry, model/evaluation dataset | Wajib bila identitas langsung tidak diperlukan |
| Access control and audit | Semua data | Tetap wajib; encryption bukan pengganti authorization, tenant isolation, atau audit |

## 4. Klasifikasi field

### DP-0 — Non-personal/public technical data

Data yang tidak mengidentifikasi orang dan tidak menjadi personal setelah dikombinasikan dalam context penggunaan.

Contoh: permission code, workflow definition code, country code, system version, non-personal product catalog.

Control: infrastructure encryption at rest; field-level encryption tidak wajib.

### DP-1 — Data Pribadi umum

Data umum berdasarkan UU PDP atau data yang sendiri/dikombinasikan dapat mengidentifikasi orang.

Contoh: nama lengkap, jenis kelamin, kewarganegaraan, agama, status perkawinan, email pribadi, nomor telepon, tanggal lahir, alamat, IP address yang dikaitkan dengan user.

Control: infrastructure encryption at rest wajib. Direct identifier dan contact/location field pada matriks bagian 6 wajib field-level encryption. DP-1 lain mengikuti matriks dan DPIA/risk assessment.

### DP-2 — Data Pribadi spesifik/high-risk

Data kesehatan, biometrik, genetika, catatan kejahatan, data anak, data keuangan pribadi, atau kategori lain yang ditetapkan peraturan; termasuk dokumen/derived data yang mengungkap kategori tersebut.

Control: field-level/application-envelope encryption wajib, strict authorization, masking, purpose limitation, audit, dan DPIA sebelum production processing.

### DP-3 — Secret dan authentication material

Password, session secret, refresh token, recovery token, MFA seed, API credential, private key, OAuth token, encryption key.

Control: hash bila tidak perlu dipulihkan; KMS/HSM-backed encryption atau secret manager bila harus dipulihkan. Tidak boleh masuk log, analytics, audit payload, export umum, atau database plaintext.

### DP-4 — Prohibited storage

Data yang tidak boleh disimpan oleh platform dalam bentuk apa pun tanpa approved architecture/legal scope.

Baseline:

- plaintext password;
- PIN autentikasi;
- CVV/CVC kartu pembayaran;
- full payment-card magnetic stripe/track data;
- raw encryption master key di database/source/config biasa;
- secret/token di log atau audit diff;
- sensitive production data dalam test fixture lokal atau source control.

## 5. Arti “wajib dienkripsi”

Dalam dokumen ini:

- **Storage encryption wajib** berarti database, snapshot, backup, object storage, search storage, dan replica menggunakan encryption at rest yang dikelola serta dapat dibuktikan.
- **Field-level encryption wajib** berarti nilai dienkripsi oleh application/approved encryption service sebelum dikirim sebagai plaintext ke persistent data store.
- **Object-level encryption wajib** berarti file dienkripsi dengan managed key; dokumen DP-2 menggunakan application envelope encryption sebelum object persistence jika threat model mensyaratkan storage administrator isolation.
- **Hash wajib** berarti nilai tidak perlu dipulihkan dan disimpan menggunakan password hashing atau keyed cryptographic hash sesuai jenisnya.

Encryption di disk/database saja tidak memenuhi kewajiban field-level pada matriks berikut karena database dump, privileged SQL access, accidental query, dan cross-tenant defect masih dapat mengekspos plaintext.

## 6. Matriks field wajib

### 6.1 Identitas langsung dan dokumen resmi

| Field/jenis data | Contoh column | Class | Mandatory protection | Search/display rule |
|---|---|---:|---|---|
| Nama lengkap/legal name | `full_name` | DP-1 | Field encryption | Decrypt only for authorized view; blind index/token untuk exact lookup |
| Nama ibu kandung/security identity answer | `mother_maiden_name` | DP-1 high-risk | Field encryption; dilarang sebagai reusable authentication secret | No broad search; masked |
| NIK/nomor identitas nasional | `national_id_number` | DP-1 high-risk | Field encryption | Keyed blind index for exact duplicate check; masked display |
| Nomor KK | `family_card_number` | DP-1 high-risk | Field encryption | Exact lookup only via blind index; masked |
| Passport/visa/residence permit | `passport_number`, `permit_number` | DP-1 high-risk | Field encryption | Blind index if lookup required; masked |
| NPWP/tax identifier | `tax_id_number` | DP-1 high-risk | Field encryption | Blind index if lookup required; masked |
| Driver/professional/license number | `license_number` | DP-1 high-risk | Field encryption | Scoped blind index; masked |
| Tanggal dan tempat lahir | `date_of_birth`, `place_of_birth` | DP-1 | Field encryption | Derived age band may be separate DP-1 field; minimize display |
| Tanda tangan | file/vector/`signature_blob` | DP-1 high-risk | Object/application encryption | No search; watermark/restricted download |
| Foto identitas dan scan dokumen | `identity_document_file_id` | DP-1 high-risk | Private object + application envelope encryption | Authorized temporary access only |

### 6.2 Contact, location, dan online identifier

| Field/jenis data | Contoh column | Class | Mandatory protection | Search/display rule |
|---|---|---:|---|---|
| Email pribadi | `email` | DP-1 | Field encryption | Normalized HMAC blind index for login/exact lookup; masked display where possible |
| Nomor telepon | `phone_number` | DP-1 | Field encryption | E.164-normalized blind index; masked display |
| Alamat lengkap | `address_line`, `postal_address` | DP-1 | Field encryption | Province/city/postal code may be separated if operationally required and risk-approved |
| Koordinat/lokasi presisi | `latitude`, `longitude`, `exact_location` | DP-1 high-risk | Field encryption | Coarse region/geohash only if purpose-approved |
| IP address terkait identity | `ip_address` | DP-1 contextual | Field encryption or keyed pseudonymization; retention bounded | Avoid full IP in general logs; truncate if sufficient |
| Device identifier/advertising ID | `device_identifier` | DP-1 contextual | Field encryption or keyed pseudonymization | Rotation and retention required |

### 6.3 Profil umum UU PDP

| Field/jenis data | Contoh column | Class | Mandatory protection |
|---|---|---:|---|
| Jenis kelamin | `gender` | DP-1 | Field encryption when linked to identifiable profile; aggregate may be plaintext only after approved anonymization |
| Kewarganegaraan | `nationality` | DP-1 | Field encryption when linked to identifiable profile |
| Agama/kepercayaan | `religion` | DP-1 high-impact context | Field encryption, restricted access, no general search/filter without approved purpose |
| Status perkawinan | `marital_status` | DP-1 | Field encryption when linked to identifiable profile |

### 6.4 Data Pribadi spesifik

| Category UU PDP | Contoh field/content | Class | Mandatory protection |
|---|---|---:|---|
| Kesehatan | diagnosis, kondisi, medication, lab, disability, medical history, clinical note | DP-2 | Field/application encryption; encrypted files; DPIA; strict purpose/RBAC/ABAC |
| Biometrik | fingerprint template, face embedding, voiceprint, iris template | DP-2 | Application encryption; biometric template preferred over raw; no general export |
| Genetika | sequence, genetic marker, inherited characteristic | DP-2 | Application encryption; separate restricted key purpose; DPIA |
| Catatan kejahatan | police/court/criminal record, watchlist status | DP-2 | Field/application encryption; restricted access and audit |
| Data anak | setiap personal field milik subjek anak | DP-2 | Field encryption regardless of otherwise DP-1 category; encrypted files; guardian/legal-basis controls |
| Keuangan pribadi | bank account, balance, salary, income, tax detail, credit score, debt, personal transaction | DP-2 | Field encryption/tokenization; masking; high-risk export control |
| Derived sensitive profile | risk score, eligibility score, inferred health/financial/religious profile | DP-2 | Field encryption; DPIA; decision transparency and access restriction |

### 6.5 Authentication, security, dan integration fields

| Field/jenis data | Storage rule | Notes |
|---|---|---|
| Password | Adaptive salted password hash; default Argon2id, parameters verified at implementation | Never reversible encryption; never logged |
| Password reset/email verification/one-time token | Store keyed hash only | Raw token shown/sent once; short TTL; single use |
| Refresh/session token | Store keyed hash when equality validation is sufficient | If token material must be retrieved, encrypt with KMS and justify |
| MFA recovery code | Salted/keyed hash | Single-use and audited |
| TOTP seed | Field encryption with dedicated key purpose | Restricted decrypt path; never returned after enrollment |
| WebAuthn credential | Public key may be plaintext; credential metadata classified | Private key remains authenticator-side |
| OAuth access/refresh token | Field encryption with dedicated integration key | Scope minimization, expiry, rotation, revocation |
| API key | Store prefix + keyed hash when validation only | Raw value returned once; if outbound credential, use secret manager/encryption |
| Client secret/private key | Secret manager or KMS/HSM-backed encryption | Never ordinary database plaintext |
| Encryption DEK/KEK | Wrapped DEK only; KEK in KMS/HSM | Raw key never stored beside ciphertext |

### 6.6 Free text, forms, comments, and audit

| Surface | Rule |
|---|---|
| Free-text notes | Default message must prohibit unnecessary personal/sensitive data. If purpose permits DP-1/DP-2, encrypt entire field and apply access/audit controls. |
| Dynamic form response | Each form field requires classification; DP-1/DP-2 value encrypted individually or submission payload encrypted with approved searchable metadata separated. |
| Comments/messages | Treat as potential DP-1; encrypt content at field level if user may enter personal data. Do not expose to global search by default. |
| Audit `changes_json` | Do not store raw DP-1/DP-2. Store field name, classification, action, and masked/hash reference. Approved exception must encrypt payload with restricted audit key. |
| Application logs | Raw DP-1/DP-2/DP-3 prohibited. Use opaque IDs, tenant ID, request ID, error code, and redacted metadata. |
| Analytics/events | Direct identifiers prohibited unless separately approved; use per-purpose pseudonymous subject ID. |
| Search index | Raw DP-2 prohibited by default. DP-1 only with approved encrypted/tokenized index and tenant filter. |

## 7. Field yang tidak perlu field-level encryption

Field berikut dapat disimpan tanpa application field encryption apabila tidak mengandung/menurunkan Data Pribadi dan infrastructure encryption at rest aktif:

- opaque UUID seperti `tenant_id`, `record_id`, `workflow_id`;
- timestamps operasional seperti `created_at` dan `updated_at`;
- state/status teknis;
- permission code dan role code;
- reference-data code non-personal;
- aggregate metric yang telah lolos anonymization/re-identification assessment;
- ciphertext metadata seperti nonce, algorithm identifier, dan key version.

Opaque ID tetap dapat menjadi personal data dalam context tertentu. ID tidak boleh diekspor, dicatat, atau dibagikan tanpa purpose/access control hanya karena tidak dienkripsi pada kolomnya.

## 8. Cryptographic baseline

### 8.1 Application field encryption

Baseline:

```text
Algorithm       : AES-256-GCM authenticated encryption
Nonce           : unique random 96-bit nonce per encryption operation
Key model       : envelope encryption
Key hierarchy   : platform KEK in KMS/HSM -> tenant/purpose DEK -> field ciphertext
AAD             : tenant_id + module/table + field + stable record_id + schema version
Key version     : stored with ciphertext
```

Authenticated decryption failure harus fail-closed dan menghasilkan security telemetry tanpa mencatat plaintext/ciphertext penuh.

Alternative algorithm hanya boleh melalui cryptographic review dan perubahan SSOT. Library implementasi harus merupakan maintained, reviewed library; custom cryptography dilarang.

### 8.2 Equality search

Randomized encryption tidak boleh diganti deterministic encryption hanya untuk mempermudah pencarian. Exact lookup menggunakan keyed blind index:

```text
normalized_value
  -> HMAC-SHA-256 with dedicated blind-index key
  -> tenant-scoped blind index
```

Rules:

- blind-index key berbeda dari encryption key;
- input normalization ditetapkan per field;
- tenant identifier dimasukkan dalam input/key scope;
- blind index hanya mendukung use case yang disetujui;
- low-entropy value seperti gender/agama tidak boleh diberi blind index karena mudah ditebak;
- prefix/fuzzy search atas encrypted field tidak tersedia secara default;
- search requirement baru memerlukan privacy/security design review.

### 8.3 Password dan token

- Password memakai Argon2id atau approved adaptive password-hashing algorithm, unique salt, parameter version, dan optional server-side pepper di secret manager.
- Exact parameters harus diverifikasi terhadap standard/security guidance yang berlaku saat implementasi dan diuji agar sesuai performance/security target.
- High-entropy token yang hanya perlu divalidasi disimpan sebagai keyed hash, bukan encrypted plaintext.

## 9. Multi-tenant key management

- Setiap tenant memiliki logical DEK separation; key dapat dipisah lagi per purpose (`identity`, `specific_data`, `files`, `integration`, `audit`).
- DEK disimpan hanya dalam bentuk wrapped/encrypted oleh KEK pada KMS/HSM.
- KEK dan raw DEK tidak boleh berada dalam database yang sama sebagai plaintext, source code, image, `.env`, ticket, atau log.
- Application runtime memperoleh decrypt capability melalui workload identity/short-lived credential, bukan static master key.
- Key access menerapkan least privilege dan menghasilkan immutable audit event.
- Non-production menggunakan key terpisah dan tidak boleh mengakses production ciphertext/key.
- Tenant key reference tidak boleh berasal dari arbitrary request input; diperoleh dari verified tenant context.
- Key rotation harus mendukung decrypt old version dan encrypt new version selama controlled migration.
- Key deletion/crypto-shredding hanya dilakukan setelah retention, legal hold, backup, incident, dan approval checks.

## 10. Suggested persistence pattern

Contoh logical fields:

```text
email_ciphertext
email_nonce
email_key_version
email_blind_index
```

Atau satu versioned envelope:

```json
{
  "v": 1,
  "alg": "A256GCM",
  "kid": "tenant-purpose-key-version",
  "nonce": "base64url",
  "ciphertext": "base64url",
  "tag": "base64url"
}
```

Database constraint wajib memastikan encrypted envelope/metadata lengkap. Ciphertext tidak boleh digunakan sebagai business identifier. Field encryption/decryption hanya dilakukan pada dedicated crypto service/adapter, bukan tersebar di controller atau repository individual.

## 11. API, UI, export, dan integration rules

- API tidak pernah mengembalikan ciphertext sebagai pengganti authorization.
- Response hanya mendekripsi field yang dibutuhkan untuk purpose dan diizinkan permission/resource policy.
- List endpoint memakai masked/minimal field; full detail memerlukan endpoint/permission yang sesuai.
- UI tidak menyimpan decrypted DP-1/DP-2 di persistent browser storage, URL, analytics, error report, atau console.
- Export DP-1/DP-2 memerlukan explicit permission, purpose, tenant scope, row/field minimization, audit, expiring encrypted artifact, dan secure delivery.
- Integration hanya menerima field yang diperlukan oleh contract dan dasar pemrosesan; transfer dicatat pada processing inventory.
- Webhook yang membawa DP-1/DP-2 menggunakan TLS, signature, replay protection, payload minimization, destination allowlist, dan documented recipient controls.
- Support/debug tooling menggunakan masking by default dan audited reveal bila benar-benar diperlukan.

## 12. Backup, replica, test, dan analytics

- Database backup, WAL/archive, replica, snapshot, object backup, dan disaster-recovery copy wajib encrypted dengan managed keys.
- Backup key lifecycle tidak boleh membuat recovery mustahil selama retention.
- Restore test harus membuktikan encrypted field dan key-version resolution bekerja.
- Production personal data dilarang disalin ke development/test. Test memakai synthetic data.
- Jika exceptional masked production dataset dibutuhkan, harus ada approved process dan re-identification test; masking sederhana bukan otomatis anonymization.
- Analytics menggunakan pseudonymous subject ID dan dataset minimization; lookup map terpisah dan dienkripsi.

## 13. Data Field Register — mandatory schema

Setiap field personal/sensitive wajib didaftarkan dengan atribut:

| Attribute | Description |
|---|---|
| `module` | Owning module |
| `table_or_store` | Database table, object collection, search index, log, cache, queue |
| `field_or_payload_path` | Exact column/path |
| `description` | Business meaning |
| `data_subject` | Customer, employee, child, supplier contact, etc. |
| `pdp_category` | General/specific/not personal |
| `classification` | DP-0/DP-1/DP-2/DP-3/DP-4 |
| `purpose` | Approved processing purpose |
| `legal_basis_owner` | Owner responsible for confirming legal basis |
| `required` | Whether collection is mandatory and why |
| `encryption_layer` | Storage/field/object/hash/tokenization |
| `key_purpose` | Identity, specific data, integration, etc. |
| `search_requirement` | None/exact/range/fuzzy and justification |
| `blind_index` | Algorithm/normalization if applicable |
| `masking_rule` | UI/API/log/export masking |
| `authorized_roles` | Backend permission/policy |
| `retention` | Duration/event and source |
| `deletion_or_purge` | Method and legal-hold behavior |
| `export_allowed` | Yes/no and required approval |
| `processor_or_recipient` | Third party/region if any |
| `dpia_required` | Yes/no and reference |
| `owner` | Accountable role |

Migration review harus gagal bila field baru yang berpotensi personal tidak memiliki register entry.

## 14. Exception process

Exception terhadap field-level encryption hanya dapat diberikan jika:

1. field dan purpose terdaftar;
2. threat/risk assessment menjelaskan alasan encryption tidak feasible atau tidak menurunkan risiko;
3. alternative controls terdokumentasi;
4. scope dan expiry date ditentukan;
5. Legal/DPO, Security, pemilik data/domain, dan Technical Approver menyetujui sesuai kewenangan;
6. exception dicatat dan direview sebelum expiry.

Performance atau kemudahan query saja bukan alasan yang cukup. Gunakan redesign, minimization, blind index, tokenization, atau separated derived field lebih dahulu.

## 15. Migration existing data

Jika plaintext data sudah ada:

```text
inventory -> classify -> backup/recovery plan -> add encrypted columns
-> dual-read controlled migration -> batch backfill -> verify
-> switch write/read -> remove plaintext access -> purge plaintext
-> rotate credentials/keys if exposure suspected -> audit evidence
```

Migration harus tenant-bounded, resumable, idempotent, rate-limited, dan memiliki reconciliation count/checksum. Plaintext tidak boleh masuk migration log atau error queue.

## 16. Test and acceptance criteria

Wajib lulus:

- field register coverage test;
- schema check untuk mandatory encrypted fields;
- encrypt/decrypt round-trip dan Unicode/boundary test;
- ciphertext berbeda untuk plaintext sama karena randomized nonce;
- AAD/tenant/table/field/record substitution gagal decryption;
- cross-tenant key use gagal;
- blind-index normalization dan tenant separation test;
- runtime database dump tidak memperlihatkan plaintext mandatory field;
- log, audit, error, trace, queue, cache, search, dan analytics leak test;
- unauthorized API/UI/export masking test;
- key rotation dan old-ciphertext compatibility test;
- KMS unavailable/failure path fail-closed;
- backup restore dan key recovery test;
- deletion/purge/legal-hold behavior test;
- test fixture/source-control secret and personal-data scan;
- penetration/security review untuk cryptographic boundary.

## 17. Definition of Done

Feature yang memproses Data Pribadi hanya DONE jika:

1. seluruh field telah masuk Data Field Register;
2. category, purpose, owner, retention, legal-basis owner, dan recipients terdokumentasi;
3. DP-1/DP-2/DP-3 menerapkan control sesuai matriks;
4. key purpose, AAD, rotation, failure mode, masking, dan search design ditetapkan;
5. tenant isolation dan per-tenant key separation diuji;
6. log/cache/search/queue/file/export/backup tidak menjadi plaintext bypass;
7. automated tests dan migration verification lulus;
8. DPIA tersedia untuk pemrosesan berisiko tinggi;
9. tidak ada unresolved critical/high security issue;
10. Legal/DPO, Security/Privacy, Technical, dan Operations approval diselesaikan sesuai scope sebelum production.

## 18. Approval record

| Role | Name | Decision | Date | Evidence |
|---|---|---|---|---|
| Product/Architecture Direction | `<REQUESTER_PLACEHOLDER>` | Require field-encryption policy | 2026-09-16 | This SSOT |
| Legal/DPO | `<LEGAL_DPO_PLACEHOLDER>` | Pending | — | — |
| Security/Privacy | `<SECURITY_PRIVACY_PLACEHOLDER>` | Pending | — | — |
| Technical | `<TECHNICAL_APPROVER_PLACEHOLDER>` | Pending | — | — |
| Operations | `<OPERATIONS_APPROVER_PLACEHOLDER>` | Pending | — | — |

Permintaan pembuatan aturan tidak boleh diperlakukan sebagai Legal/DPO, Security, atau production approval.

## 19. Change log

| Version | Date | Summary | Approval |
|---|---|---|---|
| 1.0 | 2026-09-16 | Initial UU PDP-aligned field classification, encryption matrix, key management, exception, and acceptance baseline | Product/architecture direction; specialist approvals pending |

## 20. Open decisions

- approved KMS/HSM provider dan data residency;
- final cryptographic library serta Prisma serialization pattern;
- key cache TTL dan workload identity mechanism;
- per-purpose DEK granularity dan rotation interval;
- sector-specific fields/regulations untuk setiap tenant/domain;
- retention matrix dan legal-hold authority;
- approved export encryption/container format;
- support/break-glass reveal workflow;
- exact Argon2id parameters;
- payment provider dan PCI DSS scope bila payment diproses;
- DPIA template dan approval workflow;
- regulatory refresh setelah aturan pelaksana UU PDP baru diterbitkan.


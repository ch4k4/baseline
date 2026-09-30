-- 0002_schema.sql
-- Dijalankan sebagai app_owner.
-- Slice 1: tenant, identitas global, membership, profil anggota, session, refresh token.
--
-- FASE 1: users.email masih PLAINTEXT. Enkripsi field + blind index masuk di
-- migrasi terpisah (0006) setelah isolasi terbukti hijau. Jangan tambahkan
-- kolom personal baru tanpa mendaftarkannya di Data Field Register.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------- platform-global

CREATE TABLE tenants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          VARCHAR(63)  NOT NULL UNIQUE,
  name          VARCHAR(255) NOT NULL,
  status        VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT tenants_status_ck
    CHECK (status IN ('PROVISIONING','ACTIVE','SUSPENDED','ARCHIVED'))
);

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(320) NOT NULL UNIQUE,   -- FASE 1: plaintext, diganti di 0006
  status        VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT users_status_ck
    CHECK (status IN ('ACTIVE','SUSPENDED','LOCKED','ARCHIVED'))
);

CREATE TABLE credentials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,                  -- argon2id, dihitung di aplikasi
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- tenant-owned

CREATE TABLE tenant_memberships (
  id            UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants (id),
  user_id       UUID NOT NULL REFERENCES users (id),
  status        VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT tenant_memberships_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT tenant_memberships_unique_user   UNIQUE (tenant_id, user_id),
  CONSTRAINT tenant_memberships_status_ck
    CHECK (status IN ('ACTIVE','SUSPENDED','ENDED'))
);

CREATE TABLE tenant_member_profiles (
  id            UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants (id),
  membership_id UUID NOT NULL,
  display_name  VARCHAR(255) NOT NULL,
  contact_email VARCHAR(320) NOT NULL,          -- FASE 1: plaintext, diganti di 0006
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT tenant_member_profiles_membership_key UNIQUE (tenant_id, membership_id),
  CONSTRAINT tenant_member_profiles_membership_fk
    FOREIGN KEY (tenant_id, membership_id)
    REFERENCES tenant_memberships (tenant_id, id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------- mixed-ownership

CREATE TABLE sessions (
  id                UUID NOT NULL DEFAULT gen_random_uuid(),
  context_kind      VARCHAR(10) NOT NULL,
  tenant_id         UUID NULL REFERENCES tenants (id),
  user_id           UUID NOT NULL REFERENCES users (id),
  membership_id     UUID NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  revoked_at        TIMESTAMPTZ NULL,
  revocation_reason VARCHAR(50) NULL,
  PRIMARY KEY (id),
  CONSTRAINT sessions_tenant_key UNIQUE (tenant_id, id),
  CONSTRAINT sessions_context_kind_ck
    CHECK (context_kind IN ('TENANT','PLATFORM')),
  CONSTRAINT sessions_tenant_presence_ck
    CHECK ((context_kind = 'TENANT') = (tenant_id IS NOT NULL)),
  CONSTRAINT sessions_membership_presence_ck
    CHECK ((context_kind = 'TENANT') = (membership_id IS NOT NULL)),
  -- MATCH SIMPLE: tidak dievaluasi untuk baris PLATFORM (tenant_id NULL).
  CONSTRAINT sessions_membership_fk
    FOREIGN KEY (tenant_id, membership_id)
    REFERENCES tenant_memberships (tenant_id, id)
);

CREATE TABLE refresh_tokens (
  id             UUID NOT NULL DEFAULT gen_random_uuid(),
  context_kind   VARCHAR(10) NOT NULL,
  tenant_id      UUID NULL REFERENCES tenants (id),
  session_id     UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  token_hash     BYTEA NOT NULL,
  family_id      UUID NOT NULL,
  issued_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  rotated_at     TIMESTAMPTZ NULL,
  revoked_at     TIMESTAMPTZ NULL,
  replaced_by_id UUID NULL REFERENCES refresh_tokens (id),
  PRIMARY KEY (id),
  CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash),
  CONSTRAINT refresh_tokens_context_kind_ck
    CHECK (context_kind IN ('TENANT','PLATFORM')),
  CONSTRAINT refresh_tokens_tenant_presence_ck
    CHECK ((context_kind = 'TENANT') = (tenant_id IS NOT NULL)),
  CONSTRAINT refresh_tokens_session_tenant_fk
    FOREIGN KEY (tenant_id, session_id)
    REFERENCES sessions (tenant_id, id)
);

CREATE INDEX sessions_user_idx          ON sessions (user_id);
CREATE INDEX sessions_tenant_idx        ON sessions (tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX refresh_tokens_session_idx ON refresh_tokens (session_id);
CREATE INDEX refresh_tokens_family_idx  ON refresh_tokens (family_id);
CREATE INDEX memberships_user_idx       ON tenant_memberships (user_id);

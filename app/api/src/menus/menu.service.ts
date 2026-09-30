import { Injectable } from '@nestjs/common';
import { Tx, UnitOfWork } from '../database/unit-of-work.js';
import { PermissionService } from '../authz/permission.service.js';
import { ResolvedSession } from '../auth/pre-context.repository.js';
import { SupportRequest } from '../database/support-context.js';
import { supportPermissions } from '../support/support-permissions.js';

/**
 * Resolver menu efektif (DEMO-0403, Demo Foundation sec.10.1).
 *
 * Yang dihitung di sini adalah jawaban atas satu pertanyaan: menu apa saja yang
 * boleh DILIHAT session ini. Sebelum slice ini, jawabannya hanya ada di kode
 * frontend berupa daftar tetap yang disaring permission - artinya tidak ada satu
 * tempat pun yang dapat menjawabnya tanpa membuka berkas React.
 *
 * TIGA HAL YANG TIDAK DILAKUKAN DI SINI, dan itu disengaja:
 *
 *   1. tidak ada peta nama role -> menu. Yang dibaca adalah permission efektif
 *      (Demo Foundation sec.10.2 baris terakhir: resolver memakai effective
 *      permission backend, bukan klaim frontend);
 *   2. tidak ada cache. Hak yang baru dicabut harus hilang dari navigasi pada
 *      permintaan berikutnya, dan cache menukar sifat itu dengan satu query;
 *   3. tidak ada kode permission di keluaran. Navigasi adalah petunjuk tampilan;
 *      membocorkan peta hak akses lewatnya memberi penyerang daftar yang justru
 *      disembunyikan respons 403 (lihat AccessGuard).
 *
 * BATAS YANG PERLU DIKATAKAN TERUS TERANG: menu yang tersembunyi BUKAN kontrol
 * akses. Yang menolak tetap guard di setiap route; resolver ini hanya menentukan
 * apa yang pantas ditawarkan. Tes membuktikan keduanya terpisah.
 */

interface MenuRow {
  id: string;
  parent_id: string | null;
  code: string;
  label: string;
  path: string | null;
  icon: string | null;
  sort_order: number;
  is_public_authenticated: boolean;
}

interface MappingRow {
  menu_id: string;
  permission_code: string;
  match_mode: 'ANY' | 'ALL';
}

/** DTO minimal yang dikirim ke layar. Tanpa id, tanpa permission, tanpa urutan mentah. */
export interface MenuItem {
  code: string;
  label: string;
  path: string | null;
  icon: string | null;
  children: MenuItem[];
}

@Injectable()
export class MenuService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly permissions: PermissionService,
  ) {}

  /**
   * Satu pintu untuk ketiga context. Yang berbeda hanya DARI MANA permission
   * datang dan transaksi mana yang dibuka; penyaringan barisnya dikerjakan RLS
   * (policy per context di migrasi 0021), bukan klausa WHERE di sini - sehingga
   * kode yang keliru tidak dapat meminta menu konsol platform dari session tenant.
   */
  async forSession(session: ResolvedSession, support?: SupportRequest): Promise<MenuItem[]> {
    if (session.context_kind === 'PLATFORM') {
      const hak = await this.permissions.platformEffective(session.user_id);
      return this.uow.withPlatform((tx) => this.resolve(tx, hak));
    }

    const tenantId = session.tenant_id as string;
    const hak =
      session.context_kind === 'SUPPORT'
        ? supportPermissions(support!.scope)
        : await this.permissions.effective(tenantId, session.membership_id as string);

    return this.uow.withTenant(tenantId, (tx) => this.resolve(tx, hak));
  }

  private async resolve(tx: Tx, hak: ReadonlySet<string>): Promise<MenuItem[]> {
    const baris = await tx.query<MenuRow>(
      `SELECT id, parent_id, code, label, path, icon, sort_order, is_public_authenticated
       FROM menus
       WHERE is_active = true
       ORDER BY sort_order, code`,
    );
    const pemetaan = await tx.query<MappingRow>(
      `SELECT menu_id, permission_code, match_mode FROM menu_permissions`,
    );

    const peta = new Map<string, MappingRow[]>();
    for (const m of pemetaan) {
      const daftar = peta.get(m.menu_id) ?? [];
      daftar.push(m);
      peta.set(m.menu_id, daftar);
    }

    const anak = new Map<string | null, MenuRow[]>();
    for (const m of baris) {
      const daftar = anak.get(m.parent_id) ?? [];
      daftar.push(m);
      anak.set(m.parent_id, daftar);
    }

    /**
     * Apakah permission menu ini terpenuhi.
     *
     * Deny-by-default (sec.10.2): menu tanpa pemetaan TIDAK terlihat, kecuali
     * ditandai terbuka bagi session sah. `ALL` didukung dan diuji; tanpa tes ia
     * hanya akan menjadi nilai yang tampak berfungsi.
     */
    const lolosPermission = (m: MenuRow): boolean => {
      const daftar = peta.get(m.id) ?? [];
      if (daftar.length === 0) return m.is_public_authenticated;
      const mode = daftar[0].match_mode;
      return mode === 'ALL'
        ? daftar.every((p) => hak.has(p.permission_code))
        : daftar.some((p) => hak.has(p.permission_code));
    };

    /**
     * Pemangkasan (sec.10.1 butir 6). Aturannya berbeda untuk dua bentuk menu, dan
     * perbedaan itu bukan kelonggaran:
     *
     *   - menu BER-ROUTE adalah sesuatu yang dapat dibuka, jadi ia tunduk pada
     *     deny-by-default;
     *   - menu TANPA route hanyalah label grup - tidak ada yang dapat dibuka
     *     darinya, jadi tidak ada yang perlu ditolak. Ia muncul bila punya anak
     *     yang terlihat, dan hilang bila tidak. Itulah yang membuat anggota tanpa
     *     hak administrasi tidak melihat grup "Administrasi" yang kosong.
     *
     * Grup yang PUNYA pemetaan permission tetap tunduk padanya: pemetaan adalah
     * pembatasan yang dinyatakan eksplisit, dan ia menyembunyikan seluruh cabang.
     */
    const bangun = (induk: string | null): MenuItem[] => {
      const hasil: MenuItem[] = [];
      for (const m of anak.get(induk) ?? []) {
        if (!lolosPermission(m) && (m.path !== null || (peta.get(m.id) ?? []).length > 0)) continue;
        const cucu = bangun(m.id);
        if (m.path === null && cucu.length === 0) continue;
        hasil.push({ code: m.code, label: m.label, path: m.path, icon: m.icon, children: cucu });
      }
      return hasil;
    };

    return bangun(null);
  }
}

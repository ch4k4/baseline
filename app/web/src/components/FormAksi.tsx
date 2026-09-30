'use client';

import { useActionState } from 'react';
import { PESAN_SUKSES } from '@/lib/pesan';

/**
 * Formulir yang menampilkan hasilnya DI TEMPAT, bukan lewat alamat halaman.
 *
 * Kenapa ada: rancangan pertama slice 12 memantulkan hasil setiap aksi ke
 * halaman yang sama sebagai query (`?gagal=...`). Itu terlihat rapi dan bekerja
 * sekali - tetapi setelah satu pantulan seperti itu, pengiriman BERIKUTNYA dari
 * formulir yang sama tidak lagi berpindah halaman: datanya tersimpan di server,
 * sementara layar tetap menampilkan pesan yang lama. Orang mengira gagal, lalu
 * mengirim ulang. Ditemukan tes browser slice 12 #7 (D-26).
 *
 * `useActionState` adalah jalur yang disediakan React untuk ini: aksi
 * MENGEMBALIKAN hasilnya, bukan mengalihkan halaman, dan React merendernya.
 * Formulirnya tetap berjalan tanpa JavaScript (progressive enhancement Next),
 * jadi tidak ada yang hilang dibanding form server biasa.
 *
 * Pengalihan tetap dipakai untuk hal yang memang berpindah tempat: 401 ke
 * perpanjangan, 403 ke /403, dan sukses yang memang membuka halaman lain.
 */

export interface HasilAksi {
  ok?: string;
  gagal?: string;
}

export default function FormAksi({
  aksi,
  children,
  className,
}: {
  aksi: (sebelumnya: HasilAksi | null, data: FormData) => Promise<HasilAksi | null>;
  children: React.ReactNode;
  className?: string;
}) {
  const [hasil, kirim, menunggu] = useActionState(aksi, null);

  return (
    <form action={kirim} className={className}>
      {hasil?.gagal && (
        <p className="error" role="alert" data-testid="pesan-gagal">
          {hasil.gagal}
        </p>
      )}
      {hasil?.ok && (
        <p className="notice" role="status" data-testid="pesan-sukses">
          {PESAN_SUKSES[hasil.ok] ?? 'Perubahan disimpan.'}
        </p>
      )}
      <fieldset disabled={menunggu} className="tanpa-bingkai">
        {children}
      </fieldset>
    </form>
  );
}

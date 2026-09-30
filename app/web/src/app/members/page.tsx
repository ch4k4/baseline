import { redirect } from 'next/navigation';

/**
 * Alamat lama halaman anggota. Sejak slice 12 struktur halaman mengikuti Demo
 * Foundation sec.12 (/administration/...), dan alamat ini tetap ada supaya
 * tautan, bookmark, dan catatan lama tidak mati.
 */
export default function MembersLama() {
  redirect('/administration/members');
}

---
name: process-management
description: Standar pengelolaan server background (dev server, API service) menggunakan tool process_manage secara terkontrol.
---

# Background Process Management

Skill ini mengatur siklus hidup background process agar tidak terjadi port collision, resource leak, atau proses zombie.

## Standard Lifecycle

1. **Check Existing (`action: list`)**:
   - Selalu cek proses aktif terlebih dahulu sebelum menjalankan server baru pada port yang sama.
2. **Start Process (`action: start`)**:
   - Gunakan `process_manage` dengan opsi `action="start"` dan command yang jelas.
   - Catat `processId` yang dikembalikan.
3. **Monitor / Health Check (`action: poll`)**:
   - Verifikasi log awal menggunakan `action="poll"` untuk memastikan server/service berhasil binding tanpa runtime crash.
4. **Cleanup / Teardown (`action: kill`)**:
   - Setelah tugas atau sesi pengujian selesai, hentikan service menggunakan `action="kill"` untuk melepaskan port dan sumber daya RAM.

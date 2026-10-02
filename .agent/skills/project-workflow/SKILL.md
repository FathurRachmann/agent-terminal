---
name: project-workflow
description: Otomatisasi alur kerja proyek internal, sinkronisasi codebase graphify, dan kepatuhan standar coding.
---

# Project Workflow

Skill ini mengotomatisasi panduan dan eksekusi standar kerja pada proyek lokal:

## Workflow Checklist
1. **Orientasi & Knowledge Graph**:
   - Selalu periksa status `graphify_status` sebelum melakukan refactor besar.
   - Jalankan `graphify_update` jika terjadi perubahan file atau penambahan modul baru.
2. **Koneksi Tooling & MCP**:
   - Gunakan tools native PTY/filesystem secara paralel jika tidak saling tergantung.
   - Manfaatkan MCP server yang terdaftar di `.agent/mcp.json` untuk integrasi eksternal.
3. **Standar Kode & Minimal Diff**:
   - Utamakan `edit_file` dengan diff minimal daripada rewrite total kecuali diminta refactor penuh.
   - Selalu verifikasi perubahan dengan `run_tests` atau build check sebelum menutup tugas.

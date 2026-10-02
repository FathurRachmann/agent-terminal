---
name: e2e-testing
description: Panduan penulisan skrip End-to-End (E2E) dan otomatisasi pengujian UI Regression menggunakan ekosistem browser.
---

# E2E & UI Regression Testing

Panduan standar pelaksanaan UI Regression Test pada proyek berbasis web (React, Nuxt, Vue, dsb).

## Pedoman Pelaksanaan E2E

1. **Trigger Testing Otomatis**:
   - Skrip tes harus dieksekusi setelah ada perubahan pada UI component, layout, atau handler formulir.
2. **Tooling & Headless Environment**:
   - Manfaatkan tool browser native (`browser_*`) atau Playwright.
   - Jangan gunakan hardcoded timeout (seperti `sleep 5000`); ganti dengan deteksi elemen deterministik atau network idle.
3. **Isolasi State & Teardown**:
   - Jangan gunakan database production atau staging utama untuk test data.
   - Kembalikan / bersihkan state test (teardown) segera setelah task E2E berakhir.
4. **Pelaporan**:
   - Simpulkan *diff UI* atau masalah *failed test* dalam ringkasan yang fokus (severity order).
   - Apabila screenshot error digunakan, laporkan analisis gambarnya secara komprehensif.

---
name: web-research-automation
description: "Alur kerja dan utilitas untuk web crawling, deep research, ekstraksi konten terstruktur, screenshot visual, dan sanitasi data."
---

# Web Research & Crawling Automation

Gunakan skill ini ketika melakukan riset mendalam di web, scraping data terstruktur, atau melakukan pemantauan informasi multi-sumber.

## Alur Kerja Riset Web & Crawling

1. **Discovery & Targeting**:
   - Tentukan target URL dan parameter riset (keyword, pagination, limit).
   - Manfaatkan tool browser native (`browser_*`) untuk situs dengan render JavaScript/SPA, atau `web_search`/`web_extract` untuk riset umum.

2. **Extraction & Sanitization**:
   - Bersihkan tag navigasi, ads, script, dan footer yang tidak relevan.
   - Gunakan helper script untuk mengekstrak entitas kunci dari HTML/teks:
     ```bash
     python3 .agent/skills/web-research-automation/scripts/extract_data.py --input <file_html> --output <output.json>
     ```

3. **Structured Storage & Output**:
   - Simpan hasil riset dalam format JSON terstruktur atau Markdown tabel yang ringkas dan informatif.
   - Sertakan URL sumber dan timestamp penarikan data.

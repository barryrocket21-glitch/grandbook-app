# Data Files (gitignored)

File data besar yang tidak di-commit ke git. Place file di sini sebelum run script.

## Required Files

### `Daftar_Kodepos.xlsx`
Master wilayah Indonesia (~82547 baris). Struktur sheet:
- Row 1-2: title/intro (skipped)
- Row 3: header (PROVINSI, KOTA/KABUPATEN, KECAMATAN, KELURAHAN, KODE POS)
- Row 4..end: data

Run import: `npm run import:wilayah`

Sumber: dataset publik kode pos Indonesia. File ini juga dipakai Mengantar.com.

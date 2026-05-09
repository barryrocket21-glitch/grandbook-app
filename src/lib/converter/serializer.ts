// =============================================================
// Serializer (Phase 3C)
// File-format-agnostic helpers to turn an array of row objects
// into a downloadable Blob, plus filename helpers + browser download.
// =============================================================
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import type { ConverterProfile } from '@/lib/types'

const UTF8_BOM = '﻿'

/**
 * Serialize rows to a CSV Blob. Honors `delimiter` (default ',') and
 * adds a UTF-8 BOM when `encoding` is utf-8-sig (Excel-friendly).
 */
export function serializeCsv(
  rows: Array<Record<string, unknown>>,
  headers: string[],
  delimiter: string = ',',
  encoding: string = 'utf-8'
): Blob {
  const csv = Papa.unparse(
    { fields: headers, data: rows.map((r) => headers.map((h) => stringifyCsvCell(r[h]))) },
    { delimiter }
  )
  const wantBom = encoding.toLowerCase() === 'utf-8-sig'
  const body = wantBom ? UTF8_BOM + csv : csv
  return new Blob([body], { type: 'text/csv;charset=utf-8' })
}

export function serializeXlsx(
  rows: Array<Record<string, unknown>>,
  headers: string[],
  sheetName: string = 'Orders'
): Blob {
  const data = rows.map((r) => headers.map((h) => stringifyXlsxCell(r[h])))
  const aoa = [headers, ...data]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/**
 * Triggers a browser download of the given Blob via a temporary <a> tag.
 * Safe to call from a click handler; no-op on the server.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

/**
 * Suggested filename per Phase 3C brief:
 * `{profile.code}_{YYYYMMDD}_{HHMMSS}.{ext}`
 */
export function suggestOutboundFilename(profile: ConverterProfile, at: Date = new Date()): string {
  const yyyy = at.getFullYear()
  const mm = pad(at.getMonth() + 1)
  const dd = pad(at.getDate())
  const hh = pad(at.getHours())
  const mi = pad(at.getMinutes())
  const ss = pad(at.getSeconds())
  const ext = profile.file_format === 'XLSX' ? 'xlsx' : 'csv'
  return `${profile.code}_${yyyy}${mm}${dd}_${hh}${mi}${ss}.${ext}`
}

/**
 * Build a Blob from already-resolved rows + headers using profile metadata.
 * Centralised so engine + UI never need to branch on file_format directly.
 */
export function serializeForProfile(
  profile: ConverterProfile,
  rows: Array<Record<string, unknown>>,
  headers: string[]
): Blob {
  if (profile.file_format === 'XLSX') {
    return serializeXlsx(rows, headers)
  }
  return serializeCsv(rows, headers, profile.file_delimiter || ',', profile.file_encoding || 'utf-8')
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function stringifyCsvCell(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function stringifyXlsxCell(v: unknown): unknown {
  if (v == null) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return v
}

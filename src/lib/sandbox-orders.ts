import type { AdaptedOrder } from '@/lib/converter/wa-paste-adapter'

export type SandboxCategory = 'GB_NO_RESI' | 'FIX_ORDER' | 'EXPORTED'

export interface SandboxOrder {
  id: string
  orderNumber: string
  orderDate: string
  spxCreatedAt: string | null
  createdAt: string
  exportedAt: string | null
  exportBatchId: string | null
  exportBatchLabel: string | null
  fulfillmentCategory: SandboxCategory
  customerName: string
  customerPhone: string | null
  customerAddress: string | null
  city: string | null
  province: string | null
  subdistrict: string | null
  zip: string | null
  wilayahId: number | null
  productName: string
  variation: string | null
  qty: number
  attributionCodeRaw: string | null
  csName: string | null
  total: number | null
  shippingCost: number | null
  codAmount: number | null
  trackingNo: string | null
  trackingStatus: string | null
}

export interface SandboxExportBatch {
  id: string
  sequence: number
  label: string
  exportedAt: string
  orderIds: string[]
  orderCount: number
}

const STORAGE_KEY = 'grandbook.sandbox.orders.v1'
const BATCH_STORAGE_KEY = 'grandbook.sandbox.export_batches.v1'

function todayCompact() {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function formatBatchDateTime(date: Date) {
  const d = `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()}`
  const t = `${String(date.getHours()).padStart(2, '0')}.${String(date.getMinutes()).padStart(2, '0')}.${String(date.getSeconds()).padStart(2, '0')}`
  return { d, t }
}

export function isSandboxMode() {
  return process.env.NEXT_PUBLIC_GRANDBOOK_STAGING_READONLY === '1'
}

export function loadSandboxOrders(): SandboxOrder[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveSandboxOrders(rows: SandboxOrder[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
}

export function loadSandboxBatches(): SandboxExportBatch[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(BATCH_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveSandboxBatches(rows: SandboxExportBatch[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(BATCH_STORAGE_KEY, JSON.stringify(rows))
}

export function clearSandboxOrders() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(STORAGE_KEY)
  window.localStorage.removeItem(BATCH_STORAGE_KEY)
}

export function addSandboxOrders(adapted: AdaptedOrder[]) {
  const existing = loadSandboxOrders()
  const date = todayCompact()
  const sameDateCount = existing.filter((o) => o.orderNumber.startsWith(`GB-SIM-${date}-`)).length
  const now = new Date().toISOString()
  const rows = adapted.map((a, index): SandboxOrder => {
    const seq = String(sameDateCount + index + 1).padStart(6, '0')
    const p = a.parsed
    return {
      id: `sim_${date}_${seq}_${Math.random().toString(36).slice(2, 8)}`,
      orderNumber: `GB-SIM-${date}-${seq}`,
      orderDate: todayIso(),
      spxCreatedAt: null,
      createdAt: now,
      exportedAt: null,
      exportBatchId: null,
      exportBatchLabel: null,
      fulfillmentCategory: 'GB_NO_RESI',
      customerName: p.nama,
      customerPhone: p.hp || null,
      customerAddress: p.alamat || null,
      city: p.kota,
      province: p.provinsi,
      subdistrict: p.kecamatan,
      zip: p.kodePos,
      wilayahId: null,
      productName: p.produk,
      variation: p.variation,
      qty: p.qty,
      attributionCodeRaw: p.atribusiCodeRaw,
      csName: p.csName,
      total: p.hargaProduk,
      shippingCost: p.ongkir,
      codAmount: p.hargaTotal,
      trackingNo: null,
      trackingStatus: null,
    }
  })
  saveSandboxOrders([...rows, ...existing])
  return rows
}

export function exportSandboxOrders(ids: string[]) {
  const selected = new Set(ids)
  const existingOrders = loadSandboxOrders()
  const selectedRows = existingOrders.filter((o) => selected.has(o.id))
  const freshRows = selectedRows.filter((o) => !o.exportBatchId)
  const existingBatches = loadSandboxBatches()
  const nowDate = new Date()
  const now = nowDate.toISOString()
  let nextBatch: SandboxExportBatch | null = null

  if (freshRows.length > 0) {
    const sequence = existingBatches.reduce((max, b) => Math.max(max, b.sequence), 0) + 1
    const { d, t } = formatBatchDateTime(nowDate)
    nextBatch = {
      id: `batch_${sequence}_${nowDate.getTime()}`,
      sequence,
      label: `Export ${sequence} (${d}) (${t}) (${freshRows.length} data)`,
      exportedAt: now,
      orderIds: freshRows.map((o) => o.id),
      orderCount: freshRows.length,
    }
  }

  const rows = existingOrders.map((o) => (
    selected.has(o.id)
      ? {
          ...o,
          exportedAt: o.exportedAt ?? now,
          exportBatchId: o.exportBatchId ?? nextBatch?.id ?? null,
          exportBatchLabel: o.exportBatchLabel ?? nextBatch?.label ?? null,
          fulfillmentCategory: o.fulfillmentCategory === 'GB_NO_RESI'
            ? 'EXPORTED' as SandboxCategory
            : o.fulfillmentCategory,
        }
      : o
  ))
  saveSandboxOrders(rows)
  if (nextBatch) saveSandboxBatches([nextBatch, ...existingBatches])
  return rows.filter((o) => selected.has(o.id))
}

export function getSandboxOrdersByBatch(batchId: string) {
  return loadSandboxOrders().filter((o) => o.exportBatchId === batchId)
}

export function updateSandboxOrderAddress(
  id: string,
  patch: Pick<SandboxOrder, 'province' | 'city' | 'subdistrict' | 'zip' | 'customerAddress' | 'wilayahId'>
) {
  const rows = loadSandboxOrders().map((o) => o.id === id ? { ...o, ...patch } : o)
  saveSandboxOrders(rows)
  return rows.find((o) => o.id === id) ?? null
}

function normalizeDuplicateKeyPart(value: unknown) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function findSandboxDuplicateWarnings(adapted: AdaptedOrder[]) {
  const existing = loadSandboxOrders()
  const existingKeys = new Map<string, SandboxOrder[]>()
  for (const row of existing) {
    const key = [row.customerName, row.customerPhone, row.productName, row.attributionCodeRaw]
      .map(normalizeDuplicateKeyPart)
      .join('|')
    if (!existingKeys.has(key)) existingKeys.set(key, [])
    existingKeys.get(key)!.push(row)
  }

  const warnings = adapted.flatMap((order, index) => {
    const p = order.parsed
    const key = [p.nama, p.hp, p.produk, p.atribusiCodeRaw]
      .map(normalizeDuplicateKeyPart)
      .join('|')
    const matches = existingKeys.get(key) ?? []
    if (matches.length === 0) return []
    return [{
      index,
      orderNumber: matches[0].orderNumber,
      message: `Order #${index + 1} kemungkinan duplikat ${matches[0].orderNumber}: nama, HP, produk, dan kode atribusi sama persis.`,
    }]
  })

  const seenInPaste = new Map<string, number>()
  adapted.forEach((order, index) => {
    const p = order.parsed
    const key = [p.nama, p.hp, p.produk, p.atribusiCodeRaw]
      .map(normalizeDuplicateKeyPart)
      .join('|')
    if (!p.nama || !p.hp || !p.produk || !p.atribusiCodeRaw) return
    const first = seenInPaste.get(key)
    if (first == null) {
      seenInPaste.set(key, index)
      return
    }
    warnings.push({
      index,
      orderNumber: `Order #${first + 1}`,
      message: `Order #${index + 1} duplikat dengan Order #${first + 1} di paste yang sama: nama, HP, produk, dan kode atribusi sama persis.`,
    })
  })

  return warnings
}

export interface SandboxSpxRow {
  ref: string
  trackingNo: string
  trackingStatus: string
  createTime?: string | null
}

export function applySandboxSpxRows(spxRows: SandboxSpxRow[]) {
  const byRef = new Map(spxRows.map((r) => [r.ref.trim(), r]))
  let fixed = 0
  let nonCoverage = 0
  const rows = loadSandboxOrders().map((o) => {
    if (!o.exportedAt) return o
    const hit = byRef.get(o.orderNumber)
    if (hit) {
      fixed += 1
      return {
        ...o,
        trackingNo: hit.trackingNo || o.trackingNo,
        trackingStatus: hit.trackingStatus || o.trackingStatus || 'In Transit',
        spxCreatedAt: hit.createTime || o.spxCreatedAt,
        fulfillmentCategory: 'FIX_ORDER' as SandboxCategory,
      }
    }
    if (o.fulfillmentCategory === 'EXPORTED') {
      nonCoverage += 1
      return { ...o, fulfillmentCategory: 'GB_NO_RESI' as SandboxCategory }
    }
    return o
  })
  saveSandboxOrders(rows)
  return { fixed, nonCoverage }
}

export function sandboxExportCsv(rows: SandboxOrder[]) {
  const headers = ['GB Referensi', 'Nama', 'No HP', 'Alamat', 'Produk', 'Kode Atribusi', 'CS', 'COD', 'Ongkir']
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [headers.map(esc).join(',')]
  for (const r of rows) {
    lines.push([
      r.orderNumber,
      r.customerName,
      r.customerPhone,
      r.customerAddress,
      r.productName,
      r.attributionCodeRaw,
      r.csName,
      r.codAmount,
      r.shippingCost,
    ].map(esc).join(','))
  }
  return lines.join('\n')
}

export function downloadTextFile(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

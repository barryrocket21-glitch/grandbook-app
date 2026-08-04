import type { ParsedAccountTxRow } from './spx-cashflow-parser'

export type SpxFinanceApiConfig = {
  businessEntity: number | string
  productLine: number | string
  bizAccountId: number | string
  startUnix: number
  endUnix: number
  offset: number
  size: number
}

export type SpxFinanceApiRow = Record<string, unknown>

const SPX_FINANCE_PATH = '/shipment/forward/account/api/spx_seller/seller_balance/transaction_list'

export function buildSpxFinanceTransactionUrl(config: SpxFinanceApiConfig): string {
  const params = new URLSearchParams({
    business_entity: String(config.businessEntity),
    product_line: String(config.productLine),
    biz_account_id: String(config.bizAccountId),
    tran_time_start: String(config.startUnix),
    tran_time_end: String(config.endUnix),
    offset: String(config.offset),
    size: String(config.size),
  })
  return `${SPX_FINANCE_PATH}?${params.toString()}`
}

export function toUnixStartOfDay(date: string): number {
  const d = new Date(`${date}T00:00:00+07:00`)
  return Math.floor(d.getTime() / 1000)
}

export function toUnixEndOfDay(date: string): number {
  const d = new Date(`${date}T23:59:59+07:00`)
  return Math.floor(d.getTime() / 1000)
}

export function unixToIso(value: unknown): string {
  const n = toNumber(value)
  if (!n) return ''
  const ms = n > 10_000_000_000 ? n : n * 1000
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

export function toNumber(value: unknown): number {
  if (value == null || value === '') return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const s = String(value).trim()
  if (!s || s === '-') return 0
  const n = Number(s.replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function text(value: unknown): string {
  if (value == null || value === '-') return ''
  return String(value).trim()
}

function pick(row: SpxFinanceApiRow, keys: string[]): unknown {
  for (const k of keys) {
    if (row[k] != null && row[k] !== '') return row[k]
  }
  return ''
}

function nestedNumber(row: SpxFinanceApiRow, key: string): number {
  const direct = toNumber(row[key])
  if (direct) return direct
  const extra = row.extra_data
  if (extra && typeof extra === 'object') {
    return toNumber((extra as Record<string, unknown>)[key])
  }
  return 0
}

export function spxTransactionTypeName(row: SpxFinanceApiRow): string {
  const raw = pick(row, ['tx_type', 'type_name', 'transaction_type_name', 'transaction_type', 'type'])
  const s = text(raw)
  if (/cod/i.test(s)) return 'COD'
  if (/ongkos|shipping|shipment|biaya kirim/i.test(s)) return 'Ongkos Kirim'
  if (/penarikan|withdraw|release|tarik/i.test(s)) return 'Penarikan'

  const n = toNumber(raw)
  if (n === 1) return 'COD'
  if (n === 2) return 'Ongkos Kirim'
  if (n === 4) return 'Penarikan'
  return s || 'Lainnya'
}

export function spxStatusName(value: unknown): string {
  const s = text(value)
  if (!s) return 'Berhasil'
  if (/berhasil|success|completed/i.test(s)) return 'Berhasil'
  if (/pending|process/i.test(s)) return 'Pending'
  if (/tolak|reject|fail/i.test(s)) return 'Ditolak'
  const n = toNumber(s)
  if (n === 3 || n === 1) return 'Berhasil'
  if (n === 2) return 'Pending'
  if (n === 4) return 'Ditolak'
  return s
}

export function normalizeSpxFinanceApiRows(apiRows: SpxFinanceApiRow[]): ParsedAccountTxRow[] {
  return apiRows.map((row): ParsedAccountTxRow => {
    const txType = spxTransactionTypeName(row)
    const status = spxStatusName(pick(row, ['status', 'transaction_status']))
    const tracking = txType === 'Penarikan' ? '' : text(pick(row, ['tracking_number', 'tracking', 'awb', 'resi']))
    const externalId = text(pick(row, ['transaction_id', 'external_id', 'id'])) ||
      text(pick(row, ['biz_transaction_id', 'settlement_sn']))
    const completeTime = unixToIso(pick(row, ['complete_time', 'tran_time', 'update_time']))
    const createTime = unixToIso(pick(row, ['create_time', 'tran_time']))
    const nominal = toNumber(pick(row, ['amount', 'nominal', 'transaction_amount']))
    const basicShippingFee = nestedNumber(row, 'basic_shipping_fee')
    const codServiceFee = nestedNumber(row, 'cod_service_fee')
    const totalFee = nestedNumber(row, 'total_fee')

    return {
      external_id: externalId,
      tx_type: txType,
      tracking,
      update_time: unixToIso(pick(row, ['tran_time', 'update_time', 'complete_time'])),
      nominal,
      balance_before: toNumber(pick(row, ['balance_before', 'saldo_sebelum'])),
      balance_after: toNumber(pick(row, ['balance_after', 'saldo_sesudah'])),
      withdrawal_fee: toNumber(pick(row, ['withdraw_fee', 'withdrawal_fee', 'biaya_penarikan'])),
      net_received: toNumber(pick(row, ['withdraw_bank_transfer_amount', 'net_received', 'jumlah_transfer_bank_penarikan'])),
      status,
      bank_account: text(pick(row, ['bank_account', 'bank_reference', 'akun_bank_penarikan'])),
      reference_no: text(pick(row, ['transaction_reference_no', 'reference_no', 'settlement_sn'])),
      rejection_reason: text(pick(row, ['rejection_reason', 'alasan_penolakan_penarikan'])),
      create_time: createTime,
      complete_time: completeTime,
      raw: {
        ...row,
        'Biaya Ongkir Dasar': basicShippingFee,
        'Biaya COD': codServiceFee,
        'Total Fee SPX': totalFee,
      },
    }
  }).filter((row) => row.external_id)
}

export function extractSpxList(payload: unknown): SpxFinanceApiRow[] {
  if (!payload || typeof payload !== 'object') return []
  const obj = payload as Record<string, unknown>
  const candidates = [
    obj.list,
    obj.rows,
    obj.data,
    (obj.data as Record<string, unknown> | undefined)?.list,
    (obj.data as Record<string, unknown> | undefined)?.rows,
    (obj.data as Record<string, unknown> | undefined)?.transactions,
  ]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate as SpxFinanceApiRow[]
  }
  return []
}

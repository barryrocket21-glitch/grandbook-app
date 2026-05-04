/**
 * Format number to Indonesian Rupiah currency
 */
export function formatRupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

/**
 * Format number with thousands separator
 */
export function formatNumber(num: number, decimals = 0): string {
  return new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num)
}

/**
 * Format percentage
 */
export function formatPercent(num: number, decimals = 1): string {
  return `${num.toFixed(decimals)}%`
}

/**
 * Format date to Indonesian locale
 */
export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date))
}

/**
 * Format date time
 */
export function formatDateTime(date: string | Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date))
}

/**
 * Calculate ROAS (Return on Ad Spend)
 */
export function calculateROAS(revenue: number, spend: number): number {
  if (spend === 0) return 0
  return revenue / spend
}

/**
 * Calculate CPA (Cost per Acquisition)
 */
export function calculateCPA(spend: number, orders: number): number {
  if (orders === 0) return 0
  return spend / orders
}

/**
 * Calculate CTR (Click Through Rate)
 */
export function calculateCTR(clicks: number, impressions: number): number {
  if (impressions === 0) return 0
  return (clicks / impressions) * 100
}

/**
 * Calculate CPC (Cost per Click)
 */
export function calculateCPC(spend: number, clicks: number): number {
  if (clicks === 0) return 0
  return spend / clicks
}

/**
 * Calculate CPM (Cost per Mille/1000 impressions)
 */
export function calculateCPM(spend: number, impressions: number): number {
  if (impressions === 0) return 0
  return (spend / impressions) * 1000
}

/**
 * Get date range for today
 */
export function getToday(): string {
  return new Date().toISOString().split('T')[0]
}

/**
 * Get start of current week (Monday)
 */
export function getStartOfWeek(): string {
  const now = new Date()
  const day = now.getDay()
  const diff = now.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(now.setDate(diff))
  return monday.toISOString().split('T')[0]
}

/**
 * Get start of current month
 */
export function getStartOfMonth(): string {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
}

/**
 * Parse rupiah input string to number
 */
export function parseRupiahInput(value: string): number {
  return Number(value.replace(/[^0-9.-]+/g, '')) || 0
}

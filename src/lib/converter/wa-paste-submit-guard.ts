import type { AdaptedOrder } from './wa-paste-adapter'

export type WaPasteSubmitBlocker = {
  code: 'NO_CS' | 'UNMATCHED_CS'
  index: number
  message: string
}

export function getWaPasteSubmitBlockers(orders: AdaptedOrder[]): WaPasteSubmitBlocker[] {
  const blockers: WaPasteSubmitBlocker[] = []
  orders.forEach((order, index) => {
    const rawCs = String(order.parsed.csName ?? '').trim()
    if (!rawCs) {
      blockers.push({
        code: 'NO_CS',
        index,
        message: `Order #${index + 1}: CS kosong`,
      })
      return
    }
    if (!order.csMatched) {
      blockers.push({
        code: 'UNMATCHED_CS',
        index,
        message: `Order #${index + 1}: CS "${rawCs}" tidak match user GrandBook`,
      })
    }
  })
  return blockers
}

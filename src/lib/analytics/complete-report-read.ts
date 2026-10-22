type Page<T> = { data: T[] | null; error: { message: string } | null; count: number | null }

/** Read every page or fail: a successful partial financial report is invalid. */
export async function completeReportRead<T extends { id: number }>(
  fetchPage: (after: number) => PromiseLike<Page<T>>,
): Promise<T[]> {
  const rows: T[] = []
  let after = 0
  let expected: number | undefined
  for (;;) {
    const { data, error, count } = await fetchPage(after)
    if (error || !data || count === null || !Number.isSafeInteger(count) || count < 0) {
      throw new Error('Data laporan belum terbaca lengkap')
    }
    expected ??= count
    if (expected > 100000) throw new Error('Periode laporan terlalu besar')
    if (count !== expected - rows.length) throw new Error('Data laporan berubah selama pembacaan')
    if (!data.length) {
      if (rows.length !== expected) throw new Error('Data laporan belum terbaca lengkap')
      return rows
    }
    for (const row of data) {
      if (!Number.isSafeInteger(row.id) || row.id <= after) throw new Error('Identitas laporan tidak valid')
      rows.push(row)
      after = row.id
    }
    if (rows.length > expected) throw new Error('Jumlah data laporan tidak valid')
  }
}

export function assertReportRelations(
  orders: { id: number }[], items: { id: number; order_id: number }[],
  commissions: { order_id: number; order_item_id: number | null }[],
) {
  const orderIds = new Set(orders.map(row => row.id))
  const itemOrders = new Map(items.map(row => [row.id, row.order_id]))
  const covered = new Set(items.map(row => row.order_id))
  if (items.some(row => !orderIds.has(row.order_id)) || orders.some(row => !covered.has(row.id)) ||
      commissions.some(row => !orderIds.has(row.order_id) ||
        (row.order_item_id !== null && itemOrders.get(row.order_item_id) !== row.order_id))) {
    throw new Error('Relasi order/item/komisi belum lengkap; muat ulang laporan')
  }
}

import * as assert from 'node:assert/strict'
import { normalizeSpxFinanceApiRows, buildSpxFinanceTransactionUrl } from '../../src/lib/recon/spx-api'

const apiRows = [
  {
    transaction_id: 'TX-COD-1',
    biz_transaction_id: 'BIZ-COD-1',
    settlement_sn: 'SETTLE-1',
    transaction_type: 1,
    type: 1,
    tracking_number: 'SPXID061584558017',
    amount: 153000,
    balance_before: 1000000,
    balance_after: 1153000,
    tran_time: 1785686400,
    complete_time: 1785686500,
  },
  {
    transaction_id: 'TX-FEE-1',
    transaction_type: 2,
    tracking_number: 'SPXID061584558017',
    amount: -10098,
    balance_before: 1153000,
    balance_after: 1142902,
    tran_time: 1785686600,
    complete_time: 1785686700,
    extra_data: {
      basic_shipping_fee: 8400,
      cod_service_fee: 1698.3,
      total_fee: 10098,
    },
  },
  {
    transaction_id: 'TX-WD-1',
    transaction_type: 4,
    amount: -40453220,
    balance_before: 50000000,
    balance_after: 9546780,
    status: 3,
    bank_account: 'BCA ****1234',
    transaction_reference_no: 'WD-REF-1',
    create_time: 1785686800,
    complete_time: 1785686900,
  },
]

const rows = normalizeSpxFinanceApiRows(apiRows)
assert.equal(rows.length, 3)
assert.deepEqual(rows.map((r) => r.tx_type), ['COD', 'Ongkos Kirim', 'Penarikan'])
assert.equal(rows[0].external_id, 'TX-COD-1')
assert.equal(rows[0].tracking, 'SPXID061584558017')
assert.equal(rows[0].nominal, 153000)
assert.equal(rows[1].raw?.['Biaya Ongkir Dasar'], 8400)
assert.equal(rows[1].raw?.['Biaya COD'], 1698.3)
assert.equal(rows[2].status, 'Berhasil')
assert.equal(rows[2].tracking, '')

const url = buildSpxFinanceTransactionUrl({
  businessEntity: 4,
  productLine: 7,
  bizAccountId: '6182855474',
  startUnix: 1785517200,
  endUnix: 1785862799,
  offset: 0,
  size: 100,
})
assert.ok(url.includes('/shipment/forward/account/api/spx_seller/seller_balance/transaction_list'))
assert.ok(url.includes('business_entity=4'))
assert.ok(url.includes('biz_account_id=6182855474'))
assert.ok(url.includes('size=100'))

console.log('spx-api-normalizer ok')

import assert from 'node:assert/strict'
import { adaptOrder } from '../../src/lib/converter/wa-paste-adapter'
import { buildPembukuanCsvBlob } from '../../src/lib/orders/pembukuan-export'
import type { ParsedWaOrder } from '../../src/lib/converter/wa-paste-v3'

async function blobToText(blob: Blob): Promise<string> {
  return await blob.text()
}

async function main() {
  const parsed: ParsedWaOrder = {
    nama: 'Budi',
    hp: '081234567890',
    alamat: 'Jl. Mawar 1',
    kelurahan: 'Kel A',
    kecamatan: 'Kec B',
    kota: 'Bandung',
    provinsi: 'Jawa Barat',
    kodePos: '40123',
    produk: 'Luna',
    produkRaw: 'Luna F.B.2',
    produkKode: 'LUNA-01',
    atribusiCodeRaw: 'Luna F.B.2',
    platform: 'META',
    atribusiAccount: 'B',
    atribusiCampaign: '2',
    atribusiPending: true,
    variation: null,
    qty: 1,
    beratGram: 500,
    hargaProduk: 100000,
    hargaTotal: 120000,
    ongkir: 20000,
    metodeBayar: 'COD',
    csName: 'Lisa',
    advKode: 'ADV-01',
    catatan: null,
  }

  const adapted = adaptOrder(
    parsed,
    0,
    {
      supabase: {} as any,
      organizationId: 1,
      channelId: 1,
      createdBy: 'user-1',
      initialStatus: 'BARU',
    },
    {
      products: [{ id: 10, name: 'Luna', search_aliases: ['luna'] }],
      csProfiles: [{ id: 'cs-1', full_name: 'Lisa' }],
    }
  )

  assert.equal(
    (adapted.payload as any).attribution_code_raw,
    'Luna F.B.2',
    'payload harus simpan kode atribusi mentah sebagai kolom first-class'
  )
  assert.equal((adapted.payload as any).attribution_platform, 'META')
  assert.equal((adapted.payload as any).attribution_account_code, 'B')
  assert.equal((adapted.payload as any).attribution_campaign_marker, '2')

  const csv = await blobToText(
    buildPembukuanCsvBlob([
      {
        source: 'draft',
        order_number: 'GB-1',
        order_date: '2026-08-08',
        status: 'BARU',
        zone: 'Baru',
        customer_name: 'Budi',
        customer_city: 'Bandung',
        cs_name: 'Lisa',
        campaign_name: 'Camp 2',
        campaign_platform: 'META',
        channel_name: 'SPX',
        product_summary: 'Luna',
        qty: 1,
        payment_method: 'COD',
        penjualan: 120000,
        ongkir: 20000,
        selisih_ongkir: 0,
        cod_amount: 120000,
        tracking_no: 'SPX123',
        resi: 'SPX123',
        est_fee_admin: 0,
        est_omset: 100000,
        est_hpp: 50000,
        est_fee_cs: 10000,
        est_gross_profit: 40000,
        act_omset: null,
        act_hpp: null,
        act_fee_cs: null,
        act_gross_profit: null,
        dicairkan: null,
        cod_settled_at: null,
        delivered_at: null,
        returned_at: null,
        attribution_code_raw: 'Luna F.B.2',
      } as any,
    ])
  )

  assert.match(csv, /Kode Atribusi/, 'export pembukuan harus punya header Kode Atribusi')
  assert.match(csv, /Luna F\.B\.2/, 'export pembukuan harus bawa nilai kode atribusi')

  console.log('ok')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

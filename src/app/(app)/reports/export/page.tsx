'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react'

const supabase = createClient()

export default function ExportPage() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [exporting, setExporting] = useState('')

  const exportOrders = async () => {
    setExporting('orders')
    try {
      const start = `${month}-01`, end = `${month}-31`
      const { data } = await supabase.from('orders').select('order_number, order_date, customer_name, customer_phone, customer_city, total, payment_method, status').gte('order_date', start).lte('order_date', end).order('order_date')
      if (!data?.length) { toast.error('Tidak ada data'); return }
      const headers = ['No Order', 'Tanggal', 'Customer', 'Telepon', 'Kota', 'Total', 'Pembayaran', 'Status']
      const rows = data.map(o => [o.order_number, o.order_date, o.customer_name, o.customer_phone, o.customer_city, o.total, o.payment_method, o.status])
      downloadCSV(headers, rows, `orders-${month}.csv`)
      toast.success('Export berhasil!')
    } catch (err: any) { toast.error(err.message) }
    finally { setExporting('') }
  }

  const exportFinancial = async () => {
    setExporting('financial')
    try {
      const start = `${month}-01`, end = `${month}-31`
      const [{ data: orders }, { data: spend }, { data: expenses }] = await Promise.all([
        supabase.from('orders').select('total, status').gte('order_date', start).lte('order_date', end),
        supabase.from('ad_spend').select('spend').gte('spend_date', start).lte('spend_date', end),
        supabase.from('expenses').select('amount, category').gte('expense_date', start).lte('expense_date', end),
      ])
      const omzet = (orders || []).filter(o => !['CANCEL', 'FAKE'].includes(o.status)).reduce((s, o) => s + Number(o.total), 0)
      const totalSpend = (spend || []).reduce((s, x) => s + Number(x.spend), 0)
      const totalExpense = (expenses || []).reduce((s, x) => s + Number(x.amount), 0)
      const headers = ['Metrik', 'Nilai']
      const rows = [['Omzet', omzet], ['Total Ad Spend', totalSpend], ['Total Biaya Ops', totalExpense], ['Profit', omzet - totalSpend - totalExpense]]
      downloadCSV(headers, rows, `financial-${month}.csv`)
      toast.success('Export berhasil!')
    } catch (err: any) { toast.error(err.message) }
    finally { setExporting('') }
  }

  const exportAdSpend = async () => {
    setExporting('adspend')
    try {
      const start = `${month}-01`, end = `${month}-31`
      const { data } = await supabase.from('ad_spend').select('spend_date, spend, impressions, clicks, campaigns(campaign_name, platform)').gte('spend_date', start).lte('spend_date', end).order('spend_date')
      if (!data?.length) { toast.error('Tidak ada data'); return }
      const headers = ['Tanggal', 'Campaign', 'Platform', 'Spend', 'Impressions', 'Clicks']
      const rows = data.map((s: any) => [s.spend_date, s.campaigns?.campaign_name, s.campaigns?.platform, s.spend, s.impressions, s.clicks])
      downloadCSV(headers, rows, `adspend-${month}.csv`)
      toast.success('Export berhasil!')
    } catch (err: any) { toast.error(err.message) }
    finally { setExporting('') }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">Export Data</h1>
          <p className="text-muted-foreground mt-1">Export data ke CSV / Excel</p>
        </div>
        <div className="space-y-2"><Label className="text-xs">Periode</Label><Input type="month" value={month} onChange={e => setMonth(e.target.value)} className="w-40" /></div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="hover:border-violet-500/30 transition-colors">
          <CardHeader><div className="p-3 bg-violet-500/10 rounded-xl w-fit mb-2"><FileSpreadsheet className="w-6 h-6 text-violet-500" /></div><CardTitle className="text-base">Export Orders</CardTitle><CardDescription>Data semua order bulan ini</CardDescription></CardHeader>
          <CardContent><Button onClick={exportOrders} disabled={!!exporting} className="w-full">{exporting === 'orders' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Download CSV</Button></CardContent>
        </Card>
        <Card className="hover:border-violet-500/30 transition-colors">
          <CardHeader><div className="p-3 bg-emerald-500/10 rounded-xl w-fit mb-2"><FileText className="w-6 h-6 text-emerald-500" /></div><CardTitle className="text-base">Export Keuangan</CardTitle><CardDescription>Ringkasan keuangan bulanan</CardDescription></CardHeader>
          <CardContent><Button onClick={exportFinancial} disabled={!!exporting} className="w-full">{exporting === 'financial' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Download CSV</Button></CardContent>
        </Card>
        <Card className="hover:border-violet-500/30 transition-colors">
          <CardHeader><div className="p-3 bg-orange-500/10 rounded-xl w-fit mb-2"><FileSpreadsheet className="w-6 h-6 text-orange-500" /></div><CardTitle className="text-base">Export Ad Spend</CardTitle><CardDescription>Data pengeluaran iklan</CardDescription></CardHeader>
          <CardContent><Button onClick={exportAdSpend} disabled={!!exporting} className="w-full">{exporting === 'adspend' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Download CSV</Button></CardContent>
        </Card>
      </div>
    </div>
  )
}

function downloadCSV(headers: string[], rows: any[][], filename: string) {
  const csvContent = [headers.join(','), ...rows.map(r => r.map(v => `"${v ?? ''}"`).join(','))].join('\n')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = filename; link.click()
  URL.revokeObjectURL(url)
}

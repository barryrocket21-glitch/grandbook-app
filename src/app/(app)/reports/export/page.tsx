import { redirect } from 'next/navigation'
// CSV export sudah ada per-page (orders, dll). Halaman export legacy redirect ke daftar order.
export default function ReportsExportPage() { redirect('/orders/list') }

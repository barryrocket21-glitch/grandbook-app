// =============================================================
// Operational Expenses query helpers (Phase 5A)
// =============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  OperationalExpense,
  OperationalExpenseCategory,
  RecurrencePeriod,
} from '@/lib/types'

export async function listExpenses(
  supabase: SupabaseClient,
  args: { from: string; to: string }
): Promise<OperationalExpense[]> {
  const { data, error } = await supabase
    .from('operational_expenses')
    .select('*')
    .gte('expense_date', args.from)
    .lte('expense_date', args.to)
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw new Error(`listExpenses: ${error.message}`)
  return (data || []) as OperationalExpense[]
}

export async function listRecurringExpenses(
  supabase: SupabaseClient
): Promise<OperationalExpense[]> {
  const { data, error } = await supabase
    .from('operational_expenses')
    .select('*')
    .eq('recurring', true)
    .order('expense_date', { ascending: false })
    .limit(200)
  if (error) throw new Error(`listRecurringExpenses: ${error.message}`)
  return (data || []) as OperationalExpense[]
}

export interface ExpensePayload {
  expense_date: string
  category: OperationalExpenseCategory
  description: string
  amount: number
  payment_method: string | null
  payment_reference: string | null
  vendor_name: string | null
  recurring: boolean
  recurrence_period: RecurrencePeriod | null
  notes: string | null
}

export async function insertExpense(
  supabase: SupabaseClient,
  args: { orgId: number; createdBy: string | null; payload: ExpensePayload }
): Promise<OperationalExpense> {
  const { data, error } = await supabase
    .from('operational_expenses')
    .insert({
      ...args.payload,
      organization_id: args.orgId,
      created_by: args.createdBy,
    })
    .select('*')
    .single()
  if (error) throw new Error(`insertExpense: ${error.message}`)
  return data as OperationalExpense
}

export async function updateExpense(
  supabase: SupabaseClient,
  id: number,
  payload: Partial<ExpensePayload>
): Promise<OperationalExpense> {
  const { data, error } = await supabase
    .from('operational_expenses')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(`updateExpense: ${error.message}`)
  return data as OperationalExpense
}

export async function deleteExpense(supabase: SupabaseClient, id: number): Promise<void> {
  const { error } = await supabase.from('operational_expenses').delete().eq('id', id)
  if (error) throw new Error(`deleteExpense: ${error.message}`)
}

export async function bulkDeleteExpenses(
  supabase: SupabaseClient,
  ids: number[]
): Promise<number> {
  if (ids.length === 0) return 0
  const { error, count } = await supabase
    .from('operational_expenses')
    .delete({ count: 'exact' })
    .in('id', ids)
  if (error) throw new Error(`bulkDeleteExpenses: ${error.message}`)
  return count || 0
}

/**
 * Copy recurring expenses dari bulan sebelumnya ke bulan target.
 * Match by description + vendor_name + category + amount untuk avoid duplicate.
 * Returns { copied, skipped_duplicate }.
 */
export async function copyRecurringFromLastMonth(
  supabase: SupabaseClient,
  args: { orgId: number; createdBy: string | null; targetMonthFirstDay: string }
): Promise<{ copied: number; skipped_duplicate: number; source_count: number }> {
  // Compute previous month range
  const target = new Date(args.targetMonthFirstDay + 'T00:00:00')
  const prevMonthStart = new Date(target.getFullYear(), target.getMonth() - 1, 1)
  const prevMonthEnd = new Date(target.getFullYear(), target.getMonth(), 0)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)

  const { data: prevRows, error: prevErr } = await supabase
    .from('operational_expenses')
    .select('*')
    .eq('recurring', true)
    .gte('expense_date', fmt(prevMonthStart))
    .lte('expense_date', fmt(prevMonthEnd))
  if (prevErr) throw new Error(`copyRecurringFromLastMonth (source query): ${prevErr.message}`)

  const sources = (prevRows || []) as OperationalExpense[]
  if (sources.length === 0) {
    return { copied: 0, skipped_duplicate: 0, source_count: 0 }
  }

  // Get existing rows in target month to avoid duplicates
  const targetMonthEnd = new Date(target.getFullYear(), target.getMonth() + 1, 0)
  const { data: existingRows, error: exErr } = await supabase
    .from('operational_expenses')
    .select('description, vendor_name, category, amount')
    .gte('expense_date', fmt(target))
    .lte('expense_date', fmt(targetMonthEnd))
  if (exErr) throw new Error(`copyRecurringFromLastMonth (target query): ${exErr.message}`)

  const existingKeys = new Set(
    (existingRows || []).map((e: { description: string | null; vendor_name: string | null; category: string; amount: number }) =>
      `${e.category}|${(e.description || '').toLowerCase()}|${(e.vendor_name || '').toLowerCase()}|${Number(e.amount).toFixed(2)}`
    )
  )

  let skipped = 0
  const inserts: Array<Omit<OperationalExpense, 'id' | 'created_at' | 'updated_at'>> = []
  for (const s of sources) {
    const key = `${s.category}|${(s.description || '').toLowerCase()}|${(s.vendor_name || '').toLowerCase()}|${Number(s.amount).toFixed(2)}`
    if (existingKeys.has(key)) {
      skipped++
      continue
    }
    // Preserve day-of-month, but in target month. Clamp to last day if needed.
    const srcDay = new Date(s.expense_date + 'T00:00:00').getDate()
    const maxDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
    const day = Math.min(srcDay, maxDay)
    const newDate = new Date(target.getFullYear(), target.getMonth(), day)
    inserts.push({
      organization_id: args.orgId,
      expense_date: fmt(newDate),
      category: s.category,
      description: s.description,
      amount: s.amount,
      payment_method: s.payment_method,
      payment_reference: null,
      vendor_name: s.vendor_name,
      recurring: true,
      recurrence_period: s.recurrence_period,
      notes: s.notes,
      attachment_url: null,
      created_by: args.createdBy,
    })
  }

  if (inserts.length === 0) {
    return { copied: 0, skipped_duplicate: skipped, source_count: sources.length }
  }

  const { error: insErr } = await supabase.from('operational_expenses').insert(inserts)
  if (insErr) throw new Error(`copyRecurringFromLastMonth (insert): ${insErr.message}`)

  return { copied: inserts.length, skipped_duplicate: skipped, source_count: sources.length }
}

export interface ExpenseSummaryRow {
  category: string
  total_amount: number
  total_count: number
  recurring_amount: number
  onetime_amount: number
}

export async function fetchExpenseSummary(
  supabase: SupabaseClient,
  from: string,
  to: string
): Promise<ExpenseSummaryRow[]> {
  const { data, error } = await supabase.rpc('analytics_expenses_summary', {
    p_from: from,
    p_to: to,
  })
  if (error) throw new Error(`analytics_expenses_summary: ${error.message}`)
  return (data || []) as ExpenseSummaryRow[]
}

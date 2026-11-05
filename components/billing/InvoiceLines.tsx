import { cn } from '@/lib/utils'
import { FOREGONE_LABELS, formatMoney, type BillLine, type Currency } from '@/lib/billing-fields'

// A bill's lines and totals, as the customer sees them (lead page and the
// Accounting System). Reductions show what they gave up and their approval.
export function InvoiceLines({
  lines,
  currency,
  subtotal,
  vatAmount,
  vatPercent,
  paypalFeeAmount,
  paypalPercent,
  total,
  amountPaid,
}: {
  lines: BillLine[]
  currency: Currency
  subtotal: number
  vatAmount: number
  vatPercent: number
  paypalFeeAmount: number
  paypalPercent: number
  total: number
  amountPaid?: number
}) {
  const money = (v: number) => formatMoney(v, currency)
  const foot = (label: string, value: number, strong = false) => (
    <tr className={cn(strong && 'font-semibold')}>
      <td className="px-3 py-1.5" colSpan={2}>
        {label}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums">{money(value)}</td>
    </tr>
  )
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[34rem] text-sm">
        <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Line</th>
            <th className="px-3 py-2 font-medium">Calculation</th>
            <th className="px-3 py-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {lines.map((l) => (
            <tr key={l.lineNo} className={cn(l.amount < 0 && 'text-muted-foreground')}>
              <td className="px-3 py-2">
                <p className={cn(l.amount >= 0 && 'text-foreground')}>{l.description}</p>
                {l.foregoneType && (
                  <p className="text-xs">
                    Foregone Revenue · {FOREGONE_LABELS[l.foregoneType]}
                    {l.approvalRef && ` · ${l.approvalRef}`}
                  </p>
                )}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{l.calculation}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(l.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t bg-muted/30">
          {(vatAmount !== 0 || paypalFeeAmount !== 0) && foot('Subtotal', subtotal)}
          {vatAmount !== 0 && foot(`VAT (${vatPercent}%)`, vatAmount)}
          {paypalFeeAmount !== 0 && foot(`PayPal fee (${paypalPercent}%)`, paypalFeeAmount)}
          {foot('Total due', total, true)}
          {amountPaid !== undefined && amountPaid > 0 && (
            <>
              {foot('Paid', amountPaid)}
              {foot('Balance', Math.max(0, Math.round((total - amountPaid) * 100) / 100), true)}
            </>
          )}
        </tfoot>
      </table>
    </div>
  )
}

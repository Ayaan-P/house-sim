'use client'

import { RentalInvestmentMetrics } from '@/lib/monte-carlo'
import { Section } from '@/components/layout'

function formatPercent(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

interface MetricCardProps {
  label: string
  value: string
  positive: boolean
  sub?: string
}

function MetricCard({ label, value, positive, sub }: MetricCardProps) {
  return (
    <div className="bg-[var(--surface-muted)] rounded-lg p-4 border border-[var(--border)] text-center">
      <div className="text-[var(--content-subtle)] text-xs uppercase tracking-wide mb-2">{label}</div>
      <div className={`text-2xl sm:text-3xl font-bold font-mono ${positive ? 'text-green-400' : 'text-red-400'}`}>
        {value}
      </div>
      {sub && <div className="text-[var(--content-subtle)] text-xs mt-1">{sub}</div>}
    </div>
  )
}

export function QuickMetrics({ metrics }: { metrics: RentalInvestmentMetrics }) {
  const { cashOnCashReturn, capRate, monthlyCashFlow, passesOnePercentRule } = metrics

  return (
    <Section title="Rental Investment Metrics">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          label="Cash-on-Cash Return"
          value={formatPercent(cashOnCashReturn)}
          positive={cashOnCashReturn > 0}
          sub="Annual cash flow / cash invested"
        />
        <MetricCard
          label="Cap Rate"
          value={formatPercent(capRate)}
          positive={capRate > 0}
          sub="NOI / property value"
        />
        <MetricCard
          label="Monthly Cash Flow"
          value={formatCurrency(monthlyCashFlow)}
          positive={monthlyCashFlow > 0}
          sub="Rent - all expenses"
        />
        <div className="bg-[var(--surface-muted)] rounded-lg p-4 border border-[var(--border)] text-center">
          <div className="text-[var(--content-subtle)] text-xs uppercase tracking-wide mb-2">1% Rule</div>
          <div className={`text-2xl sm:text-3xl font-bold ${passesOnePercentRule ? 'text-green-400' : 'text-red-400'}`}>
            {passesOnePercentRule ? 'PASS' : 'FAIL'}
          </div>
          <div className="text-[var(--content-subtle)] text-xs mt-1">Rent &ge; 1% of price</div>
        </div>
      </div>
    </Section>
  )
}

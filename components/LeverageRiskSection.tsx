'use client'

import { useMemo } from 'react'
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts'
import { SimulationParams, SimulationSummary } from '@/lib/monte-carlo'

interface LeverageRiskSectionProps {
  inputs: SimulationParams
  simResults: SimulationSummary
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = (p / 100) * (sorted.length - 1)
  const lower = Math.floor(idx)
  const upper = Math.ceil(idx)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower)
}

function formatPercent(n: number): string {
  return `${(n * 100).toFixed(0)}%`
}

function formatLtv(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

export function LeverageRiskSection({ inputs, simResults }: LeverageRiskSectionProps) {
  const leverageData = useMemo(() => {
    return simResults.runs[0]?.years.map((_, yearIndex) => {
      const yearlyRuns = simResults.runs.map(run => run.years[yearIndex]).filter(Boolean)
      const ltvs = yearlyRuns.map(year => {
        if (year.homeValue <= 0) return 1
        return year.loanBalance / year.homeValue
      })
      const equityPercents = yearlyRuns.map(year => {
        if (year.homeValue <= 0) return 0
        return year.equity / year.homeValue
      })
      const underwaterShare = yearlyRuns.filter(year => year.equity < 0).length / yearlyRuns.length
      const lowSafetyShare = yearlyRuns.filter(year => year.equity / Math.max(year.homeValue, 1) < 0.1).length / yearlyRuns.length

      return {
        year: yearIndex + 1,
        medianLtv: percentile(ltvs, 50),
        highLtv: percentile(ltvs, 90),
        lowLtv: percentile(ltvs, 10),
        medianEquityPct: percentile(equityPercents, 50),
        underwaterShare,
        lowSafetyShare,
      }
    }) || []
  }, [simResults.runs])

  const initialLtv = useMemo(() => {
    const downPayment = inputs.homePrice * (inputs.downPaymentPercent / 100)
    const loanAmount = inputs.homePrice - downPayment
    return inputs.homePrice > 0 ? loanAmount / inputs.homePrice : 0
  }, [inputs.downPaymentPercent, inputs.homePrice])

  const finalYear = leverageData[leverageData.length - 1]
  const firstSafeYear = leverageData.find(year => year.medianLtv <= 0.8)?.year ?? null
  const worstUnderwaterYear = leverageData.reduce((worst, year) => (
    year.underwaterShare > worst.underwaterShare ? year : worst
  ), leverageData[0])
  const mostFragileYear = leverageData.reduce((worst, year) => (
    year.lowSafetyShare > worst.lowSafetyShare ? year : worst
  ), leverageData[0])

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-[var(--surface-muted)] rounded-lg p-3 border border-[var(--border)]">
          <div className="text-[var(--content-subtle)] text-xs mb-1">Starting LTV</div>
          <div className={`text-lg font-bold font-mono ${initialLtv > 0.9 ? 'text-error' : initialLtv > 0.8 ? 'text-warning' : 'text-success'}`}>
            {formatLtv(initialLtv)}
          </div>
          <div className="text-[var(--content-subtle)] text-[10px]">Higher means thinner equity cushion</div>
        </div>
        <div className="bg-[var(--surface-muted)] rounded-lg p-3 border border-[var(--border)]">
          <div className="text-[var(--content-subtle)] text-xs mb-1">Median LTV (Yr {inputs.years})</div>
          <div className={`text-lg font-bold font-mono ${(finalYear?.medianLtv || 0) > 0.8 ? 'text-warning' : 'text-success'}`}>
            {formatLtv(finalYear?.medianLtv || 0)}
          </div>
          <div className="text-[var(--content-subtle)] text-[10px]">Typical loan size versus home value</div>
        </div>
        <div className="bg-[var(--surface-muted)] rounded-lg p-3 border border-[var(--border)]">
          <div className="text-[var(--content-subtle)] text-xs mb-1">First safer year</div>
          <div className="text-lg font-bold font-mono text-info">
            {firstSafeYear ? `Yr ${firstSafeYear}` : 'Beyond horizon'}
          </div>
          <div className="text-[var(--content-subtle)] text-[10px]">When median LTV falls to 80% or lower</div>
        </div>
        <div className="bg-[var(--surface-muted)] rounded-lg p-3 border border-[var(--border)]">
          <div className="text-[var(--content-subtle)] text-xs mb-1">Low-cushion risk peak</div>
          <div className={`text-lg font-bold font-mono ${(mostFragileYear?.lowSafetyShare || 0) > 0.5 ? 'text-error' : 'text-warning'}`}>
            {mostFragileYear ? `Yr ${mostFragileYear.year}` : 'N/A'}
          </div>
          <div className="text-[var(--content-subtle)] text-[10px]">
            {formatPercent(mostFragileYear?.lowSafetyShare || 0)} of runs stay under 10% equity
          </div>
        </div>
      </div>

      <div className="bg-[var(--surface-muted)] rounded-xl border border-[var(--border)] p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
          <div>
            <div className="text-sm font-semibold text-[var(--content-muted)]">LTV trajectory over time</div>
            <div className="text-xs text-[var(--content-subtle)]">Median path with a 10th-90th percentile band. Lower is safer.</div>
          </div>
          <div className="text-xs text-[var(--content-subtle)]">80% LTV is a useful comfort line, not a guarantee.</div>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={leverageData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="year" stroke="var(--content-subtle)" tickFormatter={(v) => `Yr ${v}`} />
              <YAxis stroke="var(--content-subtle)" domain={[0, 'dataMax']} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
              <Tooltip
                formatter={(value: number, name: string) => {
                  const label = name === 'medianLtv' ? 'Median LTV' : name === 'highLtv' ? '90th pct LTV' : name === 'lowLtv' ? '10th pct LTV' : name
                  return [formatLtv(value), label]
                }}
                labelFormatter={(value) => `Year ${value}`}
                contentStyle={{ backgroundColor: 'var(--surface-raised)', border: '1px solid var(--border)' }}
              />
              <ReferenceLine y={0.8} stroke="var(--warning)" strokeDasharray="5 5" label={{ value: '80% LTV', position: 'insideTopRight', fill: 'var(--content-subtle)', fontSize: 11 }} />
              <Area type="monotone" dataKey="highLtv" stroke="none" fill="var(--info)" fillOpacity={0.16} />
              <Area type="monotone" dataKey="lowLtv" stroke="none" fill="var(--surface-muted)" fillOpacity={1} />
              <Line type="monotone" dataKey="medianLtv" stroke="var(--accent)" strokeWidth={3} dot={false} name="medianLtv" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-warning-muted border border-warning/30 rounded-xl p-4">
          <div className="text-sm font-semibold text-warning mb-2">Why leverage helps</div>
          <p className="text-sm text-[var(--content-muted)] leading-6">
            A mortgage lets you control the whole house with a smaller upfront check. If the home rises in value,
            your equity can grow faster than your cash down payment alone would have.
          </p>
        </div>
        <div className="bg-error-muted border border-error/30 rounded-xl p-4">
          <div className="text-sm font-semibold text-error mb-2">Why leverage hurts</div>
          <p className="text-sm text-[var(--content-muted)] leading-6">
            Debt magnifies downside too. When prices dip early, a high LTV means you can feel stuck, with little room
            to sell, refinance, or absorb surprise costs without bringing cash to the table.
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-[var(--surface-muted)] rounded-xl border border-[var(--border)] p-4">
          <div className="text-sm font-semibold text-[var(--content-muted)] mb-2">Underwater risk</div>
          <p className="text-sm text-[var(--content-muted)] leading-6">
            {worstUnderwaterYear && worstUnderwaterYear.underwaterShare > 0
              ? `The roughest point is Year ${worstUnderwaterYear.year}, when about ${formatPercent(worstUnderwaterYear.underwaterShare)} of runs have negative equity.`
              : 'In these simulations, the buyer does not go underwater in the modeled runs.'}
          </p>
        </div>
        <div className="bg-[var(--surface-muted)] rounded-xl border border-[var(--border)] p-4">
          <div className="text-sm font-semibold text-[var(--content-muted)] mb-2">Margin of safety</div>
          <p className="text-sm text-[var(--content-muted)] leading-6">
            {mostFragileYear
              ? `A thin cushion is more common than full negative equity. In Year ${mostFragileYear.year}, about ${formatPercent(mostFragileYear.lowSafetyShare)} of runs are still below 10% equity, which can make fees, repairs, or a forced move feel expensive.`
              : 'Your modeled equity cushion builds fairly quickly.'}
          </p>
        </div>
      </div>
    </div>
  )
}

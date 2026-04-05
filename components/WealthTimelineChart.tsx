'use client'

import { useState, useMemo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ComposedChart, Line, ReferenceLine,
} from 'recharts'
import { SimulationSummary, SimulationParams } from '@/lib/monte-carlo'

interface WealthTimelineChartProps {
  inputs: SimulationParams
  simResults: SimulationSummary
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

function formatCompact(n: number): string {
  if (Math.abs(n) >= 1000000) {
    return `$${(n / 1000000).toFixed(1)}M`
  }
  return `$${(n / 1000).toFixed(0)}k`
}

export function WealthTimelineChart({ inputs, simResults }: WealthTimelineChartProps) {
  const [viewMode, setViewMode] = useState<'median' | 'range' | 'delta'>('median')
  const [showConfidence, setShowConfidence] = useState(true)

  // Transform yearly stats into chart data
  const chartData = useMemo(() => {
    return simResults.yearlyStats.map(stat => ({
      year: stat.year,
      label: `Yr ${stat.year}`,
      // Buy scenario
      buyP10: stat.wealthBuy.p10,
      buyP25: stat.wealthBuy.p25,
      buyP50: stat.wealthBuy.p50,
      buyP75: stat.wealthBuy.p75,
      buyP90: stat.wealthBuy.p90,
      buyMean: stat.wealthBuy.mean,
      // Rent scenario
      rentP10: stat.wealthRent.p10,
      rentP25: stat.wealthRent.p25,
      rentP50: stat.wealthRent.p50,
      rentP75: stat.wealthRent.p75,
      rentP90: stat.wealthRent.p90,
      rentMean: stat.wealthRent.mean,
      // Delta (buy advantage)
      deltaP10: stat.delta.p10,
      deltaP25: stat.delta.p25,
      deltaP50: stat.delta.p50,
      deltaP75: stat.delta.p75,
      deltaP90: stat.delta.p90,
      deltaMean: stat.delta.mean,
    }))
  }, [simResults.yearlyStats])

  // Find crossover point (first year where median buy > median rent)
  const crossoverYear = useMemo(() => {
    for (const stat of simResults.yearlyStats) {
      if (stat.wealthBuy.p50 > stat.wealthRent.p50) {
        return stat.year
      }
    }
    return null
  }, [simResults.yearlyStats])

  // Key stats for summary
  const finalYear = chartData[chartData.length - 1]
  const buyWinsAtEnd = finalYear?.buyP50 > finalYear?.rentP50
  const finalAdvantage = Math.abs(finalYear?.deltaP50 || 0)
  const buyWinsProbability = simResults.finalStats.buyWinsProbability

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-[var(--surface)] rounded-lg p-3 border border-[var(--border)]">
          <div className="text-[var(--content-subtle)] text-xs mb-1">Buy Wealth (Yr {inputs.years})</div>
          <div className="text-accent text-lg font-bold font-mono">{formatCurrency(finalYear?.buyP50 || 0)}</div>
          <div className="text-[var(--content-subtle)] text-[10px]">
            {formatCurrency(finalYear?.buyP25 || 0)} - {formatCurrency(finalYear?.buyP75 || 0)}
          </div>
        </div>
        <div className="bg-[var(--surface)] rounded-lg p-3 border border-[var(--border)]">
          <div className="text-[var(--content-subtle)] text-xs mb-1">Rent Wealth (Yr {inputs.years})</div>
          <div className="text-secondary text-lg font-bold font-mono">{formatCurrency(finalYear?.rentP50 || 0)}</div>
          <div className="text-[var(--content-subtle)] text-[10px]">
            {formatCurrency(finalYear?.rentP25 || 0)} - {formatCurrency(finalYear?.rentP75 || 0)}
          </div>
        </div>
        <div className="bg-[var(--surface)] rounded-lg p-3 border border-[var(--border)]">
          <div className="text-[var(--content-subtle)] text-xs mb-1">Buy Wins Prob.</div>
          <div className={`text-lg font-bold font-mono ${buyWinsProbability >= 0.5 ? 'text-success' : 'text-error'}`}>
            {(buyWinsProbability * 100).toFixed(0)}%
          </div>
          <div className="text-[var(--content-subtle)] text-[10px]">of {inputs.numSimulations} runs</div>
        </div>
        <div className="bg-[var(--surface)] rounded-lg p-3 border border-[var(--border)]">
          <div className="text-[var(--content-subtle)] text-xs mb-1">Median Advantage</div>
          <div className={`text-lg font-bold font-mono ${buyWinsAtEnd ? 'text-success' : 'text-error'}`}>
            {buyWinsAtEnd ? '+' : '-'}{formatCurrency(finalAdvantage)}
          </div>
          <div className="text-[var(--content-subtle)] text-[10px]">{buyWinsAtEnd ? 'Buy' : 'Rent'} ahead</div>
        </div>
      </div>

      {/* Crossover Insight */}
      {crossoverYear && crossoverYear <= inputs.years && (
        <div className="bg-info-muted border border-info/30 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <span className="text-info text-lg">🔄</span>
            <span className="text-[var(--content-muted)] text-sm">
              <strong className="text-info">Year {crossoverYear}</strong>: Buying starts outperforming renting (median outcome).
              {crossoverYear <= 5 && (
                <span className="text-[var(--content-subtle)]"> That&apos;s early — strong buy signal!</span>
              )}
            </span>
          </div>
        </div>
      )}
      {!crossoverYear && (
        <div className="bg-warning-muted border border-warning/30 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <span className="text-warning text-lg">⚠️</span>
            <span className="text-[var(--content-muted)] text-sm">
              Renting outperforms buying in the median case over your {inputs.years}-year horizon.
            </span>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 bg-[var(--surface)] rounded-lg p-1 border border-[var(--border)]">
          <button
            onClick={() => setViewMode('median')}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              viewMode === 'median'
                ? 'bg-accent text-white dark:text-[var(--content)]'
                : 'text-[var(--content-subtle)] hover:text-[var(--content-muted)]'
            }`}
          >
            Comparison
          </button>
          <button
            onClick={() => setViewMode('range')}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              viewMode === 'range'
                ? 'bg-accent text-white dark:text-[var(--content)]'
                : 'text-[var(--content-subtle)] hover:text-[var(--content-muted)]'
            }`}
          >
            Uncertainty
          </button>
          <button
            onClick={() => setViewMode('delta')}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              viewMode === 'delta'
                ? 'bg-accent text-white dark:text-[var(--content)]'
                : 'text-[var(--content-subtle)] hover:text-[var(--content-muted)]'
            }`}
          >
            Advantage
          </button>
        </div>

        {viewMode !== 'delta' && (
          <label className="flex items-center gap-2 text-sm text-[var(--content-subtle)]">
            <input
              type="checkbox"
              checked={showConfidence}
              onChange={(e) => setShowConfidence(e.target.checked)}
              className="rounded"
            />
            Show 25th-75th percentile
          </label>
        )}
      </div>

      {/* Chart */}
      <div className="h-64 md:h-80">
        <ResponsiveContainer width="100%" height="100%">
          {viewMode === 'median' ? (
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="year"
                stroke="var(--content-subtle)"
                tickFormatter={(v) => `Yr ${v}`}
              />
              <YAxis
                stroke="var(--content-subtle)"
                tickFormatter={formatCompact}
              />
              <Tooltip
                formatter={(v: number) => formatCurrency(v)}
                labelFormatter={(v) => `Year ${v}`}
                contentStyle={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
              />
              <Legend />
              {showConfidence && (
                <>
                  <Area
                    type="monotone"
                    dataKey="buyP75"
                    stroke="none"
                    fill="#84BABF"
                    fillOpacity={0.15}
                    name="Buy 25-75%"
                    legendType="none"
                  />
                  <Area
                    type="monotone"
                    dataKey="buyP25"
                    stroke="none"
                    fill="var(--surface)"
                    fillOpacity={1}
                    legendType="none"
                  />
                  <Area
                    type="monotone"
                    dataKey="rentP75"
                    stroke="none"
                    fill="#F59E0B"
                    fillOpacity={0.15}
                    name="Rent 25-75%"
                    legendType="none"
                  />
                  <Area
                    type="monotone"
                    dataKey="rentP25"
                    stroke="none"
                    fill="var(--surface)"
                    fillOpacity={1}
                    legendType="none"
                  />
                </>
              )}
              <Line
                type="monotone"
                dataKey="buyP50"
                stroke="#84BABF"
                strokeWidth={3}
                dot={false}
                name="Buy (Median)"
              />
              <Line
                type="monotone"
                dataKey="rentP50"
                stroke="#F59E0B"
                strokeWidth={3}
                dot={false}
                name="Rent (Median)"
              />
              {crossoverYear && (
                <ReferenceLine
                  x={crossoverYear}
                  stroke="var(--content-subtle)"
                  strokeDasharray="5 5"
                  label={{ value: "Crossover", position: "top", fill: "var(--content-subtle)", fontSize: 11 }}
                />
              )}
            </ComposedChart>
          ) : viewMode === 'range' ? (
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="year"
                stroke="var(--content-subtle)"
                tickFormatter={(v) => `Yr ${v}`}
              />
              <YAxis
                stroke="var(--content-subtle)"
                tickFormatter={formatCompact}
              />
              <Tooltip
                formatter={(v: number) => formatCurrency(v)}
                labelFormatter={(v) => `Year ${v}`}
                contentStyle={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
              />
              <Legend />
              {/* Buy scenario range */}
              <Area
                type="monotone"
                dataKey="buyP90"
                stroke="none"
                fill="#84BABF"
                fillOpacity={0.1}
                name="Buy 10-90%"
              />
              <Area
                type="monotone"
                dataKey="buyP10"
                stroke="none"
                fill="var(--bg)"
                fillOpacity={1}
                legendType="none"
              />
              {showConfidence && (
                <>
                  <Area
                    type="monotone"
                    dataKey="buyP75"
                    stroke="none"
                    fill="#84BABF"
                    fillOpacity={0.2}
                    name="Buy 25-75%"
                  />
                  <Area
                    type="monotone"
                    dataKey="buyP25"
                    stroke="none"
                    fill="var(--bg)"
                    fillOpacity={1}
                    legendType="none"
                  />
                </>
              )}
              <Line
                type="monotone"
                dataKey="buyP50"
                stroke="#84BABF"
                strokeWidth={2}
                dot={false}
                name="Buy Median"
              />
              {/* Rent scenario range */}
              <Area
                type="monotone"
                dataKey="rentP90"
                stroke="none"
                fill="#F59E0B"
                fillOpacity={0.1}
                name="Rent 10-90%"
              />
              <Area
                type="monotone"
                dataKey="rentP10"
                stroke="none"
                fill="var(--bg)"
                fillOpacity={1}
                legendType="none"
              />
              {showConfidence && (
                <>
                  <Area
                    type="monotone"
                    dataKey="rentP75"
                    stroke="none"
                    fill="#F59E0B"
                    fillOpacity={0.2}
                    name="Rent 25-75%"
                  />
                  <Area
                    type="monotone"
                    dataKey="rentP25"
                    stroke="none"
                    fill="var(--bg)"
                    fillOpacity={1}
                    legendType="none"
                  />
                </>
              )}
              <Line
                type="monotone"
                dataKey="rentP50"
                stroke="#F59E0B"
                strokeWidth={2}
                dot={false}
                name="Rent Median"
              />
            </ComposedChart>
          ) : (
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="year"
                stroke="var(--content-subtle)"
                tickFormatter={(v) => `Yr ${v}`}
              />
              <YAxis
                stroke="var(--content-subtle)"
                tickFormatter={formatCompact}
              />
              <Tooltip
                formatter={(v: number) => formatCurrency(v)}
                labelFormatter={(v) => `Year ${v}`}
                contentStyle={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
              />
              <Legend />
              <ReferenceLine y={0} stroke="var(--content-subtle)" strokeDasharray="3 3" />
              <Area
                type="monotone"
                dataKey="deltaP75"
                stroke="none"
                fill="#10B981"
                fillOpacity={0.15}
                name="75th percentile"
              />
              <Area
                type="monotone"
                dataKey="deltaP25"
                stroke="none"
                fill="var(--bg)"
                fillOpacity={1}
                legendType="none"
              />
              <Line
                type="monotone"
                dataKey="deltaP50"
                stroke="#10B981"
                strokeWidth={3}
                dot={false}
                name="Buy Advantage (Median)"
              />
              <Line
                type="monotone"
                dataKey="deltaP10"
                stroke="#EF4444"
                strokeWidth={1}
                strokeDasharray="5 5"
                dot={false}
                name="10th percentile"
              />
              <Line
                type="monotone"
                dataKey="deltaP90"
                stroke="#10B981"
                strokeWidth={1}
                strokeDasharray="5 5"
                dot={false}
                name="90th percentile"
              />
            </ComposedChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Interpretation Guide */}
      <div className="text-[var(--content-subtle)] text-xs space-y-1">
        {viewMode === 'median' && (
          <p>
            <strong>Comparison view:</strong> Shows median (50th percentile) wealth trajectory for buying vs renting.
            The shaded area shows the middle 50% of outcomes.
          </p>
        )}
        {viewMode === 'range' && (
          <p>
            <strong>Uncertainty view:</strong> Visualizes the full range of outcomes. The wider the band, the more
            uncertainty. Outer bands show 10th-90th percentile (80% of outcomes fall within).
          </p>
        )}
        {viewMode === 'delta' && (
          <p>
            <strong>Advantage view:</strong> Shows the buy-vs-rent difference over time. Above zero = buying wins.
            The bands show outcome uncertainty — if the 10th percentile is above zero, buying wins in 90%+ of simulations.
          </p>
        )}
      </div>

      {/* Detailed Table */}
      <details className="group">
        <summary className="cursor-pointer text-sm text-[var(--content-muted)] hover:text-[var(--content)] flex items-center gap-2">
          <span className="group-open:rotate-90 transition-transform">▶</span>
          View year-by-year data
        </summary>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[var(--content-subtle)] border-b border-[var(--border)]">
                <th className="text-left py-2 pr-4">Year</th>
                <th className="text-right pr-4">Buy (Median)</th>
                <th className="text-right pr-4">Rent (Median)</th>
                <th className="text-right pr-4">Advantage</th>
                <th className="text-right">Leader</th>
              </tr>
            </thead>
            <tbody>
              {chartData.map((row) => {
                const buyWins = row.buyP50 > row.rentP50
                return (
                  <tr
                    key={row.year}
                    className={`border-b border-border ${row.year === inputs.years ? 'bg-info-muted' : ''}`}
                  >
                    <td className="py-1.5 pr-4 font-medium">{row.year}</td>
                    <td className="text-right pr-4 text-accent">{formatCurrency(row.buyP50)}</td>
                    <td className="text-right pr-4 text-secondary">{formatCurrency(row.rentP50)}</td>
                    <td className={`text-right pr-4 ${buyWins ? 'text-success' : 'text-error'}`}>
                      {buyWins ? '+' : ''}{formatCurrency(row.deltaP50)}
                    </td>
                    <td className={`text-right font-medium ${buyWins ? 'text-success' : 'text-error'}`}>
                      {buyWins ? 'Buy' : 'Rent'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

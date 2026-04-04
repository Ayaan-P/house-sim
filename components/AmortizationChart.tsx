'use client'

import { useState, useMemo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ComposedChart, Line, Bar,
} from 'recharts'
import { SimulationParams } from '@/lib/monte-carlo'

interface AmortizationMonth {
  month: number
  year: number
  payment: number
  principal: number
  interest: number
  balance: number
  cumulativePrincipal: number
  cumulativeInterest: number
  equityFromPayments: number  // Principal paid only (not including appreciation)
}

interface AmortizationYear {
  year: number
  totalPayment: number
  totalPrincipal: number
  totalInterest: number
  endingBalance: number
  principalPercent: number  // % of payment going to principal
  cumulativePrincipal: number
  cumulativeInterest: number
}

function calculateAmortizationSchedule(params: SimulationParams): {
  monthly: AmortizationMonth[]
  yearly: AmortizationYear[]
  totals: {
    totalPayments: number
    totalPrincipal: number
    totalInterest: number
    effectiveRate: number
  }
} {
  const {
    homePrice, downPaymentPercent, mortgageRate, closingMonth,
    firstTimeHomeBuyer,
  } = params

  // FTHB rate discount
  const fthb = firstTimeHomeBuyer || { enabled: false, lowerRate: false, rateDiscount: 0 }
  const effectiveRate = fthb.enabled && fthb.lowerRate 
    ? mortgageRate - (fthb.rateDiscount || 0) 
    : mortgageRate

  const downPayment = homePrice * (downPaymentPercent / 100)
  const loanAmount = homePrice - downPayment
  const monthlyRate = effectiveRate / 12
  const numPayments = 360  // 30-year fixed

  // Calculate monthly P&I payment
  const monthlyPayment = loanAmount > 0
    ? loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / 
      (Math.pow(1 + monthlyRate, numPayments) - 1)
    : 0

  const monthly: AmortizationMonth[] = []
  let balance = loanAmount
  let cumulativePrincipal = 0
  let cumulativeInterest = 0

  for (let month = 1; month <= numPayments && balance > 0; month++) {
    const interest = balance * monthlyRate
    const principal = Math.min(monthlyPayment - interest, balance)
    balance = Math.max(0, balance - principal)
    cumulativePrincipal += principal
    cumulativeInterest += interest

    // Calculate which year this month belongs to (accounting for closing month)
    const effectiveMonth = month + (closingMonth || 1) - 1
    const year = Math.ceil(effectiveMonth / 12)

    monthly.push({
      month,
      year,
      payment: monthlyPayment,
      principal,
      interest,
      balance,
      cumulativePrincipal,
      cumulativeInterest,
      equityFromPayments: cumulativePrincipal,
    })
  }

  // Aggregate to yearly
  const yearly: AmortizationYear[] = []
  let currentYear = 1
  let yearPrincipal = 0
  let yearInterest = 0
  let yearPayment = 0
  let monthsInYear = 0

  for (const m of monthly) {
    if (m.year !== currentYear) {
      // Save previous year
      if (monthsInYear > 0) {
        yearly.push({
          year: currentYear,
          totalPayment: yearPayment,
          totalPrincipal: yearPrincipal,
          totalInterest: yearInterest,
          endingBalance: monthly.find(x => x.year === currentYear && x.month === Math.max(...monthly.filter(y => y.year === currentYear).map(y => y.month)))?.balance || 0,
          principalPercent: yearPayment > 0 ? (yearPrincipal / yearPayment) * 100 : 0,
          cumulativePrincipal: m.cumulativePrincipal - m.principal,
          cumulativeInterest: m.cumulativeInterest - m.interest,
        })
      }
      // Start new year
      currentYear = m.year
      yearPrincipal = 0
      yearInterest = 0
      yearPayment = 0
      monthsInYear = 0
    }
    yearPrincipal += m.principal
    yearInterest += m.interest
    yearPayment += m.payment
    monthsInYear++
  }

  // Don't forget the last year
  if (monthsInYear > 0) {
    const lastMonth = monthly[monthly.length - 1]
    yearly.push({
      year: currentYear,
      totalPayment: yearPayment,
      totalPrincipal: yearPrincipal,
      totalInterest: yearInterest,
      endingBalance: lastMonth?.balance || 0,
      principalPercent: yearPayment > 0 ? (yearPrincipal / yearPayment) * 100 : 0,
      cumulativePrincipal: lastMonth?.cumulativePrincipal || 0,
      cumulativeInterest: lastMonth?.cumulativeInterest || 0,
    })
  }

  const totalPayments = monthly.reduce((sum, m) => sum + m.payment, 0)
  const totalPrincipal = monthly.reduce((sum, m) => sum + m.principal, 0)
  const totalInterest = monthly.reduce((sum, m) => sum + m.interest, 0)

  return {
    monthly,
    yearly,
    totals: {
      totalPayments,
      totalPrincipal,
      totalInterest,
      effectiveRate,
    },
  }
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', { 
    style: 'currency', 
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

interface AmortizationChartProps {
  inputs: SimulationParams
}

export function AmortizationChart({ inputs }: AmortizationChartProps) {
  const [viewMode, setViewMode] = useState<'yearly' | 'monthly'>('yearly')
  const [chartType, setChartType] = useState<'stacked' | 'cumulative' | 'balance'>('stacked')
  const [showYears, setShowYears] = useState<number>(inputs.years || 10)

  const schedule = useMemo(() => calculateAmortizationSchedule(inputs), [inputs])

  // Filter data based on selected years
  const yearlyData = useMemo(() => {
    return schedule.yearly
      .filter(y => y.year <= showYears)
      .map(y => ({
        ...y,
        label: `Yr ${y.year}`,
      }))
  }, [schedule.yearly, showYears])

  const monthlyData = useMemo(() => {
    return schedule.monthly
      .filter(m => m.year <= showYears)
      .map(m => ({
        ...m,
        label: `M${m.month}`,
      }))
  }, [schedule.monthly, showYears])

  const chartData = viewMode === 'yearly' ? yearlyData : monthlyData

  // Key stats
  const downPayment = inputs.homePrice * (inputs.downPaymentPercent / 100)
  const loanAmount = inputs.homePrice - downPayment
  const monthlyPayment = schedule.monthly[0]?.payment || 0
  const yearEndData = schedule.yearly.find(y => y.year === showYears)
  const equityAtEnd = yearEndData ? yearEndData.cumulativePrincipal : 0
  const interestPaid = yearEndData ? yearEndData.cumulativeInterest : 0
  const remainingBalance = yearEndData ? yearEndData.endingBalance : loanAmount

  // Calculate crossover point (when principal > interest)
  const crossoverYear = schedule.yearly.find(y => y.totalPrincipal > y.totalInterest)?.year
  
  // Calculate payoff progress percentage
  const payoffProgress = ((loanAmount - remainingBalance) / loanAmount) * 100

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-[var(--surface)] rounded-lg p-3 border border-[var(--border)]">
          <div className="text-[var(--content-subtle)] text-xs mb-1">Monthly P&I</div>
          <div className="text-[var(--content)] text-lg font-bold font-mono">{formatCurrency(monthlyPayment)}</div>
        </div>
        <div className="bg-[var(--surface)] rounded-lg p-3 border border-[var(--border)]">
          <div className="text-[var(--content-subtle)] text-xs mb-1">Equity (Yr {showYears})</div>
          <div className="text-green-400 text-lg font-bold font-mono">{formatCurrency(equityAtEnd)}</div>
          <div className="text-[var(--content-subtle)] text-[10px]">{payoffProgress.toFixed(1)}% paid</div>
        </div>
        <div className="bg-[var(--surface)] rounded-lg p-3 border border-[var(--border)]">
          <div className="text-[var(--content-subtle)] text-xs mb-1">Interest (Yr {showYears})</div>
          <div className="text-red-400 text-lg font-bold font-mono">{formatCurrency(interestPaid)}</div>
        </div>
        <div className="bg-[var(--surface)] rounded-lg p-3 border border-[var(--border)]">
          <div className="text-[var(--content-subtle)] text-xs mb-1">Remaining Balance</div>
          <div className="text-[var(--content-muted)] text-lg font-bold font-mono">{formatCurrency(remainingBalance)}</div>
        </div>
      </div>

      {/* Key Insight */}
      {crossoverYear && crossoverYear <= 30 && (
        <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <span className="text-blue-400 text-lg">💡</span>
            <span className="text-[var(--content-muted)] text-sm">
              <strong className="text-blue-400">Year {crossoverYear}</strong>: Your monthly payment starts going more to principal than interest.
              {crossoverYear <= showYears && (
                <span className="text-[var(--content-subtle)]"> (within your horizon!)</span>
              )}
            </span>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 bg-[var(--surface)] rounded-lg p-1 border border-[var(--border)]">
          <button
            onClick={() => setViewMode('yearly')}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              viewMode === 'yearly'
                ? 'bg-accent text-white dark:text-[var(--content)]'
                : 'text-[var(--content-subtle)] hover:text-[var(--content-muted)]'
            }`}
          >
            Yearly
          </button>
          <button
            onClick={() => setViewMode('monthly')}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              viewMode === 'monthly'
                ? 'bg-accent text-white dark:text-[var(--content)]'
                : 'text-[var(--content-subtle)] hover:text-[var(--content-muted)]'
            }`}
          >
            Monthly
          </button>
        </div>

        <div className="flex gap-1 bg-[var(--surface)] rounded-lg p-1 border border-[var(--border)]">
          <button
            onClick={() => setChartType('stacked')}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              chartType === 'stacked'
                ? 'bg-accent text-white dark:text-[var(--content)]'
                : 'text-[var(--content-subtle)] hover:text-[var(--content-muted)]'
            }`}
          >
            P&I Split
          </button>
          <button
            onClick={() => setChartType('cumulative')}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              chartType === 'cumulative'
                ? 'bg-accent text-white dark:text-[var(--content)]'
                : 'text-[var(--content-subtle)] hover:text-[var(--content-muted)]'
            }`}
          >
            Cumulative
          </button>
          <button
            onClick={() => setChartType('balance')}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              chartType === 'balance'
                ? 'bg-accent text-white dark:text-[var(--content)]'
                : 'text-[var(--content-subtle)] hover:text-[var(--content-muted)]'
            }`}
          >
            Balance
          </button>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <span className="text-[var(--content-subtle)] text-sm">Show:</span>
          <select
            value={showYears}
            onChange={(e) => setShowYears(parseInt(e.target.value))}
            className="themed-input px-2 py-1 border rounded text-sm"
          >
            <option value={5}>5 years</option>
            <option value={10}>10 years</option>
            <option value={15}>15 years</option>
            <option value={20}>20 years</option>
            <option value={30}>30 years</option>
          </select>
        </div>
      </div>

      {/* Chart */}
      <div className="h-64 md:h-80">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'stacked' ? (
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis 
                dataKey={viewMode === 'yearly' ? 'year' : 'month'} 
                stroke="#9CA3AF"
                tickFormatter={(v) => viewMode === 'yearly' ? `Yr ${v}` : `M${v}`}
                interval={viewMode === 'monthly' ? Math.floor(chartData.length / 12) : 0}
              />
              <YAxis 
                stroke="#9CA3AF" 
                tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} 
              />
              <Tooltip 
                formatter={(v: number) => formatCurrency(v)}
                labelFormatter={(v) => viewMode === 'yearly' ? `Year ${v}` : `Month ${v}`}
                contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }}
              />
              <Legend />
              <Area 
                type="monotone" 
                dataKey={viewMode === 'yearly' ? 'totalPrincipal' : 'principal'}
                stackId="1"
                stroke="#10B981" 
                fill="#10B981" 
                fillOpacity={0.7}
                name="Principal"
              />
              <Area 
                type="monotone" 
                dataKey={viewMode === 'yearly' ? 'totalInterest' : 'interest'}
                stackId="1"
                stroke="#EF4444" 
                fill="#EF4444" 
                fillOpacity={0.7}
                name="Interest"
              />
            </AreaChart>
          ) : chartType === 'cumulative' ? (
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis 
                dataKey={viewMode === 'yearly' ? 'year' : 'month'} 
                stroke="#9CA3AF"
                tickFormatter={(v) => viewMode === 'yearly' ? `Yr ${v}` : `M${v}`}
                interval={viewMode === 'monthly' ? Math.floor(chartData.length / 12) : 0}
              />
              <YAxis 
                stroke="#9CA3AF" 
                tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} 
              />
              <Tooltip 
                formatter={(v: number) => formatCurrency(v)}
                labelFormatter={(v) => viewMode === 'yearly' ? `Year ${v}` : `Month ${v}`}
                contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }}
              />
              <Legend />
              <Area 
                type="monotone" 
                dataKey="cumulativePrincipal"
                stroke="#10B981" 
                fill="#10B981" 
                fillOpacity={0.3}
                name="Total Principal Paid (Equity)"
              />
              <Area 
                type="monotone" 
                dataKey="cumulativeInterest"
                stroke="#EF4444" 
                fill="#EF4444" 
                fillOpacity={0.3}
                name="Total Interest Paid"
              />
            </ComposedChart>
          ) : (
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis 
                dataKey={viewMode === 'yearly' ? 'year' : 'month'} 
                stroke="#9CA3AF"
                tickFormatter={(v) => viewMode === 'yearly' ? `Yr ${v}` : `M${v}`}
                interval={viewMode === 'monthly' ? Math.floor(chartData.length / 12) : 0}
              />
              <YAxis 
                stroke="#9CA3AF" 
                tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} 
              />
              <Tooltip 
                formatter={(v: number) => formatCurrency(v)}
                labelFormatter={(v) => viewMode === 'yearly' ? `Year ${v}` : `Month ${v}`}
                contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }}
              />
              <Legend />
              <Area 
                type="monotone" 
                dataKey={viewMode === 'yearly' ? 'endingBalance' : 'balance'}
                stroke="#6366F1" 
                fill="#6366F1" 
                fillOpacity={0.4}
                name="Remaining Balance"
              />
              <Line 
                type="monotone" 
                dataKey="cumulativePrincipal"
                stroke="#10B981"
                strokeWidth={2}
                dot={false}
                name="Equity from Payments"
              />
            </ComposedChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Yearly Table */}
      {viewMode === 'yearly' && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[var(--content-subtle)] border-b border-[var(--border)]">
                <th className="text-left py-2 pr-4">Year</th>
                <th className="text-right pr-4">Principal</th>
                <th className="text-right pr-4">Interest</th>
                <th className="text-right pr-4">P&I Split</th>
                <th className="text-right pr-4">Balance</th>
                <th className="text-right">Cumul. Equity</th>
              </tr>
            </thead>
            <tbody>
              {yearlyData.map((y) => (
                <tr
                  key={y.year}
                  className={`border-b border-border ${y.year === (inputs.years || 10) ? 'bg-blue-900/20' : ''}`}
                >
                  <td className="py-1.5 pr-4 font-medium">{y.year}</td>
                  <td className="text-right pr-4 text-green-400">{formatCurrency(y.totalPrincipal)}</td>
                  <td className="text-right pr-4 text-red-400">{formatCurrency(y.totalInterest)}</td>
                  <td className="text-right pr-4">
                    <div className="flex items-center justify-end gap-1">
                      <div 
                        className="h-2 bg-green-500 rounded-l"
                        style={{ width: `${Math.min(y.principalPercent, 100) * 0.5}px` }}
                      />
                      <div 
                        className="h-2 bg-red-500 rounded-r"
                        style={{ width: `${Math.min(100 - y.principalPercent, 100) * 0.5}px` }}
                      />
                      <span className="text-[var(--content-subtle)] text-xs ml-1">
                        {y.principalPercent.toFixed(0)}%
                      </span>
                    </div>
                  </td>
                  <td className="text-right pr-4 text-[var(--content-muted)]">{formatCurrency(y.endingBalance)}</td>
                  <td className="text-right text-green-400 font-medium">{formatCurrency(y.cumulativePrincipal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Total Cost Card */}
      <div className="bg-gradient-to-r from-[var(--surface)] to-transparent border border-[var(--border)] rounded-xl p-4">
        <div className="text-[var(--content-subtle)] text-sm mb-2">Full 30-Year Loan Cost</div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-[var(--content-subtle)] text-xs">Principal</div>
            <div className="text-[var(--content)] font-bold font-mono">{formatCurrency(schedule.totals.totalPrincipal)}</div>
          </div>
          <div>
            <div className="text-[var(--content-subtle)] text-xs">Interest</div>
            <div className="text-red-400 font-bold font-mono">{formatCurrency(schedule.totals.totalInterest)}</div>
          </div>
          <div>
            <div className="text-[var(--content-subtle)] text-xs">Total Paid</div>
            <div className="text-[var(--content-muted)] font-bold font-mono">{formatCurrency(schedule.totals.totalPayments)}</div>
          </div>
        </div>
        <div className="mt-2 text-[var(--content-subtle)] text-xs">
          Interest is {((schedule.totals.totalInterest / schedule.totals.totalPrincipal) * 100).toFixed(0)}% of principal 
          ({formatCurrency(schedule.totals.totalInterest)} in interest on a {formatCurrency(loanAmount)} loan)
        </div>
      </div>
    </div>
  )
}

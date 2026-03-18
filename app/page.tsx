'use client'

import { useState, useMemo, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, ReferenceLine,
} from 'recharts'
import { 
  runSimulation, defaultParams, SimulationParams, SimulationSummary,
  createMultiFamilyUnits, getUnitSummary,
} from '@/lib/monte-carlo'

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', { 
    style: 'currency', 
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

function formatPercent(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

function HouseSimulator() {
  const searchParams = useSearchParams()
  const [inputs, setInputs] = useState<SimulationParams>(() => {
    const params = { ...defaultParams }
    // Reset to more generic defaults
    params.homePrice = 600000
    params.currentRent = 2000
    params.w2Income = 100000
    params.houseHack = false
    params.rentalIncome = 0
    return params
  })
  const [results, setResults] = useState<SimulationSummary | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const update = useCallback((key: keyof SimulationParams, value: number | boolean | object) => {
    setInputs(prev => ({ ...prev, [key]: value }))
  }, [])

  const runSim = useCallback(() => {
    setIsRunning(true)
    setTimeout(() => {
      const res = runSimulation(inputs)
      setResults(res)
      setIsRunning(false)
    }, 50)
  }, [inputs])

  const chartData = useMemo(() => {
    if (!results) return []
    return results.yearlyStats.map(y => ({
      year: y.year,
      buyP50: y.wealthBuy.p50,
      rentP50: y.wealthRent.p50,
      deltaP10: y.delta.p10,
      deltaP50: y.delta.p50,
      deltaP90: y.delta.p90,
    }))
  }, [results])

  const rentalSummary = inputs.units.length > 0 
    ? getUnitSummary(inputs.units)
    : inputs.houseHack 
      ? { totalRent: inputs.rentalIncome }
      : null

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <h1 className="text-2xl md:text-3xl font-bold mb-2">House vs Rent Simulator</h1>
        <p className="text-white/50 text-sm mb-6">Monte Carlo simulation comparing buying vs renting + investing</p>

        {/* Main Inputs */}
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-4 md:p-6 mb-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
            <InputBox label="Home Price" value={inputs.homePrice} prefix="$" 
              onChange={v => update('homePrice', v)} />
            <InputBox label="Down Payment" value={inputs.downPaymentPercent} suffix="%" 
              onChange={v => update('downPaymentPercent', v)} />
            <InputBox label="Interest Rate" value={(inputs.mortgageRate * 100).toFixed(2)} suffix="%" 
              onChange={v => update('mortgageRate', v / 100)} />
            <InputBox label="Current Rent" value={inputs.currentRent} prefix="$" 
              onChange={v => update('currentRent', v)} />
            <InputBox label="Years" value={inputs.years} suffix="yr" 
              onChange={v => update('years', v)} />
          </div>

          {/* Rental Strategy */}
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <span className="text-white/50 text-sm">House Hack:</span>
            {[
              { label: 'None', active: inputs.units.length === 0 && !inputs.houseHack },
              { label: 'Room', active: inputs.units.length === 0 && inputs.houseHack },
              { label: '2-Family', active: inputs.units.length === 2 },
              { label: '3-Family', active: inputs.units.length === 3 },
            ].map(opt => (
              <button
                key={opt.label}
                onClick={() => {
                  if (opt.label === 'None') {
                    update('units', [])
                    update('houseHack', false)
                  } else if (opt.label === 'Room') {
                    update('units', [])
                    update('houseHack', true)
                    update('rentalIncome', 1500)
                  } else if (opt.label === '2-Family') {
                    update('units', createMultiFamilyUnits('2-family'))
                    update('houseHack', true)
                  } else if (opt.label === '3-Family') {
                    update('units', createMultiFamilyUnits('3-family'))
                    update('houseHack', true)
                  }
                }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  opt.active
                    ? 'bg-blue-500 text-white'
                    : 'bg-white/[0.04] text-white/50 hover:bg-white/[0.08]'
                }`}
              >
                {opt.label}
              </button>
            ))}
            {rentalSummary && (
              <span className="ml-auto text-green-400 font-mono text-sm">
                +${rentalSummary.totalRent.toLocaleString()}/mo
              </span>
            )}
          </div>

          {/* Room rental input */}
          {inputs.units.length === 0 && inputs.houseHack && (
            <div className="flex items-center gap-3 p-3 bg-white/[0.02] rounded-lg mb-6">
              <span className="text-white/50 text-sm">Monthly rental income:</span>
              <InputBox value={inputs.rentalIncome} prefix="$" small
                onChange={v => update('rentalIncome', v)} />
            </div>
          )}

          {/* Multi-family units */}
          {inputs.units.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
              {inputs.units.map((unit, idx) => (
                <div 
                  key={unit.id}
                  onClick={() => {
                    const newUnits = inputs.units.map((u, i) => ({ ...u, ownerOccupied: i === idx }))
                    update('units', newUnits)
                  }}
                  className={`p-3 rounded-xl border cursor-pointer transition-all ${
                    unit.ownerOccupied 
                      ? 'bg-green-900/30 border-green-500/50' 
                      : 'bg-white/[0.02] border-white/[0.08] hover:border-white/20'
                  }`}
                >
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-white/70 text-sm">{unit.beds}BR/{unit.baths}BA</span>
                    {unit.ownerOccupied && <span className="text-green-400 text-xs">🏠 You</span>}
                  </div>
                  {!unit.ownerOccupied && (
                    <input
                      type="text"
                      defaultValue={unit.monthlyRent}
                      onClick={e => e.stopPropagation()}
                      onBlur={e => {
                        const v = parseFloat(e.target.value.replace(/,/g, ''))
                        if (!isNaN(v)) {
                          const newUnits = [...inputs.units]
                          newUnits[idx] = { ...unit, monthlyRent: v }
                          update('units', newUnits)
                        }
                      }}
                      className="w-full px-2 py-1 bg-black/40 border border-white/10 rounded text-green-400 font-mono text-sm"
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Run button */}
          <button
            onClick={runSim}
            disabled={isRunning}
            className="w-full py-4 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400
                       disabled:from-gray-700 disabled:to-gray-600 disabled:cursor-not-allowed
                       rounded-xl text-white font-bold text-lg transition-all flex items-center justify-center gap-3"
          >
            {isRunning ? (
              <>
                <Spinner />
                Running {inputs.numSimulations.toLocaleString()} simulations...
              </>
            ) : (
              <>▶ Run Simulation</>
            )}
          </button>
        </div>

        {/* Advanced Settings */}
        <div className="mb-6">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-white/50 hover:text-white/70 text-sm"
          >
            <span className={`transition-transform ${showAdvanced ? 'rotate-90' : ''}`}>▶</span>
            Advanced Settings
          </button>
          {showAdvanced && (
            <div className="mt-4 p-4 bg-white/[0.02] border border-white/[0.06] rounded-xl">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <InputBox label="HOA/mo" value={inputs.hoaMonthly} prefix="$" onChange={v => update('hoaMonthly', v)} />
                <InputBox label="W2 Income" value={inputs.w2Income} prefix="$" onChange={v => update('w2Income', v)} />
                <InputBox label="Fed Tax %" value={(inputs.federalBracket*100).toFixed(0)} suffix="%" onChange={v => update('federalBracket', v/100)} />
                <InputBox label="State Tax %" value={(inputs.stateRate*100).toFixed(0)} suffix="%" onChange={v => update('stateRate', v/100)} />
                <InputBox label="Appreciation" value={(inputs.appreciationMean*100).toFixed(1)} suffix="%" onChange={v => update('appreciationMean', v/100)} />
                <InputBox label="Stock Return" value={(inputs.stockReturnMean*100).toFixed(1)} suffix="%" onChange={v => update('stockReturnMean', v/100)} />
                <InputBox label="Rent Growth" value={(inputs.rentGrowth*100).toFixed(0)} suffix="%" onChange={v => update('rentGrowth', v/100)} />
                <InputBox label="Simulations" value={inputs.numSimulations} onChange={v => update('numSimulations', v)} />
              </div>
            </div>
          )}
        </div>

        {/* Results */}
        {results && (
          <>
            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <StatCard 
                label="Buy Wins" 
                value={formatPercent(results.finalStats.buyWinsProbability)}
                color={results.finalStats.buyWinsProbability > 0.5 ? 'green' : 'red'}
              />
              <StatCard 
                label={`Median Δ (Yr ${inputs.years})`}
                value={formatCurrency(results.finalStats.delta.p50)}
                color={results.finalStats.delta.p50 > 0 ? 'green' : 'red'}
              />
              <StatCard 
                label="Downside (P10)" 
                value={formatCurrency(results.finalStats.delta.p10)}
                color="red"
              />
              <StatCard 
                label="Upside (P90)" 
                value={formatCurrency(results.finalStats.delta.p90)}
                color="green"
              />
            </div>

            {/* Wealth Chart */}
            <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 mb-6">
              <h3 className="text-white/80 font-semibold mb-4">Wealth Over Time (Median)</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="year" stroke="#9CA3AF" />
                    <YAxis stroke="#9CA3AF" tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                    <Tooltip 
                      formatter={(v: number) => formatCurrency(v)}
                      contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }}
                    />
                    <Line type="monotone" dataKey="buyP50" stroke="#10B981" strokeWidth={2} name="Buy" dot={false} />
                    <Line type="monotone" dataKey="rentP50" stroke="#EF4444" strokeWidth={2} name="Rent" dot={false} strokeDasharray="5 5" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Delta Chart */}
            <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 mb-6">
              <h3 className="text-white/80 font-semibold mb-4">Buy vs Rent Delta (P10 / P50 / P90)</h3>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="year" stroke="#9CA3AF" />
                    <YAxis stroke="#9CA3AF" tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                    <Tooltip 
                      formatter={(v: number) => formatCurrency(v)}
                      contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }}
                    />
                    <ReferenceLine y={0} stroke="#6B7280" strokeDasharray="3 3" />
                    <Area type="monotone" dataKey="deltaP90" stroke="none" fill="#3B82F6" fillOpacity={0.2} name="P90" />
                    <Area type="monotone" dataKey="deltaP50" stroke="none" fill="#3B82F6" fillOpacity={0.4} name="P50" />
                    <Area type="monotone" dataKey="deltaP10" stroke="none" fill="#3B82F6" fillOpacity={0.2} name="P10" />
                    <Line type="monotone" dataKey="deltaP50" stroke="#3B82F6" strokeWidth={2} name="Median" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Interpretation */}
            <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
              <h3 className="text-white/80 font-semibold mb-3">Interpretation</h3>
              <div className="text-sm text-white/70 space-y-2">
                <p>
                  <strong className={results.finalStats.buyWinsProbability > 0.5 ? 'text-green-400' : 'text-red-400'}>
                    {formatPercent(results.finalStats.buyWinsProbability)}
                  </strong> probability that buying beats renting over {inputs.years} years.
                </p>
                <p>
                  Median outcome: Buying {results.finalStats.delta.p50 > 0 ? 'beats' : 'loses to'} renting by{' '}
                  <strong>{formatCurrency(Math.abs(results.finalStats.delta.p50))}</strong>.
                </p>
                <p className="text-white/40 text-xs mt-4">
                  Simulated {inputs.numSimulations.toLocaleString()} scenarios with 
                  home appreciation (μ={formatPercent(inputs.appreciationMean)}, σ={formatPercent(inputs.appreciationStdDev)}) and
                  stock returns (μ={formatPercent(inputs.stockReturnMean)}, σ={formatPercent(inputs.stockReturnStdDev)}).
                </p>
              </div>
            </div>
          </>
        )}

        {/* Footer */}
        <div className="mt-8 text-center text-white/30 text-xs">
          Open source • No data collected • All calculations run locally in your browser
        </div>
      </div>
    </div>
  )
}

function InputBox({ label, value, prefix, suffix, small, onChange }: {
  label?: string
  value: number | string
  prefix?: string
  suffix?: string
  small?: boolean
  onChange: (v: number) => void
}) {
  return (
    <div className={small ? 'w-28' : ''}>
      {label && <label className="block text-xs text-white/50 mb-1">{label}</label>}
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40">{prefix}</span>}
        <input
          type="text"
          defaultValue={value}
          onBlur={e => {
            const v = parseFloat(e.target.value.replace(/,/g, ''))
            if (!isNaN(v)) onChange(v)
          }}
          className={`w-full bg-black/40 border border-white/10 rounded-xl text-white font-mono
                     focus:border-blue-500 focus:outline-none transition-colors
                     ${small ? 'py-1.5 px-2 text-sm' : 'py-2.5 text-base'}
                     ${prefix ? 'pl-7' : 'pl-3'}
                     ${suffix ? 'pr-8' : 'pr-3'}`}
        />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40">{suffix}</span>}
      </div>
    </div>
  )
}

function StatCard({ label, value, color = 'white' }: { label: string; value: string; color?: 'white' | 'green' | 'red' }) {
  const colorClass = { white: 'text-white', green: 'text-green-400', red: 'text-red-400' }[color]
  return (
    <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-4">
      <div className="text-white/50 text-xs mb-1">{label}</div>
      <div className={`text-xl font-bold font-mono ${colorClass}`}>{value}</div>
    </div>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center text-white">Loading...</div>}>
      <HouseSimulator />
    </Suspense>
  )
}

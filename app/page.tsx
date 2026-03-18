'use client'

import { useState, useMemo, useCallback, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { PageWrapper, Header, Section } from '@/components/layout'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area, ComposedChart, ReferenceLine,
} from 'recharts'
import { 
  runSimulation, defaultParams, SimulationParams, SimulationSummary,
  Unit, createMultiFamilyUnits, getUnitSummary,
  runSensitivityAnalysis, SensitivityResult,
  runBreakEvenSurface, BreakEvenSurface
} from '@/lib/monte-carlo'

// Wrapper component to handle searchParams with Suspense
function HousePageContent() {
  return <HousePageInner />
}

export default function HousePage() {
  return (
    <Suspense fallback={
      <PageWrapper>
        <Header title="House Monte Carlo Simulation" />
        <div className="text-center py-12 text-white/40">Loading...</div>
      </PageWrapper>
    }>
      <HousePageContent />
    </Suspense>
  )
}

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

function HousePageInner() {
  const searchParams = useSearchParams()
  const [inputs, setInputs] = useState<SimulationParams>(defaultParams)
  const [simResults, setSimResults] = useState<SimulationSummary | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  
  // Advanced analysis state
  const [sensitivityResults, setSensitivityResults] = useState<SensitivityResult[] | null>(null)
  const [breakEvenSurface, setBreakEvenSurface] = useState<BreakEvenSurface | null>(null)
  const [isRunningSensitivity, setIsRunningSensitivity] = useState(false)
  const [isRunningBreakEven, setIsRunningBreakEven] = useState(false)
  
  // Parse URL params to pre-populate from listings
  useEffect(() => {
    const price = searchParams.get('price')
    const rental = searchParams.get('rental')
    const hoa = searchParams.get('hoa')
    const type = searchParams.get('type') // "2-family", "3-family", etc.
    
    if (price || rental || hoa || type) {
      setInputs(prev => {
        const updates: Partial<SimulationParams> = {}
        
        if (price) updates.homePrice = parseFloat(price)
        if (hoa) updates.hoaMonthly = parseFloat(hoa)
        
        // Multi-family setup
        if (type && (type.includes('family') || type.includes('Family'))) {
          const familyType = type.toLowerCase().includes('3') ? '3-family' 
            : type.toLowerCase().includes('4') ? '4-family' 
            : '2-family'
          
          // Create default units for this type
          const units = createMultiFamilyUnits(familyType)
          
          // If we have total rental income, distribute it
          if (rental) {
            const totalRent = parseFloat(rental)
            const rentalUnits = units.filter(u => !u.ownerOccupied)
            const perUnit = totalRent / rentalUnits.length
            rentalUnits.forEach(u => { u.monthlyRent = Math.round(perUnit) })
          }
          
          updates.units = units
          updates.houseHack = true
        } else if (rental) {
          // Single family with room rental
          updates.rentalIncome = parseFloat(rental)
          updates.houseHack = true
        }
        
        return { ...prev, ...updates }
      })
    }
  }, [searchParams])
  
  const update = useCallback((key: keyof SimulationParams, value: number | boolean | object | string) => {
    setInputs(prev => ({ ...prev, [key]: value }))
  }, [])
  
  const runSim = useCallback(() => {
    setIsRunning(true)
    // Use setTimeout to allow UI to update before heavy computation
    setTimeout(() => {
      const results = runSimulation(inputs)
      setSimResults(results)
      setIsRunning(false)
    }, 50)
  }, [inputs])
  
  // Transform simulation results for charts
  const chartData = useMemo(() => {
    if (!simResults) return []
    return simResults.yearlyStats.map(y => ({
      year: y.year,
      // Buy scenario bands
      buyP10: y.wealthBuy.p10,
      buyP25: y.wealthBuy.p25,
      buyP50: y.wealthBuy.p50,
      buyP75: y.wealthBuy.p75,
      buyP90: y.wealthBuy.p90,
      buyMean: y.wealthBuy.mean,
      // Rent scenario bands
      rentP10: y.wealthRent.p10,
      rentP25: y.wealthRent.p25,
      rentP50: y.wealthRent.p50,
      rentP75: y.wealthRent.p75,
      rentP90: y.wealthRent.p90,
      rentMean: y.wealthRent.mean,
      // Delta bands
      deltaP10: y.delta.p10,
      deltaP25: y.delta.p25,
      deltaP50: y.delta.p50,
      deltaP75: y.delta.p75,
      deltaP90: y.delta.p90,
      deltaMean: y.delta.mean,
    }))
  }, [simResults])
  
  const InputField = ({ label, value, onChange, suffix = '', hint = '', prefix = '' }: {
    label: string
    value: number | string
    onChange: (v: number) => void
    suffix?: string
    hint?: string
    prefix?: string
  }) => (
    <div className="mb-4">
      <label className="block text-sm font-medium text-white/70 mb-1.5">
        {label}
        {hint && <span className="text-white/40 font-normal ml-1">({hint})</span>}
      </label>
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/60">{prefix}</span>
        )}
        <input
          type="text"
          inputMode="decimal"
          defaultValue={value}
          onBlur={(e) => {
            const parsed = parseFloat(e.target.value)
            if (!isNaN(parsed)) {
              onChange(parsed)
            } else {
              e.target.value = String(value)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const parsed = parseFloat((e.target as HTMLInputElement).value)
              if (!isNaN(parsed)) {
                onChange(parsed)
              }
              (e.target as HTMLInputElement).blur()
            }
          }}
          className={`w-full bg-[#0d0d0d] border border-gray-600 rounded-lg px-4 py-2.5 text-white text-base font-mono
                     focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none
                     hover:border-gray-500 transition-colors
                     ${prefix ? 'pl-8' : ''} ${suffix ? 'pr-12' : ''}`}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/60 font-medium">{suffix}</span>
        )}
      </div>
    </div>
  )
  
  const Stat = ({ label, value, sub = '', color = 'white' }: {
    label: string
    value: string
    sub?: string
    color?: 'white' | 'green' | 'red' | 'blue'
  }) => (
    <div className="bg-white/[0.04]/60 rounded-lg p-3 md:p-4 border border-white/[0.08]/50">
      <div className="text-white/60 text-xs md:text-sm mb-1 truncate">{label}</div>
      <div className={`text-lg md:text-2xl font-bold font-mono ${color === 'green' ? 'text-green-400' : color === 'red' ? 'text-red-400' : color === 'blue' ? 'text-blue-400' : 'text-white'}`}>
        {value}
      </div>
      {sub && <div className="text-white/40 text-xs mt-1">{sub}</div>}
    </div>
  )

  // Collapsible state
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showStrategies, setShowStrategies] = useState(false)
  
  // Calculate rental summary for display
  const rentalSummary = inputs.units.length > 0 
    ? getUnitSummary(inputs.units)
    : inputs.houseHack 
      ? { totalRent: inputs.rentalIncome, ownerPortion: 0.5, rentalPortion: 0.5 }
      : null

  return (
    <PageWrapper>
      <Header title="House vs Rent Simulator">
        <a href="/listings" className="text-[#84BABF] hover:text-[#84BABF]/80 text-sm transition-colors">
          Listings →
        </a>
      </Header>
      
      {/* ===== HERO: THE ESSENTIALS ===== */}
      <div 
        key={`hero-${inputs.homePrice}-${inputs.hoaMonthly}-${inputs.units.length}`}
        className="bg-gradient-to-br from-white/[0.03] to-transparent border border-white/[0.08] rounded-xl sm:rounded-2xl p-4 sm:p-6 mb-4 sm:mb-6"
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 mb-4 sm:mb-6">
          {/* Price */}
          <div>
            <label className="block text-xs text-white/50 mb-1">Price</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40">$</span>
              <input
                type="text"
                defaultValue={inputs.homePrice}
                onBlur={(e) => {
                  const v = parseFloat(e.target.value.replace(/,/g, ''))
                  if (!isNaN(v)) update('homePrice', v)
                }}
                className="w-full pl-7 pr-3 py-2 sm:py-3 bg-black/40 border border-white/10 rounded-xl text-white text-base sm:text-lg font-mono focus:border-[#84BABF] focus:outline-none"
              />
            </div>
          </div>
          
          {/* Down Payment */}
          <div>
            <label className="block text-xs text-white/50 mb-1">Down</label>
            <div className="relative">
              <input
                type="text"
                defaultValue={inputs.downPaymentPercent}
                onBlur={(e) => {
                  const v = parseFloat(e.target.value)
                  if (!isNaN(v)) update('downPaymentPercent', v)
                }}
                className="w-full pl-3 pr-8 py-2 sm:py-3 bg-black/40 border border-white/10 rounded-xl text-white text-base sm:text-lg font-mono focus:border-[#84BABF] focus:outline-none"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40">%</span>
            </div>
          </div>
          
          {/* Rate */}
          <div>
            <label className="block text-xs text-white/50 mb-1">Rate</label>
            <div className="relative">
              <input
                type="text"
                defaultValue={(inputs.mortgageRate * 100).toFixed(2)}
                onBlur={(e) => {
                  const v = parseFloat(e.target.value)
                  if (!isNaN(v)) update('mortgageRate', v / 100)
                }}
                className="w-full pl-3 pr-8 py-2 sm:py-3 bg-black/40 border border-white/10 rounded-xl text-white text-base sm:text-lg font-mono focus:border-[#84BABF] focus:outline-none"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40">%</span>
            </div>
          </div>
          
          {/* Your Rent */}
          <div>
            <label className="block text-xs text-white/50 mb-1">Your Rent</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40">$</span>
              <input
                type="text"
                defaultValue={inputs.currentRent}
                onBlur={(e) => {
                  const v = parseFloat(e.target.value.replace(/,/g, ''))
                  if (!isNaN(v)) update('currentRent', v)
                }}
                className="w-full pl-7 pr-3 py-2 sm:py-3 bg-black/40 border border-white/10 rounded-xl text-white text-base sm:text-lg font-mono focus:border-[#84BABF] focus:outline-none"
              />
            </div>
          </div>
          
          {/* Years */}
          <div>
            <label className="block text-xs text-white/50 mb-1">Years</label>
            <div className="relative">
              <input
                type="text"
                defaultValue={inputs.years}
                onBlur={(e) => {
                  const v = parseInt(e.target.value)
                  if (!isNaN(v) && v > 0) update('years', v)
                }}
                className="w-full pl-3 pr-8 py-2 sm:py-3 bg-black/40 border border-white/10 rounded-xl text-white text-base sm:text-lg font-mono focus:border-[#84BABF] focus:outline-none"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40">yr</span>
            </div>
          </div>
        </div>
        
        {/* Rental Strategy Quick Toggle */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-4 mb-4 sm:mb-6">
          <span className="text-white/50 text-xs sm:text-sm">Rental:</span>
          <div className="flex flex-wrap gap-1.5 sm:gap-2">
            {[
              { label: 'None', active: inputs.units.length === 0 && !inputs.houseHack },
              { label: 'Room', active: inputs.units.length === 0 && inputs.houseHack },
              { label: '2-Fam', active: inputs.units.length === 2 },
              { label: '3-Fam', active: inputs.units.length === 3 },
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
                  } else if (opt.label === '2-Fam') {
                    update('units', createMultiFamilyUnits('2-family'))
                  } else if (opt.label === '3-Fam') {
                    update('units', createMultiFamilyUnits('3-family'))
                  }
                }}
                className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                  opt.active
                    ? 'bg-[#84BABF] text-white shadow-lg shadow-[#84BABF]/20'
                    : 'bg-white/[0.04] text-white/50 hover:bg-white/[0.08] hover:text-white/70'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          
          {/* Show rental income if applicable */}
          {rentalSummary && (
            <div className="ml-auto flex items-center gap-2 text-sm">
              <span className="text-green-400 font-mono">${rentalSummary.totalRent.toLocaleString()}/mo</span>
              <span className="text-white/30">income</span>
            </div>
          )}
        </div>
        
        {/* Room Rental Input */}
        {inputs.units.length === 0 && inputs.houseHack && (
          <div className="flex items-center gap-4 p-3 bg-white/[0.02] rounded-lg mb-4">
            <span className="text-white/50 text-sm">Rental income:</span>
            <div className="relative w-32">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-white/40 text-sm">$</span>
              <input
                type="text"
                defaultValue={inputs.rentalIncome}
                onBlur={(e) => {
                  const v = parseFloat(e.target.value.replace(/,/g, ''))
                  if (!isNaN(v)) update('rentalIncome', v)
                }}
                className="w-full pl-6 pr-2 py-1.5 bg-black/40 border border-white/10 rounded-lg text-white font-mono text-sm"
              />
            </div>
            <span className="text-white/30 text-sm">/mo</span>
          </div>
        )}
        
        {/* Multi-Family Units */}
        {inputs.units.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
            {inputs.units.map((unit, idx) => (
              <div 
                key={unit.id}
                className={`p-3 rounded-xl border transition-all cursor-pointer ${
                  unit.ownerOccupied 
                    ? 'bg-green-900/30 border-green-500/50' 
                    : 'bg-white/[0.02] border-white/[0.08] hover:border-white/20'
                }`}
                onClick={() => {
                  const newUnits = inputs.units.map((u, i) => ({ ...u, ownerOccupied: i === idx }))
                  update('units', newUnits)
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-white/70 text-sm">{unit.beds}BR/{unit.baths}BA</span>
                  {unit.ownerOccupied && <span className="text-green-400 text-xs">🏠 You</span>}
                </div>
                {!unit.ownerOccupied && (
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-white/40 text-xs">$</span>
                    <input
                      type="text"
                      defaultValue={unit.monthlyRent}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => {
                        const v = parseFloat(e.target.value.replace(/,/g, ''))
                        if (!isNaN(v)) {
                          const newUnits = [...inputs.units]
                          newUnits[idx] = { ...unit, monthlyRent: v }
                          update('units', newUnits)
                        }
                      }}
                      className="w-full pl-5 pr-2 py-1 bg-black/40 border border-white/10 rounded text-green-400 font-mono text-sm"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        
        {/* Run Button */}
        <button 
          onClick={runSim}
          disabled={isRunning}
          className="w-full py-3 sm:py-4 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 
                     disabled:from-gray-700 disabled:to-gray-600 disabled:cursor-not-allowed
                     rounded-xl text-white font-bold text-base sm:text-lg shadow-lg shadow-blue-900/30
                     transition-all duration-200 hover:shadow-blue-900/50
                     flex items-center justify-center gap-2 sm:gap-3"
        >
          {isRunning ? (
            <>
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Running {inputs.numSimulations.toLocaleString()} simulations...
            </>
          ) : (
            <>▶ Run Simulation</>
          )}
        </button>
      </div>
      
      {/* ===== ADVANCED SETTINGS (Collapsible) ===== */}
      <div className="mb-6">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-2 text-white/50 hover:text-white/70 text-sm transition-colors"
        >
          <span className={`transform transition-transform ${showAdvanced ? 'rotate-90' : ''}`}>▶</span>
          Advanced Settings
        </button>
        
        {showAdvanced && (
          <div className="mt-4 p-4 bg-white/[0.02] border border-white/[0.06] rounded-xl">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              <InputField label="HOA/mo" value={inputs.hoaMonthly} onChange={(v: number) => update('hoaMonthly', v)} prefix="$" />
              <InputField label="Repairs/yr" value={inputs.majorRepairReserve} onChange={(v: number) => update('majorRepairReserve', v)} prefix="$" />
              <InputField label="Closing %" value={inputs.closingCostPercent} onChange={(v: number) => update('closingCostPercent', v)} suffix="%" />
              <InputField label="W2 Income" value={inputs.w2Income} onChange={(v: number) => update('w2Income', v)} prefix="$" />
              <InputField label="Fed Tax" value={(inputs.federalBracket * 100).toFixed(0)} onChange={(v: number) => update('federalBracket', v / 100)} suffix="%" />
              <InputField label="State Tax" value={(inputs.stateRate * 100).toFixed(0)} onChange={(v: number) => update('stateRate', v / 100)} suffix="%" />
              <InputField label="Appreciation μ" value={(inputs.appreciationMean * 100).toFixed(1)} onChange={(v: number) => update('appreciationMean', v / 100)} suffix="%" />
              <InputField label="Appreciation σ" value={(inputs.appreciationStdDev * 100).toFixed(1)} onChange={(v: number) => update('appreciationStdDev', v / 100)} suffix="%" />
              <InputField label="Stock Return μ" value={(inputs.stockReturnMean * 100).toFixed(1)} onChange={(v: number) => update('stockReturnMean', v / 100)} suffix="%" />
              <InputField label="Stock Return σ" value={(inputs.stockReturnStdDev * 100).toFixed(1)} onChange={(v: number) => update('stockReturnStdDev', v / 100)} suffix="%" />
              <InputField label="Rent Growth" value={(inputs.rentGrowth * 100).toFixed(0)} onChange={(v: number) => update('rentGrowth', v / 100)} suffix="%" />
            </div>
          </div>
        )}
      </div>
      
      {/* ===== STRATEGIES (Collapsible) ===== */}
      <div className="mb-6">
        <button
          onClick={() => setShowStrategies(!showStrategies)}
          className="flex items-center gap-2 text-white/50 hover:text-white/70 text-sm transition-colors"
        >
          <span className={`transform transition-transform ${showStrategies ? 'rotate-90' : ''}`}>▶</span>
          FTHB Benefits / HELOC Strategy / Scenarios
        </button>
        
        {showStrategies && (
          <div className="mt-4 space-y-4">
            {/* First-Time Homebuyer */}
            <div className="p-4 bg-violet-900/10 border border-violet-500/20 rounded-xl">
              <label className="flex items-center gap-3 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={inputs.firstTimeHomeBuyer?.enabled || false}
                  onChange={(e) => update('firstTimeHomeBuyer', { 
                    ...inputs.firstTimeHomeBuyer, 
                    enabled: e.target.checked,
                    noPMI: e.target.checked,
                    downPaymentAssistance: 0,
                    lowerRate: false,
                    rateDiscount: 0.0025,
                    taxCredit: 0,
                  })}
                  className="w-4 h-4 rounded border-violet-500/50 bg-black text-violet-500" 
                />
                <span className="text-violet-300 font-medium">First-Time Homebuyer (ONE Mortgage, MassHousing)</span>
              </label>
              {inputs.firstTimeHomeBuyer?.enabled && (
                <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={inputs.firstTimeHomeBuyer?.noPMI || false}
                      onChange={(e) => update('firstTimeHomeBuyer', { ...inputs.firstTimeHomeBuyer, noPMI: e.target.checked })}
                      className="w-3 h-3 rounded" />
                    <span className="text-white/70">No PMI</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={inputs.firstTimeHomeBuyer?.lowerRate || false}
                      onChange={(e) => update('firstTimeHomeBuyer', { ...inputs.firstTimeHomeBuyer, lowerRate: e.target.checked })}
                      className="w-3 h-3 rounded" />
                    <span className="text-white/70">-0.25% Rate</span>
                  </label>
                </div>
              )}
            </div>
            
            {/* HELOC Strategy */}
            <div className="p-4 bg-emerald-900/10 border border-emerald-500/20 rounded-xl">
              <label className="flex items-center gap-3 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={inputs.heloc.enabled}
                  onChange={(e) => update('heloc', { ...inputs.heloc, enabled: e.target.checked })}
                  className="w-4 h-4 rounded border-emerald-500/50 bg-black text-emerald-500" 
                />
                <span className="text-emerald-300 font-medium">HELOC → Equities (extract equity, deploy to stocks)</span>
              </label>
            </div>
            
            {/* Scenarios */}
            <div className="p-4 bg-white/[0.02] border border-white/[0.06] rounded-xl">
              <div className="text-white/50 text-sm mb-3">Scenarios</div>
              <div className="flex flex-wrap gap-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={!!inputs.scenarios.jobLoss}
                    onChange={(e) => update('scenarios', {
                      ...inputs.scenarios,
                      jobLoss: e.target.checked ? { probability: 0.05, yearRange: [1, 10] as [number, number], durationMonths: 6 } : undefined
                    })}
                    className="w-3 h-3 rounded" />
                  <span className="text-yellow-400/80">Job Loss Risk</span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={!!inputs.scenarios.refinance}
                    onChange={(e) => update('scenarios', {
                      ...inputs.scenarios,
                      refinance: e.target.checked ? { probability: 0.15, yearRange: [3, 10] as [number, number], newRate: 0.045 } : undefined
                    })}
                    className="w-3 h-3 rounded" />
                  <span className="text-blue-400/80">Refinance Opportunity</span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={!!inputs.scenarios.earlySale}
                    onChange={(e) => update('scenarios', {
                      ...inputs.scenarios,
                      earlySale: e.target.checked ? { probability: 0.03, yearRange: [3, 10] as [number, number], sellingCostPercent: 6 } : undefined
                    })}
                    className="w-3 h-3 rounded" />
                  <span className="text-red-400/80">Early Sale Risk</span>
                </label>
              </div>
            </div>
          </div>
        )}
      </div>
      
      {/* Results */}
      {simResults && (
        <>
          {/* Summary Stats */}
          <Section title="Simulation Results">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
              <Stat 
                label="Buy Wins Probability" 
                value={formatPercent(simResults.finalStats.buyWinsProbability)}
                color={simResults.finalStats.buyWinsProbability > 0.5 ? 'green' : 'red'}
                sub={`${inputs.numSimulations.toLocaleString()} simulations`}
              />
              <Stat 
                label={`Median Delta (Yr ${inputs.years})`}
                value={formatCurrency(simResults.finalStats.delta.p50)}
                color={simResults.finalStats.delta.p50 > 0 ? 'green' : 'red'}
                sub="P50"
              />
              <Stat 
                label="Worst Case Delta" 
                value={formatCurrency(simResults.finalStats.delta.p10)}
                sub="P10"
                color="red"
              />
              <Stat 
                label="Best Case Delta" 
                value={formatCurrency(simResults.finalStats.delta.p90)}
                sub="P90"
                color="green"
              />
              <Stat 
                label="Median Wealth (Buy)" 
                value={formatCurrency(simResults.finalStats.wealthBuy.p50)}
                sub="P50"
                color="blue"
              />
              <Stat 
                label="Median Wealth (Rent)" 
                value={formatCurrency(simResults.finalStats.wealthRent.p50)}
                sub="P50"
              />
            </div>
          </Section>
          
          {/* Wealth Comparison with Bands */}
          <Section title="Wealth Trajectories (P10-P90 bands)">
            <div className="h-64 md:h-80">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="year" stroke="#9CA3AF" />
                  <YAxis stroke="#9CA3AF" tickFormatter={(v) => formatCurrency(v)} />
                  <Tooltip 
                    formatter={(v: number) => formatCurrency(v)}
                    contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }}
                  />
                  <Legend />
                  
                  {/* Buy scenario band */}
                  <Area 
                    type="monotone" 
                    dataKey="buyP90" 
                    stroke="none"
                    fill="#10B981" 
                    fillOpacity={0.1}
                    name="Buy P90"
                  />
                  <Area 
                    type="monotone" 
                    dataKey="buyP10" 
                    stroke="none"
                    fill="#1F2937" 
                    fillOpacity={1}
                    name="Buy P10"
                  />
                  <Line type="monotone" dataKey="buyP50" stroke="#10B981" strokeWidth={2} name="Buy (Median)" dot={false} />
                  
                  {/* Rent scenario band */}
                  <Area 
                    type="monotone" 
                    dataKey="rentP90" 
                    stroke="none"
                    fill="#EF4444" 
                    fillOpacity={0.1}
                    name="Rent P90"
                  />
                  <Area 
                    type="monotone" 
                    dataKey="rentP10" 
                    stroke="none"
                    fill="#1F2937" 
                    fillOpacity={1}
                    name="Rent P10"
                  />
                  <Line type="monotone" dataKey="rentP50" stroke="#EF4444" strokeWidth={2} name="Rent (Median)" dot={false} strokeDasharray="5 5" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Section>
          
          {/* Delta Distribution */}
          <Section title="Buy vs Rent Delta (P10 / P25 / P50 / P75 / P90)">
            <div className="h-56 md:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="year" stroke="#9CA3AF" />
                  <YAxis stroke="#9CA3AF" tickFormatter={(v) => formatCurrency(v)} />
                  <Tooltip 
                    formatter={(v: number) => formatCurrency(v)}
                    contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }}
                  />
                  <ReferenceLine y={0} stroke="#6B7280" strokeDasharray="3 3" />
                  
                  {/* Outer band P10-P90 */}
                  <Area type="monotone" dataKey="deltaP90" stackId="1" stroke="none" fill="#3B82F6" fillOpacity={0.2} name="P90" />
                  <Area type="monotone" dataKey="deltaP75" stackId="2" stroke="none" fill="#3B82F6" fillOpacity={0.3} name="P75" />
                  <Area type="monotone" dataKey="deltaP50" stackId="3" stroke="none" fill="#3B82F6" fillOpacity={0.4} name="P50" />
                  <Area type="monotone" dataKey="deltaP25" stackId="4" stroke="none" fill="#3B82F6" fillOpacity={0.3} name="P25" />
                  <Area type="monotone" dataKey="deltaP10" stackId="5" stroke="none" fill="#3B82F6" fillOpacity={0.2} name="P10" />
                  
                  <Line type="monotone" dataKey="deltaP50" stroke="#3B82F6" strokeWidth={2} name="Median" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Section>
          
          {/* HELOC Stats (if enabled) */}
          {inputs.heloc.enabled && (
            <Section title="HELOC Activity (Sample Runs)">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="text-sm font-medium text-white/60 mb-2">Runs with HELOC Draws</h4>
                  <p className="text-2xl font-bold text-green-400">
                    {simResults.runs.filter(r => r.years.some(y => y.helocBalance > 0)).length.toLocaleString()} / {inputs.numSimulations.toLocaleString()}
                  </p>
                  <p className="text-xs text-white/40">
                    ({((simResults.runs.filter(r => r.years.some(y => y.helocBalance > 0)).length / inputs.numSimulations) * 100).toFixed(0)}% of simulations used HELOC)
                  </p>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-white/60 mb-2">Avg Final HELOC Stocks (when used)</h4>
                  {(() => {
                    const runsWithHeloc = simResults.runs.filter(r => r.years[r.years.length - 1]?.stocksFromHeloc > 0)
                    const avgStocks = runsWithHeloc.length > 0 
                      ? runsWithHeloc.reduce((sum, r) => sum + (r.years[r.years.length - 1]?.stocksFromHeloc || 0), 0) / runsWithHeloc.length
                      : 0
                    return (
                      <>
                        <p className="text-2xl font-bold text-blue-400">{formatCurrency(avgStocks)}</p>
                        <p className="text-xs text-white/40">Stocks purchased with HELOC proceeds</p>
                      </>
                    )
                  })()}
                </div>
              </div>
            </Section>
          )}
          
          {/* Detailed Table */}
          <Section title="📅 Year-by-Year Percentiles">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-white/60 border-b border-white/[0.08]">
                    <th className="text-left py-2">Year</th>
                    <th className="text-right">Buy P10</th>
                    <th className="text-right">Buy P50</th>
                    <th className="text-right">Buy P90</th>
                    <th className="text-right">Rent P10</th>
                    <th className="text-right">Rent P50</th>
                    <th className="text-right">Rent P90</th>
                    <th className="text-right">Δ P10</th>
                    <th className="text-right">Δ P50</th>
                    <th className="text-right">Δ P90</th>
                  </tr>
                </thead>
                <tbody>
                  {simResults.yearlyStats.map((y) => (
                    <tr key={y.year} className="border-b border-gray-800">
                      <td className="py-1.5">{y.year}</td>
                      <td className="text-right text-green-400/70">{formatCurrency(y.wealthBuy.p10)}</td>
                      <td className="text-right text-green-400">{formatCurrency(y.wealthBuy.p50)}</td>
                      <td className="text-right text-green-400/70">{formatCurrency(y.wealthBuy.p90)}</td>
                      <td className="text-right text-red-400/70">{formatCurrency(y.wealthRent.p10)}</td>
                      <td className="text-right text-red-400">{formatCurrency(y.wealthRent.p50)}</td>
                      <td className="text-right text-red-400/70">{formatCurrency(y.wealthRent.p90)}</td>
                      <td className={`text-right ${y.delta.p10 > 0 ? 'text-green-400/70' : 'text-red-400/70'}`}>{formatCurrency(y.delta.p10)}</td>
                      <td className={`text-right font-medium ${y.delta.p50 > 0 ? 'text-green-400' : 'text-red-400'}`}>{formatCurrency(y.delta.p50)}</td>
                      <td className={`text-right ${y.delta.p90 > 0 ? 'text-green-400/70' : 'text-red-400/70'}`}>{formatCurrency(y.delta.p90)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          
          {/* Distribution Stats */}
          <Section title="Final Distribution Details">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <h4 className="text-sm font-medium text-white/60 mb-2">Buy Scenario (Year {inputs.years})</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>Min: {formatCurrency(simResults.finalStats.wealthBuy.min)}</div>
                  <div>Max: {formatCurrency(simResults.finalStats.wealthBuy.max)}</div>
                  <div>P10: {formatCurrency(simResults.finalStats.wealthBuy.p10)}</div>
                  <div>P90: {formatCurrency(simResults.finalStats.wealthBuy.p90)}</div>
                  <div>Mean: {formatCurrency(simResults.finalStats.wealthBuy.mean)}</div>
                  <div>Median: {formatCurrency(simResults.finalStats.wealthBuy.p50)}</div>
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium text-white/60 mb-2">Rent Scenario (Year {inputs.years})</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>Min: {formatCurrency(simResults.finalStats.wealthRent.min)}</div>
                  <div>Max: {formatCurrency(simResults.finalStats.wealthRent.max)}</div>
                  <div>P10: {formatCurrency(simResults.finalStats.wealthRent.p10)}</div>
                  <div>P90: {formatCurrency(simResults.finalStats.wealthRent.p90)}</div>
                  <div>Mean: {formatCurrency(simResults.finalStats.wealthRent.mean)}</div>
                  <div>Median: {formatCurrency(simResults.finalStats.wealthRent.p50)}</div>
                </div>
              </div>
            </div>
          </Section>
          
          {/* Interpretation */}
          <Section title="📝 Interpretation">
            <div className="text-sm space-y-2">
              <p>
                <strong>Probability Buy Wins:</strong> {formatPercent(simResults.finalStats.buyWinsProbability)} — 
                In {Math.round(simResults.finalStats.buyWinsProbability * inputs.numSimulations).toLocaleString()} of {inputs.numSimulations.toLocaleString()} simulations, 
                buying outperformed renting+investing over {inputs.years} years.
              </p>
              <p>
                <strong>Median Outcome:</strong> Buying {simResults.finalStats.delta.p50 > 0 ? 'beats' : 'loses to'} renting by {formatCurrency(Math.abs(simResults.finalStats.delta.p50))} at the median.
              </p>
              <p>
                <strong>Downside Risk (P10):</strong> In the worst 10% of scenarios, buying {simResults.finalStats.delta.p10 > 0 ? 'still wins' : 'loses'} by {formatCurrency(Math.abs(simResults.finalStats.delta.p10))}.
              </p>
              <p>
                <strong>Upside (P90):</strong> In the best 10% of scenarios, buying wins by {formatCurrency(simResults.finalStats.delta.p90)}.
              </p>
              <p className="text-white/40 mt-4">
                Note: This simulation samples from normal distributions for both housing appreciation (μ={formatPercent(inputs.appreciationMean)}, σ={formatPercent(inputs.appreciationStdDev)}) 
                and stock returns (μ={formatPercent(inputs.stockReturnMean)}, σ={formatPercent(inputs.stockReturnStdDev)}). 
                Real returns have fat tails — extreme outcomes are more likely than this model suggests.
              </p>
            </div>
          </Section>
          
          {/* Advanced Analysis Section */}
          <Section title="🔬 Advanced Analysis">
            <div className="flex gap-4 mb-6">
              <button
                onClick={() => {
                  setIsRunningSensitivity(true)
                  setTimeout(() => {
                    const results = runSensitivityAnalysis(inputs, true)
                    setSensitivityResults(results)
                    setIsRunningSensitivity(false)
                  }, 50)
                }}
                disabled={isRunningSensitivity}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:cursor-not-allowed
                           rounded-lg text-white font-medium text-sm transition-colors flex items-center gap-2"
              >
                {isRunningSensitivity ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Running...
                  </>
                ) : (
                  <>🌪️ Sensitivity Analysis</>
                )}
              </button>
              
              <button
                onClick={() => {
                  setIsRunningBreakEven(true)
                  setTimeout(() => {
                    const surface = runBreakEvenSurface(inputs, 'homePrice', 'downPaymentPercent', 7)
                    setBreakEvenSurface(surface)
                    setIsRunningBreakEven(false)
                  }, 50)
                }}
                disabled={isRunningBreakEven}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:cursor-not-allowed
                           rounded-lg text-white font-medium text-sm transition-colors flex items-center gap-2"
              >
                {isRunningBreakEven ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Running...
                  </>
                ) : (
                  <>📊 Break-Even Surface</>
                )}
              </button>
            </div>
            
            {/* Sensitivity Analysis Results (Tornado Chart) */}
            {sensitivityResults && (
              <div className="mb-8">
                <h4 className="text-lg font-bold text-white mb-4">🌪️ Sensitivity Analysis</h4>
                <p className="text-white/60 text-sm mb-4">
                  Which inputs swing the outcome most? Bars show P50 delta change when varying each parameter ±10-20%.
                </p>
                <div className="space-y-3">
                  {sensitivityResults.map((result) => {
                    const maxImpact = sensitivityResults[0]?.impact || 1
                    const leftWidth = Math.abs(result.lowP50Delta - result.baseP50Delta) / maxImpact * 100
                    const rightWidth = Math.abs(result.highP50Delta - result.baseP50Delta) / maxImpact * 100
                    const leftColor = result.lowP50Delta < result.baseP50Delta ? 'bg-red-500' : 'bg-green-500'
                    const rightColor = result.highP50Delta > result.baseP50Delta ? 'bg-green-500' : 'bg-red-500'
                    
                    return (
                      <div key={result.parameter} className="flex items-center gap-4">
                        <div className="w-32 text-sm text-white/70 text-right shrink-0">
                          {result.label}
                        </div>
                        <div className="flex-1 flex items-center h-6">
                          {/* Left bar (low value effect) */}
                          <div className="flex-1 flex justify-end">
                            <div 
                              className={`h-5 ${leftColor} rounded-l`}
                              style={{ width: `${Math.min(leftWidth, 100)}%` }}
                            />
                          </div>
                          {/* Center line */}
                          <div className="w-px h-6 bg-white/40" />
                          {/* Right bar (high value effect) */}
                          <div className="flex-1">
                            <div 
                              className={`h-5 ${rightColor} rounded-r`}
                              style={{ width: `${Math.min(rightWidth, 100)}%` }}
                            />
                          </div>
                        </div>
                        <div className="w-24 text-xs text-white/50 shrink-0">
                          ±{formatCurrency(result.impact / 2)}
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="mt-4 flex justify-center gap-6 text-xs text-white/40">
                  <span>← Lower value</span>
                  <span className="text-white/60">|</span>
                  <span>Higher value →</span>
                </div>
              </div>
            )}
            
            {/* Break-Even Surface (Heatmap) */}
            {breakEvenSurface && (
              <div>
                <h4 className="text-lg font-bold text-white mb-4">📊 Break-Even Surface</h4>
                <p className="text-white/60 text-sm mb-4">
                  Win probability (buy vs rent) across {breakEvenSurface.xLabel} × {breakEvenSurface.yLabel}. 
                  Green = buy wins, Red = rent wins, Yellow = break-even.
                </p>
                <div className="overflow-x-auto">
                  <div className="inline-block">
                    {/* Y-axis label */}
                    <div className="flex">
                      <div className="w-20" />
                      <div className="flex-1 text-center text-xs text-white/60 mb-2">
                        {breakEvenSurface.xLabel}
                      </div>
                    </div>
                    
                    {/* Grid */}
                    <div className="flex">
                      {/* Y-axis */}
                      <div className="w-20 flex flex-col justify-between pr-2 text-right">
                        <div className="text-xs text-white/60 -rotate-0">
                          {breakEvenSurface.yLabel}
                        </div>
                        {breakEvenSurface.yValues.slice().reverse().map((y, i) => (
                          <div key={i} className="text-xs text-white/40 h-10 flex items-center justify-end">
                            {breakEvenSurface.yLabel.includes('%') 
                              ? `${y.toFixed(0)}%`
                              : breakEvenSurface.yLabel.includes('Rate')
                                ? `${(y * 100).toFixed(1)}%`
                                : `$${(y/1000).toFixed(0)}k`
                            }
                          </div>
                        ))}
                      </div>
                      
                      {/* Heatmap grid */}
                      <div>
                        {breakEvenSurface.yValues.slice().reverse().map((_, yi) => {
                          const actualYi = breakEvenSurface.yValues.length - 1 - yi
                          return (
                            <div key={yi} className="flex">
                              {breakEvenSurface.xValues.map((_, xi) => {
                                const cell = breakEvenSurface.cells[xi][actualYi]
                                const winRate = cell.winRate
                                // Color: red (0%) -> yellow (50%) -> green (100%)
                                const r = winRate < 0.5 ? 255 : Math.round(255 * (1 - (winRate - 0.5) * 2))
                                const g = winRate > 0.5 ? 255 : Math.round(255 * winRate * 2)
                                const b = 0
                                
                                return (
                                  <div
                                    key={xi}
                                    className="w-12 h-10 flex items-center justify-center text-xs font-bold border border-black/20"
                                    style={{ backgroundColor: `rgb(${r}, ${g}, ${b})` }}
                                    title={`${breakEvenSurface.xLabel}: ${formatCurrency(cell.x)}\n${breakEvenSurface.yLabel}: ${cell.y.toFixed(1)}%\nWin Rate: ${(winRate * 100).toFixed(0)}%\nP50 Delta: ${formatCurrency(cell.p50Delta)}`}
                                  >
                                    <span className="text-black/80">{(winRate * 100).toFixed(0)}%</span>
                                  </div>
                                )
                              })}
                            </div>
                          )
                        })}
                        
                        {/* X-axis labels */}
                        <div className="flex mt-1">
                          {breakEvenSurface.xValues.map((x, i) => (
                            <div key={i} className="w-12 text-center text-xs text-white/40">
                              ${(x/1000).toFixed(0)}k
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="mt-4 flex items-center gap-4 text-xs text-white/40">
                  <div className="flex items-center gap-1">
                    <div className="w-4 h-4 rounded" style={{ backgroundColor: 'rgb(255, 0, 0)' }} />
                    <span>Rent wins</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-4 h-4 rounded" style={{ backgroundColor: 'rgb(255, 255, 0)' }} />
                    <span>Break-even</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-4 h-4 rounded" style={{ backgroundColor: 'rgb(0, 255, 0)' }} />
                    <span>Buy wins</span>
                  </div>
                </div>
              </div>
            )}
          </Section>
        </>
      )}
      
      {!simResults && (
        <div className="text-center py-12 text-white/40">
          Configure parameters above and click &quot;Run Simulation&quot; to see Monte Carlo results.
        </div>
      )}
    </PageWrapper>
  )
}

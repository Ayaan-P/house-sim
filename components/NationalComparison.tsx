'use client'

import { useState } from 'react'
import { SimulationParams, SimulationSummary, runSimulation } from '@/lib/monte-carlo'

// National average benchmarks (2026 data)
// Sources: NAR, Census Bureau, Freddie Mac, Federal Reserve
export const NATIONAL_AVERAGES = {
  // Housing
  medianHomePrice: 412300,         // NAR median existing home price Q1 2026
  medianNewHomePrice: 487900,      // Census median new home price
  medianDownPaymentPercent: 14.5,  // NAR first-time buyer median
  medianMortgageRate: 0.0625,      // Freddie Mac PMMS 30-yr avg
  medianPropertyTaxRate: 0.0107,   // ATTOM national average
  medianInsuranceAnnual: 2377,     // III national average homeowners
  medianMaintenancePercent: 0.01,  // Rule of thumb: 1% of value
  
  // Rental
  medianRent: 1850,                // Census median asking rent
  medianRentGrowth: 0.035,         // CoStar national rent growth
  
  // Income & Taxes
  medianHouseholdIncome: 80610,    // Census median household income
  medianFederalBracket: 0.22,      // 22% bracket common at median income
  averageStateRate: 0.0435,        // Tax Foundation average state income tax
  
  // Market assumptions
  historicalAppreciation: 0.047,   // Case-Shiller long-term national avg
  historicalStockReturn: 0.10,     // S&P 500 historical avg
  
  // Holding period
  medianHoldingYears: 13,          // NAR median seller tenure
  firstTimeBuyerHold: 8,           // NAR first-time buyer median tenure
} as const

// Create national average params for simulation
export function createNationalAverageParams(): SimulationParams {
  const na = NATIONAL_AVERAGES
  return {
    homePrice: na.medianHomePrice,
    downPaymentPercent: na.medianDownPaymentPercent,
    mortgageRate: na.medianMortgageRate,
    propertyTaxRate: na.medianPropertyTaxRate,
    insuranceAnnual: na.medianInsuranceAnnual,
    closingCostPercent: 3,
    hoaMonthly: 0,
    maintenanceAnnual: na.medianHomePrice * na.medianMaintenancePercent,
    units: [],
    houseHack: false,
    rentalIncome: 0,
    rentalIncomeGrowth: 0.03,
    vacancyRate: 0.05,
    w2Income: na.medianHouseholdIncome,
    federalBracket: na.medianFederalBracket,
    stateRate: na.averageStateRate,
    filingStatus: 'single',
    buildingValuePercent: 0.80,
    closingMonth: 6,
    currentRent: na.medianRent,
    rentGrowth: na.medianRentGrowth,
    appreciationMean: na.historicalAppreciation,
    appreciationStdDev: 0.12,
    stockReturnMean: na.historicalStockReturn,
    stockReturnStdDev: 0.17,
    marketCorrelation: 0.3,
    propertyTaxGrowth: 0.02,
    insuranceGrowth: 0.05,
    sellingCostPercent: 6,
    capitalGainsTaxRate: 0.15,
    firstTimeHomeBuyer: {
      enabled: false,
      noPMI: false,
      downPaymentAssistance: 0,
      lowerRate: false,
      rateDiscount: 0,
      taxCredit: 0,
    },
    years: 10,
    numSimulations: 2000,
    heloc: {
      enabled: false,
      minEquityPercent: 0.30,
      maxLTV: 0.80,
      rate: 0.085,
      deployToStocks: true,
    },
    scenarios: {},
    taxStrategies: {
      costSegregation: { enabled: false, shortLifePercent: 0.20, year1BonusDepreciation: 1.0 },
      qbi: { enabled: false, qualifiesAsBusiness: false },
      exchange1031: { enabled: false },
    },
    exitStrategy: 'sell',
    remoteLandlord: {
      propertyManagerPercent: 0.10,
      moveOutYear: 5,
    },
  }
}

interface ComparisonMetric {
  label: string
  userValue: string
  nationalValue: string
  userNumeric: number
  nationalNumeric: number
  percentDiff: number  // positive = user higher, negative = user lower
  insight: string
  favorability: 'better' | 'worse' | 'neutral'  // For buying specifically
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', { 
    style: 'currency', 
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

function formatPercent(n: number, decimals: number = 1): string {
  return `${(n * 100).toFixed(decimals)}%`
}

function getComparisonMetrics(userParams: SimulationParams): ComparisonMetric[] {
  const na = NATIONAL_AVERAGES
  const metrics: ComparisonMetric[] = []
  
  // Home Price
  const priceDiff = (userParams.homePrice - na.medianHomePrice) / na.medianHomePrice
  metrics.push({
    label: 'Home Price',
    userValue: formatCurrency(userParams.homePrice),
    nationalValue: formatCurrency(na.medianHomePrice),
    userNumeric: userParams.homePrice,
    nationalNumeric: na.medianHomePrice,
    percentDiff: priceDiff,
    insight: priceDiff > 0.3 
      ? 'Significantly above median — high-cost market' 
      : priceDiff > 0.1 
        ? 'Above median — somewhat expensive market'
        : priceDiff < -0.1
          ? 'Below median — more affordable market'
          : 'Close to national median',
    favorability: priceDiff < 0 ? 'better' : priceDiff > 0.3 ? 'worse' : 'neutral',
  })
  
  // Down Payment %
  const downDiff = (userParams.downPaymentPercent - na.medianDownPaymentPercent) / na.medianDownPaymentPercent
  metrics.push({
    label: 'Down Payment',
    userValue: `${userParams.downPaymentPercent}%`,
    nationalValue: `${na.medianDownPaymentPercent}%`,
    userNumeric: userParams.downPaymentPercent,
    nationalNumeric: na.medianDownPaymentPercent,
    percentDiff: downDiff,
    insight: userParams.downPaymentPercent < 10 
      ? 'Low down — maximizes leverage but adds PMI' 
      : userParams.downPaymentPercent >= 20
        ? 'Strong down payment — no PMI required'
        : 'Typical down payment range',
    favorability: userParams.downPaymentPercent >= 20 ? 'better' : userParams.downPaymentPercent < 5 ? 'worse' : 'neutral',
  })
  
  // Mortgage Rate
  const rateDiff = (userParams.mortgageRate - na.medianMortgageRate) / na.medianMortgageRate
  metrics.push({
    label: 'Mortgage Rate',
    userValue: formatPercent(userParams.mortgageRate, 2),
    nationalValue: formatPercent(na.medianMortgageRate, 2),
    userNumeric: userParams.mortgageRate * 100,
    nationalNumeric: na.medianMortgageRate * 100,
    percentDiff: rateDiff,
    insight: rateDiff < -0.05 
      ? 'Below average — favorable rate environment' 
      : rateDiff > 0.05
        ? 'Above average — higher borrowing costs'
        : 'Near current market average',
    favorability: rateDiff < 0 ? 'better' : rateDiff > 0.1 ? 'worse' : 'neutral',
  })
  
  // Property Tax Rate
  const taxDiff = (userParams.propertyTaxRate - na.medianPropertyTaxRate) / na.medianPropertyTaxRate
  metrics.push({
    label: 'Property Tax',
    userValue: formatPercent(userParams.propertyTaxRate, 2),
    nationalValue: formatPercent(na.medianPropertyTaxRate, 2),
    userNumeric: userParams.propertyTaxRate * 100,
    nationalNumeric: na.medianPropertyTaxRate * 100,
    percentDiff: taxDiff,
    insight: taxDiff > 0.5 
      ? 'High tax state (NJ, IL, CT range)' 
      : taxDiff < -0.3
        ? 'Low tax state (HI, AL, CO range)'
        : 'Near national average',
    favorability: taxDiff < 0 ? 'better' : taxDiff > 0.3 ? 'worse' : 'neutral',
  })
  
  // Current Rent
  const rentDiff = (userParams.currentRent - na.medianRent) / na.medianRent
  metrics.push({
    label: 'Current Rent',
    userValue: `${formatCurrency(userParams.currentRent)}/mo`,
    nationalValue: `${formatCurrency(na.medianRent)}/mo`,
    userNumeric: userParams.currentRent,
    nationalNumeric: na.medianRent,
    percentDiff: rentDiff,
    insight: rentDiff > 0.3 
      ? 'High rent market — buying may offer savings' 
      : rentDiff < -0.2
        ? 'Low rent — renting is relatively cheap'
        : 'Typical rental market',
    favorability: rentDiff > 0.3 ? 'better' : rentDiff < -0.2 ? 'worse' : 'neutral',  // High rent makes buying more attractive
  })
  
  // Appreciation assumption
  const apprDiff = (userParams.appreciationMean - na.historicalAppreciation) / na.historicalAppreciation
  metrics.push({
    label: 'Appreciation (μ)',
    userValue: formatPercent(userParams.appreciationMean, 1),
    nationalValue: formatPercent(na.historicalAppreciation, 1),
    userNumeric: userParams.appreciationMean * 100,
    nationalNumeric: na.historicalAppreciation * 100,
    percentDiff: apprDiff,
    insight: apprDiff > 0.2 
      ? 'Optimistic — expecting above-average growth' 
      : apprDiff < -0.2
        ? 'Conservative — expecting slower growth'
        : 'Near historical average',
    favorability: apprDiff > 0 ? 'better' : apprDiff < -0.2 ? 'worse' : 'neutral',
  })
  
  // Holding period
  const yearsDiff = (userParams.years - na.firstTimeBuyerHold) / na.firstTimeBuyerHold
  metrics.push({
    label: 'Holding Period',
    userValue: `${userParams.years} years`,
    nationalValue: `${na.firstTimeBuyerHold} years`,
    userNumeric: userParams.years,
    nationalNumeric: na.firstTimeBuyerHold,
    percentDiff: yearsDiff,
    insight: userParams.years < 5 
      ? 'Short hold — transaction costs hurt returns' 
      : userParams.years >= 10
        ? 'Long hold — time for appreciation to compound'
        : 'Typical first-time buyer tenure',
    favorability: userParams.years >= 7 ? 'better' : userParams.years < 5 ? 'worse' : 'neutral',
  })
  
  // Price-to-Rent ratio (advanced insight)
  const userPriceToRent = userParams.homePrice / (userParams.currentRent * 12)
  const nationalPriceToRent = na.medianHomePrice / (na.medianRent * 12)
  const ptrDiff = (userPriceToRent - nationalPriceToRent) / nationalPriceToRent
  metrics.push({
    label: 'Price-to-Rent',
    userValue: `${userPriceToRent.toFixed(1)}x`,
    nationalValue: `${nationalPriceToRent.toFixed(1)}x`,
    userNumeric: userPriceToRent,
    nationalNumeric: nationalPriceToRent,
    percentDiff: ptrDiff,
    insight: userPriceToRent > 25 
      ? 'Expensive to buy vs rent (consider renting longer)' 
      : userPriceToRent < 15
        ? 'Cheap to buy vs rent (buying favored)'
        : 'Balanced market',
    favorability: userPriceToRent < 15 ? 'better' : userPriceToRent > 25 ? 'worse' : 'neutral',
  })
  
  return metrics
}

interface NationalComparisonProps {
  userParams: SimulationParams
  userResults: SimulationSummary | null
}

export function NationalComparison({ userParams, userResults }: NationalComparisonProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [nationalResults, setNationalResults] = useState<SimulationSummary | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  
  const metrics = getComparisonMetrics(userParams)
  
  // Count favorable vs unfavorable metrics
  const betterCount = metrics.filter(m => m.favorability === 'better').length
  const worseCount = metrics.filter(m => m.favorability === 'worse').length
  
  // Run national average simulation for comparison
  const runNationalSim = () => {
    if (nationalResults) return
    setIsRunning(true)
    setTimeout(() => {
      const nationalParams = createNationalAverageParams()
      // Match user's holding period for fair comparison
      nationalParams.years = userParams.years
      const results = runSimulation(nationalParams)
      setNationalResults(results)
      setIsRunning(false)
    }, 50)
  }
  
  return (
    <div className="bg-gradient-to-br from-indigo-900/20 to-purple-900/20 dark:from-indigo-900/20 dark:to-purple-900/20 border border-indigo-500/30 rounded-xl p-4">
      <button
        onClick={() => {
          setIsExpanded(!isExpanded)
          if (!nationalResults) runNationalSim()
        }}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">🇺🇸</span>
          <div>
            <h3 className="text-content font-bold">Compare to National Average</h3>
            <p className="text-content-subtle text-sm">See how your scenario stacks up against the typical US homebuyer</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Quick summary badges */}
          <div className="hidden sm:flex items-center gap-2">
            {betterCount > 0 && (
              <span className="px-2 py-0.5 bg-green-500/20 border border-green-500/40 rounded-full text-green-600 dark:text-green-400 text-xs">
                {betterCount} better
              </span>
            )}
            {worseCount > 0 && (
              <span className="px-2 py-0.5 bg-red-500/20 border border-red-500/40 rounded-full text-red-600 dark:text-red-400 text-xs">
                {worseCount} worse
              </span>
            )}
          </div>
          <span className={`transform transition-transform text-content-subtle ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
        </div>
      </button>
      
      {isExpanded && (
        <div className="mt-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Overview comparison */}
          {userResults && nationalResults && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-surface-muted rounded-xl border border-border">
              <div className="text-center p-3 rounded-lg bg-indigo-900/30 dark:bg-indigo-900/30">
                <div className="text-content-subtle text-sm mb-1">Your Scenario</div>
                <div className={`text-2xl font-bold ${userResults.finalStats.delta.p50 > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {userResults.finalStats.buyWinsProbability > 0.5 ? 'Buy wins' : 'Rent wins'} {(userResults.finalStats.buyWinsProbability * 100).toFixed(0)}%
                </div>
                <div className="text-content-muted text-sm mt-1">
                  P50 Delta: {formatCurrency(userResults.finalStats.delta.p50)}
                </div>
              </div>

              <div className="text-center p-3 rounded-lg bg-purple-900/30 dark:bg-purple-900/30">
                <div className="text-content-subtle text-sm mb-1">National Average</div>
                <div className={`text-2xl font-bold ${nationalResults.finalStats.delta.p50 > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {nationalResults.finalStats.buyWinsProbability > 0.5 ? 'Buy wins' : 'Rent wins'} {(nationalResults.finalStats.buyWinsProbability * 100).toFixed(0)}%
                </div>
                <div className="text-content-muted text-sm mt-1">
                  P50 Delta: {formatCurrency(nationalResults.finalStats.delta.p50)}
                </div>
              </div>
            </div>
          )}

          {isRunning && (
            <div className="text-center py-4 text-content-subtle">
              <svg className="animate-spin h-5 w-5 mx-auto mb-2" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Running national average simulation...
            </div>
          )}

          {/* Metric comparison table */}
          <div className="space-y-2">
            <h4 className="text-content-muted text-sm font-medium">Input Comparison</h4>
            <div className="grid grid-cols-1 gap-2">
              {metrics.map((metric) => (
                <div
                  key={metric.label}
                  className={`p-3 rounded-lg border transition-colors ${
                    metric.favorability === 'better'
                      ? 'bg-green-900/10 border-green-500/30 hover:border-green-500/50'
                      : metric.favorability === 'worse'
                        ? 'bg-red-900/10 border-red-500/30 hover:border-red-500/50'
                        : 'bg-surface-muted border-border hover:border-content-subtle'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-[150px]">
                      <span className={`text-sm font-medium ${
                        metric.favorability === 'better' ? 'text-green-600 dark:text-green-400' :
                        metric.favorability === 'worse' ? 'text-red-600 dark:text-red-400' : 'text-content-muted'
                      }`}>
                        {metric.label}
                      </span>
                    </div>

                    <div className="flex items-center gap-4 text-sm">
                      <div className="text-right">
                        <span className="text-content-subtle">You: </span>
                        <span className="text-content font-mono">{metric.userValue}</span>
                      </div>
                      <div className="text-content-subtle">vs</div>
                      <div className="text-right">
                        <span className="text-content-subtle">US: </span>
                        <span className="text-content-muted font-mono">{metric.nationalValue}</span>
                      </div>
                      <div className="w-16 text-right font-mono text-xs text-content-subtle">
                        {metric.percentDiff >= 0 ? '+' : ''}{(metric.percentDiff * 100).toFixed(0)}%
                      </div>
                    </div>
                  </div>

                  <div className="text-content-subtle text-xs mt-1.5">
                    {metric.insight}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-content-subtle pt-2 border-t border-border">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-green-500/30 border border-green-500/50" />
              <span>Favors buying</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-red-500/30 border border-red-500/50" />
              <span>Favors renting</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-surface-muted border border-border" />
              <span>Neutral</span>
            </div>
            <span className="ml-auto">
              Data: NAR, Census, Freddie Mac (Q1 2026)
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

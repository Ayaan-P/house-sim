// Monte Carlo simulation engine for house vs rent analysis

// ============================================
// MAINTENANCE SHOCK MODEL
// ============================================

export interface MaintenanceComponent {
  name: string
  replacementCost: number
  lifespanYears: number
  ageAtPurchase: number   // Age of component when bought the house (0 = brand new)
  failureProbability: (age: number) => number  // Returns 0-1 probability of failure this year
}

// Bathtub curve: high early failure (infant mortality), low middle, high end-of-life
function bathtubCurve(age: number, lifespanYears: number): number {
  if (age <= 0) return 0.005  // Tiny infant mortality risk
  const normalizedAge = age / lifespanYears
  if (normalizedAge < 0.1) {
    // Infant mortality: declining from ~3% to baseline
    return 0.03 * (1 - normalizedAge / 0.1) + 0.005
  } else if (normalizedAge < 0.7) {
    // Useful life: low constant failure rate ~1%
    return 0.01
  } else {
    // Wear-out phase: exponentially increasing from 1% to ~40% at end of life
    const wearOutProgress = (normalizedAge - 0.7) / 0.3
    return 0.01 + 0.39 * Math.pow(wearOutProgress, 2)
  }
}

// Linear failure: simple increasing probability with age
function linearFailure(age: number, lifespanYears: number): number {
  if (age <= 0) return 0.005
  const normalizedAge = age / lifespanYears
  // Linear increase from ~1% to ~50% at end of life
  return 0.01 + 0.49 * normalizedAge
}

// Default components with realistic costs and lifespans
export const defaultMaintenanceComponents: MaintenanceComponent[] = [
  {
    name: 'Roof',
    replacementCost: 15000,
    lifespanYears: 25,
    ageAtPurchase: 0,
    failureProbability: (age: number) => bathtubCurve(age, 25),
  },
  {
    name: 'HVAC',
    replacementCost: 8000,
    lifespanYears: 15,
    ageAtPurchase: 0,
    failureProbability: (age: number) => bathtubCurve(age, 15),
  },
  {
    name: 'Water Heater',
    replacementCost: 2000,
    lifespanYears: 12,
    ageAtPurchase: 0,
    failureProbability: (age: number) => linearFailure(age, 12),
  },
  {
    name: 'Appliances',
    replacementCost: 5000,
    lifespanYears: 10,
    ageAtPurchase: 0,
    failureProbability: (age: number) => linearFailure(age, 10),
  },
]

export interface MaintenanceShockConfig {
  enabled: boolean
  components: MaintenanceComponent[]
}

export interface MajorRepair {
  year: number
  component: string
  cost: number
}

export interface YearMaintenanceDetail {
  maintenanceBase: number      // Routine maintenance (30% of smooth budget)
  maintenanceShocks: number    // Total shock costs this year
  maintenanceTotal: number    // Base + shocks
  majorRepairs: MajorRepair[]  // Individual failures this year
}

// Unit configuration for multi-family properties
export interface Unit {
  id: string              // "unit1", "unit2", etc.
  name: string            // "Unit 1 (2BR/1BA)" for display
  beds: number
  baths: number
  sqft?: number           // Optional, used for owner portion calc if available
  monthlyRent: number     // Estimated market rent for this unit
  ownerOccupied: boolean  // True if owner lives here
}

export const stateTaxProfiles = {
  ma: { label: 'Massachusetts', stateRate: 0.05, propertyTaxRate: 0.011, propertyTaxGrowth: 0.02 },
  ca: { label: 'California', stateRate: 0.093, propertyTaxRate: 0.0075, propertyTaxGrowth: 0.02 },
  ny: { label: 'New York', stateRate: 0.0685, propertyTaxRate: 0.014, propertyTaxGrowth: 0.02 },
  nj: { label: 'New Jersey', stateRate: 0.0637, propertyTaxRate: 0.022, propertyTaxGrowth: 0.02 },
  il: { label: 'Illinois', stateRate: 0.0495, propertyTaxRate: 0.021, propertyTaxGrowth: 0.02 },
  tx: { label: 'Texas', stateRate: 0, propertyTaxRate: 0.018, propertyTaxGrowth: 0.03 },
  fl: { label: 'Florida', stateRate: 0, propertyTaxRate: 0.009, propertyTaxGrowth: 0.02 },
  wa: { label: 'Washington', stateRate: 0, propertyTaxRate: 0.009, propertyTaxGrowth: 0.02 },
  nh: { label: 'New Hampshire', stateRate: 0, propertyTaxRate: 0.018, propertyTaxGrowth: 0.02 },
  custom: { label: 'Custom', stateRate: 0.05, propertyTaxRate: 0.011, propertyTaxGrowth: 0.02 },
} as const

export type StateTaxProfileKey = keyof typeof stateTaxProfiles

export function getStateTaxProfileLabel(profile: StateTaxProfileKey): string {
  return stateTaxProfiles[profile].label
}

// Helper to create unit templates for common property types
export function createMultiFamilyUnits(type: '2-family' | '3-family' | '4-family', config?: {
  bedBathPerUnit?: Array<{ beds: number; baths: number; sqft?: number }>
  estimatedRents?: number[]
  ownerUnitIndex?: number  // Which unit owner lives in (0-indexed)
}): Unit[] {
  const numUnits = type === '2-family' ? 2 : type === '3-family' ? 3 : 4
  const defaults: Record<string, Array<{ beds: number; baths: number; sqft?: number; rent: number }>> = {
    '2-family': [
      { beds: 2, baths: 1, rent: 2200 },
      { beds: 3, baths: 1, rent: 2800 },
    ],
    '3-family': [
      { beds: 2, baths: 1, rent: 2000 },
      { beds: 2, baths: 1, rent: 2000 },
      { beds: 2, baths: 1, rent: 2000 },
    ],
    '4-family': [
      { beds: 2, baths: 1, rent: 1800 },
      { beds: 2, baths: 1, rent: 1800 },
      { beds: 2, baths: 1, rent: 1800 },
      { beds: 2, baths: 1, rent: 1800 },
    ],
  }
  
  const unitDefaults = defaults[type]
  const ownerUnitIndex = config?.ownerUnitIndex ?? 0
  
  return Array.from({ length: numUnits }, (_, i) => {
    const defaultUnit = unitDefaults[i] || { beds: 2, baths: 1, rent: 2000 }
    const unitConfig = config?.bedBathPerUnit?.[i] || defaultUnit
    const rent = config?.estimatedRents?.[i] || defaultUnit.rent
    return {
      id: `unit${i + 1}`,
      name: `Unit ${i + 1} (${unitConfig.beds}BR/${unitConfig.baths}BA)`,
      beds: unitConfig.beds,
      baths: unitConfig.baths,
      sqft: unitConfig.sqft,
      monthlyRent: rent,
      ownerOccupied: i === ownerUnitIndex,
    }
  })
}

// Calculate summary from units
export function getUnitSummary(units: Unit[]): {
  totalBeds: number
  totalBaths: number
  totalRent: number
  ownerPortion: number
  rentalPortion: number
  ownerUnit: Unit | undefined
  rentalUnits: Unit[]
} {
  const ownerUnits = units.filter(u => u.ownerOccupied)
  const rentalUnits = units.filter(u => !u.ownerOccupied)
  const totalRent = rentalUnits.reduce((sum, u) => sum + u.monthlyRent, 0)
  
  // Calculate portions
  const hasSqft = units.every(u => u.sqft && u.sqft > 0)
  let ownerPortion: number
  if (hasSqft) {
    const totalSqft = units.reduce((sum, u) => sum + (u.sqft || 0), 0)
    const ownerSqft = ownerUnits.reduce((sum, u) => sum + (u.sqft || 0), 0)
    ownerPortion = ownerSqft / totalSqft
  } else {
    ownerPortion = ownerUnits.length / units.length
  }
  
  return {
    totalBeds: units.reduce((sum, u) => sum + u.beds, 0),
    totalBaths: units.reduce((sum, u) => sum + u.baths, 0),
    totalRent,
    ownerPortion,
    rentalPortion: 1 - ownerPortion,
    ownerUnit: ownerUnits[0],
    rentalUnits,
  }
}

export interface SimulationParams {
  // House
  homePrice: number
  downPaymentPercent: number
  mortgageRate: number
  propertyTaxRate: number
  insuranceAnnual: number
  
  // Additional costs
  closingCostPercent: number      // Upfront closing costs (2-5%)
  hoaMonthly: number              // HOA fees
  maintenanceAnnual: number       // Annual maintenance/repair reserve (flat $, not % of home value)
  
  // Multi-family configuration
  units: Unit[]                   // Empty array = single-family mode (uses legacy rentalIncome)
  
  // House hack (legacy single-family mode, ignored if units[] is populated)
  houseHack: boolean
  rentalIncome: number
  rentalIncomeGrowth: number      // Annual growth rate
  vacancyRate: number             // % of year unit is vacant (0-1)
  
  // Tax
  stateProfile: StateTaxProfileKey
  w2Income: number
  federalBracket: number
  stateRate: number
  filingStatus: 'single' | 'married'  // Affects standard deduction & cap gains exemption
  buildingValuePercent: number        // % of home value that's building (not land) — affects depreciation
  
  // Closing timing
  closingMonth: number                // 1-12 (Jan-Dec). Affects Year 1 proration.
  
  // Alternative
  currentRent: number
  rentGrowth: number              // Legacy: fixed rent growth rate (used when rentStochasticGrowth = false)
  rentGrowthMean: number          // Stochastic: mean annual rent growth
  rentGrowthStdDev: number        // Stochastic: std dev of annual rent growth
  rentHomeCorrelation: number    // Correlation between rent growth & home appreciation (0-1, real-world ~0.6-0.8)
  rentFloor: number              // Stochastic: rent doesn't drop below this % of previous year (sticky downward, e.g. 0.97 = max 3% drop)
  rentStochasticGrowth: boolean  // Enable stochastic rent growth (vs fixed %)
  alternativeInvestmentPreset: 'sp500' | 'balanced' | 'cash' | 'custom'
  
  // Distributions (mean, stdDev)
  appreciationMean: number
  appreciationStdDev: number
  stockReturnMean: number
  stockReturnStdDev: number
  marketCorrelation: number        // Correlation between housing & stocks (0-1)
  
  // Cost growth
  propertyTaxGrowth: number        // Annual property tax increase
  insuranceGrowth: number          // Annual insurance cost increase
  
  // Exit costs
  sellingCostPercent: number       // Realtor + closing when selling (5-6%)
  capitalGainsTaxRate: number      // Tax on gains above $250k exemption
  
  // First-time homebuyer benefits
  firstTimeHomeBuyer: {
    enabled: boolean
    noPMI: boolean                   // ONE Mortgage / MassHousing - no PMI
    downPaymentAssistance: number    // Grant/loan amount (e.g., $15k-$50k)
    lowerRate: boolean               // Some programs offer 0.25-0.5% lower rates
    rateDiscount: number             // Rate discount amount (e.g., 0.005 = 0.5%)
    taxCredit: number                // Annual tax credit (e.g., MCC = mortgage interest credit)
  }
  
  // Simulation
  years: number
  numSimulations: number
  
  // HELOC strategy
  heloc: {
    enabled: boolean
    minEquityPercent: number    // Min equity % before taking HELOC (e.g., 30%)
    maxLTV: number              // Max combined LTV (e.g., 80%)
    rate: number                // HELOC interest rate
    deployToStocks: boolean     // Deploy HELOC proceeds to stocks
  }
  
  // Scenarios
  scenarios: {
    jobLoss?: { probability: number; yearRange: [number, number]; durationMonths: number }
    refinance?: { probability: number; yearRange: [number, number]; newRate: number }
    earlySale?: { probability: number; yearRange: [number, number]; sellingCostPercent: number }
  }
  
  // Advanced tax strategies
  taxStrategies: {
    // Cost Segregation Study - accelerate depreciation on 5/7/15 year assets
    costSegregation: {
      enabled: boolean
      // Typical breakdown: 15-25% of building value can be reclassified
      shortLifePercent: number     // % of building value that's 5/7/15 year property (default 0.20)
      year1BonusDepreciation: number  // 100% in 2026 under OBBBA (default 1.0)
    }
    // QBI Deduction (Section 199A) - 20% deduction on qualified business income
    qbi: {
      enabled: boolean
      // Safe harbor: 250+ hours/year managing property = qualifies as trade/business
      qualifiesAsBusiness: boolean
    }
    // 1031 Exchange - defer capital gains on sale by reinvesting
    exchange1031: {
      enabled: boolean
      // If enabled, capital gains and depreciation recapture are deferred (not taxed at sale)
    }
  }
  
  // Exit strategy - how wealth is calculated at end of simulation
  exitStrategy: 'sell' | 'hold' | '1031' | 'remote'
  // sell: Sell property, pay all taxes (default, most conservative)
  // hold: Never sell, paper equity only (no selling costs, no taxes)
  // 1031: Exchange into like-kind property, defer all taxes
  // remote: Move away, property becomes 100% rental, property manager fees
  
  // Remote landlord settings (only used if exitStrategy = 'remote')
  remoteLandlord: {
    propertyManagerPercent: number  // PM fee as % of rent (typically 8-10%)
    moveOutYear: number             // Year you move out and go full rental
  }

  // Maintenance shock model
  maintenanceShock: MaintenanceShockConfig
}

export interface YearResult {
  year: number
  // Buy scenario
  homeValue: number
  loanBalance: number
  helocBalance: number
  equity: number
  stocksFromHeloc: number  // Stocks purchased with HELOC proceeds
  buyerStockPortfolio: number  // Stocks from rent savings when buying is cheaper (Samar fix)
  yearCostBuy: number
  cumulativeCostBuy: number
  wealthBuy: number        // equity + stocks - heloc debt + buyer savings
  // Rent scenario
  yearRent: number
  cumulativeCostRent: number
  stockPortfolio: number
  wealthRent: number
  // Delta
  delta: number
  // Events
  events: string[]
  // Maintenance shock details (null if shock model disabled)
  maintenanceDetail?: YearMaintenanceDetail
}

export interface SimulationRun {
  id: number
  years: YearResult[]
  finalWealthBuy: number
  finalWealthRent: number
  finalDelta: number
  events: string[]
  exitDetails?: {
    sellingCosts: number
    capitalGainsTax: number
    depreciationRecapture: number
    netProceeds: number
  }
  majorRepairs: MajorRepair[]  // All major repairs across all years
}

export interface RentalInvestmentMetrics {
  cashOnCashReturn: number    // Annual cash flow / total cash invested
  capRate: number             // NOI / property value
  monthlyCashFlow: number     // Rent - all monthly expenses
  passesOnePercentRule: boolean // Monthly rent >= 1% of purchase price
}

export interface SimulationSummary {
  // Percentile results for each year
  yearlyStats: {
    year: number
    wealthBuy: { p10: number; p25: number; p50: number; p75: number; p90: number; mean: number }
    wealthRent: { p10: number; p25: number; p50: number; p75: number; p90: number; mean: number }
    delta: { p10: number; p25: number; p50: number; p75: number; p90: number; mean: number }
    maintenanceShocks?: { p10: number; p50: number; p90: number; mean: number }
  }[]
  // Final outcomes
  finalStats: {
    wealthBuy: { p10: number; p25: number; p50: number; p75: number; p90: number; mean: number; min: number; max: number }
    wealthRent: { p10: number; p25: number; p50: number; p75: number; p90: number; mean: number; min: number; max: number }
    delta: { p10: number; p25: number; p50: number; p75: number; p90: number; mean: number; min: number; max: number }
    buyWinsProbability: number
  }
  // BiggerPockets-style rental investment metrics
  rentalMetrics: RentalInvestmentMetrics
  // Maintenance shock summary (null if shock model disabled)
  shockSummary: ShockSummary | null
  // All runs (for detailed analysis)
  runs: SimulationRun[]
}

export interface ShockSummary {
  // Probability of at least one major repair in years 1-3
  probRepairYears1to3: number
  // Probability of at least one major repair in any year
  probAnyRepair: number
  // Average total shock cost over simulation horizon
  avgTotalShockCost: number
  // Emergency fund recommendation (90th percentile of worst-year shock)
  emergencyFundRec: number
  // Per-component failure rates
  componentFailureRates: Array<{
    name: string
    failureRate: number  // % of simulations where this component failed at least once
    avgReplacementYear: number  // Average year of first replacement
  }>
  // Cash crunch: years where P10 wealth delta goes negative due to shocks
  cashCrunchYears: number[]
}

export const alternativeInvestmentPresets = {
  sp500: {
    label: 'S&P 500',
    description: 'Higher growth, higher volatility',
    mean: 0.10,
    stdDev: 0.17,
  },
  balanced: {
    label: '60/40 Portfolio',
    description: 'Balanced stocks and bonds',
    mean: 0.07,
    stdDev: 0.10,
  },
  cash: {
    label: 'Cash / T-Bills',
    description: 'Lower return, lower volatility',
    mean: 0.04,
    stdDev: 0.02,
  },
  custom: {
    label: 'Custom',
    description: 'Set your own return and volatility',
    mean: 0.10,
    stdDev: 0.17,
  },
} as const

export function getAlternativeInvestmentLabel(params: Pick<SimulationParams, 'alternativeInvestmentPreset' | 'stockReturnMean' | 'stockReturnStdDev'>): string {
  if (params.alternativeInvestmentPreset === 'custom') {
    return `Custom Portfolio (${Math.round(params.stockReturnMean * 100)}% / ${Math.round(params.stockReturnStdDev * 100)}% σ)`
  }
  return alternativeInvestmentPresets[params.alternativeInvestmentPreset].label
}

// Box-Muller transform for normal distribution
function randomNormal(mean: number, stdDev: number): number {
  const u1 = Math.random()
  const u2 = Math.random()
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return z0 * stdDev + mean
}

// Generate correlated normal random variables
function correlatedNormals(
  mean1: number, std1: number,
  mean2: number, std2: number,
  correlation: number
): [number, number] {
  const u1 = Math.random()
  const u2 = Math.random()
  const z1 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  const z2 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2)
  
  // Create correlated z2
  const z2Correlated = correlation * z1 + Math.sqrt(1 - correlation * correlation) * z2
  
  return [
    z1 * std1 + mean1,
    z2Correlated * std2 + mean2
  ]
}

// Percentile calculation
function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = (p / 100) * (sorted.length - 1)
  const lower = Math.floor(idx)
  const upper = Math.ceil(idx)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower)
}

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

export function runSimulation(params: SimulationParams): SimulationSummary {
  const runs: SimulationRun[] = []
  
  for (let sim = 0; sim < params.numSimulations; sim++) {
    const run = simulateSingleRun(params, sim)
    runs.push(run)
  }
  
  // Calculate yearly statistics
  const yearlyStats = []
  const shockEnabled = params.maintenanceShock?.enabled ?? false
  
  for (let year = 1; year <= params.years; year++) {
    const wealthBuyValues = runs.map(r => r.years[year - 1]?.wealthBuy || 0)
    const wealthRentValues = runs.map(r => r.years[year - 1]?.wealthRent || 0)
    const deltaValues = runs.map(r => r.years[year - 1]?.delta || 0)
    
    const yearStats: SimulationSummary['yearlyStats'][number] = {
      year,
      wealthBuy: {
        p10: percentile(wealthBuyValues, 10),
        p25: percentile(wealthBuyValues, 25),
        p50: percentile(wealthBuyValues, 50),
        p75: percentile(wealthBuyValues, 75),
        p90: percentile(wealthBuyValues, 90),
        mean: mean(wealthBuyValues),
      },
      wealthRent: {
        p10: percentile(wealthRentValues, 10),
        p25: percentile(wealthRentValues, 25),
        p50: percentile(wealthRentValues, 50),
        p75: percentile(wealthRentValues, 75),
        p90: percentile(wealthRentValues, 90),
        mean: mean(wealthRentValues),
      },
      delta: {
        p10: percentile(deltaValues, 10),
        p25: percentile(deltaValues, 25),
        p50: percentile(deltaValues, 50),
        p75: percentile(deltaValues, 75),
        p90: percentile(deltaValues, 90),
        mean: mean(deltaValues),
      },
    }
    
    // Add shock percentiles if shock model is enabled
    if (shockEnabled) {
      const shockValues = runs.map(r => r.years[year - 1]?.maintenanceDetail?.maintenanceShocks || 0)
      ;(yearStats as Record<string, unknown>).maintenanceShocks = {
        p10: percentile(shockValues, 10),
        p25: percentile(shockValues, 25),
        p50: percentile(shockValues, 50),
        p75: percentile(shockValues, 75),
        p90: percentile(shockValues, 90),
        mean: mean(shockValues),
      }
    }
    
    yearlyStats.push(yearStats)
  }
  
  // Final statistics
  const finalWealthBuy = runs.map(r => r.finalWealthBuy)
  const finalWealthRent = runs.map(r => r.finalWealthRent)
  const finalDelta = runs.map(r => r.finalDelta)

  // BiggerPockets-style rental investment metrics (deterministic, Year 1 snapshot)
  const rentalMetrics = calculateRentalMetrics(params)

  return {
    yearlyStats,
    finalStats: {
      wealthBuy: {
        p10: percentile(finalWealthBuy, 10),
        p25: percentile(finalWealthBuy, 25),
        p50: percentile(finalWealthBuy, 50),
        p75: percentile(finalWealthBuy, 75),
        p90: percentile(finalWealthBuy, 90),
        mean: mean(finalWealthBuy),
        min: Math.min(...finalWealthBuy),
        max: Math.max(...finalWealthBuy),
      },
      wealthRent: {
        p10: percentile(finalWealthRent, 10),
        p25: percentile(finalWealthRent, 25),
        p50: percentile(finalWealthRent, 50),
        p75: percentile(finalWealthRent, 75),
        p90: percentile(finalWealthRent, 90),
        mean: mean(finalWealthRent),
        min: Math.min(...finalWealthRent),
        max: Math.max(...finalWealthRent),
      },
      delta: {
        p10: percentile(finalDelta, 10),
        p25: percentile(finalDelta, 25),
        p50: percentile(finalDelta, 50),
        p75: percentile(finalDelta, 75),
        p90: percentile(finalDelta, 90),
        mean: mean(finalDelta),
        min: Math.min(...finalDelta),
        max: Math.max(...finalDelta),
      },
      buyWinsProbability: finalDelta.filter(d => d > 0).length / finalDelta.length,
    },
    rentalMetrics,
    shockSummary: shockEnabled ? computeShockSummary(runs, params) : null,
    runs,
  }
}

function computeShockSummary(runs: SimulationRun[], params: SimulationParams): ShockSummary {
  const components = params.maintenanceShock?.components ?? []
  const years = params.years
  
  // Probability of at least one major repair in years 1-3
  const runsWithRepairYears1to3 = runs.filter(r => 
    r.majorRepairs.some(rep => rep.year <= 3)
  )
  
  // Probability of at least one major repair in any year
  const runsWithAnyRepair = runs.filter(r => r.majorRepairs.length > 0)
  
  // Average total shock cost
  const avgTotalShockCost = mean(runs.map(r => 
    r.years.reduce((sum, yr) => sum + (yr.maintenanceDetail?.maintenanceShocks || 0), 0)
  ))
  
  // Emergency fund: 90th percentile of the worst-year shock cost
  const worstYearShocks = runs.map(r => {
    const yearlyShocks = r.years.map(yr => yr.maintenanceDetail?.maintenanceShocks || 0)
    return Math.max(...yearlyShocks)
  })
  const emergencyFundRec = percentile(worstYearShocks, 90)
  
  // Per-component failure rates
  const componentFailureRates = components.map(comp => {
    const runsWhereFailed = runs.filter(r => 
      r.majorRepairs.some(rep => rep.component === comp.name)
    )
    const firstReplacements = runs
      .filter(r => r.majorRepairs.some(rep => rep.component === comp.name))
      .map(r => {
        const first = r.majorRepairs.find(rep => rep.component === comp.name)
        return first ? first.year : years
      })
    return {
      name: comp.name,
      failureRate: runsWhereFailed.length / runs.length,
      avgReplacementYear: firstReplacements.length > 0 ? mean(firstReplacements) : years,
    }
  })
  
  // Cash crunch years: years where P10 delta goes negative
  const cashCrunchYears: number[] = []
  for (let yr = 1; yr <= years; yr++) {
    const yearlyShocks = runs.map(r => r.years[yr - 1]?.maintenanceDetail?.maintenanceShocks || 0)
    if (percentile(yearlyShocks, 10) > 0) {
      // Check if this shock year makes buying significantly worse
      const deltasWithShock = runs.map(r => r.years[yr - 1]?.delta || 0)
      if (percentile(deltasWithShock, 10) < 0) {
        cashCrunchYears.push(yr)
      }
    }
  }
  
  return {
    probRepairYears1to3: runsWithRepairYears1to3.length / runs.length,
    probAnyRepair: runsWithAnyRepair.length / runs.length,
    avgTotalShockCost,
    emergencyFundRec,
    componentFailureRates,
    cashCrunchYears,
  }
}

function calculateRentalMetrics(params: SimulationParams): RentalInvestmentMetrics {
  const {
    homePrice, downPaymentPercent, mortgageRate, propertyTaxRate,
    insuranceAnnual, houseHack, rentalIncome, vacancyRate,
  } = params

  // Monthly gross rent (from all rental units)
  const units = params.units || []
  const isMultiFamily = units.length > 0
  let monthlyGrossRent: number
  if (isMultiFamily) {
    monthlyGrossRent = units.filter(u => !u.ownerOccupied).reduce((sum, u) => sum + u.monthlyRent, 0)
  } else {
    monthlyGrossRent = houseHack ? rentalIncome : 0
  }

  // Cash invested = down payment + closing costs
  const downPayment = homePrice * (downPaymentPercent / 100)
  const closingCosts = homePrice * (params.closingCostPercent / 100)
  const cashInvested = downPayment + closingCosts

  // Annual gross rent (vacancy-adjusted)
  const annualGrossRent = monthlyGrossRent * 12 * (1 - (vacancyRate || 0))

  // Operating expenses (NO mortgage) - for NOI calculation
  const annualPropertyTax = homePrice * propertyTaxRate
  const annualInsurance = insuranceAnnual
  const annualMaintenance = params.maintenanceAnnual || 0
  const annualHOA = (params.hoaMonthly || 0) * 12
  const operatingExpenses = annualPropertyTax + annualInsurance + annualMaintenance + annualHOA

  // NOI = annual rent - operating expenses (no mortgage)
  const noi = annualGrossRent - operatingExpenses

  // Monthly mortgage P&I
  const loanAmount = homePrice - downPayment
  const monthlyRate = mortgageRate / 12
  const numPayments = 360
  const monthlyPI = loanAmount > 0
    ? loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / (Math.pow(1 + monthlyRate, numPayments) - 1)
    : 0
  const annualDebtService = monthlyPI * 12

  // Annual cash flow = NOI - annual mortgage P&I
  const annualCashFlow = noi - annualDebtService

  // Monthly cash flow
  const monthlyCashFlow = annualCashFlow / 12

  // Cash-on-Cash Return = annual cash flow / cash invested
  const cashOnCashReturn = cashInvested > 0 ? annualCashFlow / cashInvested : 0

  // Cap Rate = NOI / property value
  const capRate = homePrice > 0 ? noi / homePrice : 0

  // 1% Rule: monthly rent >= 1% of purchase price
  const passesOnePercentRule = monthlyGrossRent >= homePrice * 0.01

  return { cashOnCashReturn, capRate, monthlyCashFlow, passesOnePercentRule }
}

function simulateSingleRun(params: SimulationParams, runId: number): SimulationRun {
  const {
    homePrice, downPaymentPercent, mortgageRate, propertyTaxRate,
    insuranceAnnual, houseHack, rentalIncome,
    rentalIncomeGrowth, w2Income, federalBracket, stateRate,
    currentRent, rentGrowth, appreciationMean, appreciationStdDev,
    stockReturnMean, stockReturnStdDev, years, scenarios, heloc,
  } = params
  
  // Stochastic rent growth parameters
  const useStochasticRent = params.rentStochasticGrowth ?? false
  const rentGrowthMean = params.rentGrowthMean ?? rentGrowth  // Default to fixed rate if not set
  const rentGrowthStdDev = params.rentGrowthStdDev ?? 0.02  // Default 2% std dev
  const rentHomeCorrelation = params.rentHomeCorrelation ?? 0.65  // Default ~0.65 correlation
  const rentFloor = params.rentFloor ?? 0.97  // Default: rent doesn't drop more than 3% in a year (sticky downward)
  
  // Multi-family vs single-family mode
  const units = params.units || []
  const isMultiFamily = units.length > 0
  
  // Calculate rental income and owner/rental portions from units
  let effectiveRentalIncome: number
  let ownerPortionCalc: number
  let rentalPortionCalc: number
  
  if (isMultiFamily) {
    // Multi-family: sum rent from non-owner-occupied units
    const ownerUnits = units.filter(u => u.ownerOccupied)
    const rentalUnits = units.filter(u => !u.ownerOccupied)
    effectiveRentalIncome = rentalUnits.reduce((sum, u) => sum + u.monthlyRent, 0)
    
    // Calculate portion by sqft if available, otherwise by unit count
    const hasSqft = units.every(u => u.sqft && u.sqft > 0)
    if (hasSqft) {
      const totalSqft = units.reduce((sum, u) => sum + (u.sqft || 0), 0)
      const ownerSqft = ownerUnits.reduce((sum, u) => sum + (u.sqft || 0), 0)
      ownerPortionCalc = ownerSqft / totalSqft
    } else {
      // Fall back to unit count
      ownerPortionCalc = ownerUnits.length / units.length
    }
    rentalPortionCalc = 1 - ownerPortionCalc
  } else {
    // Legacy single-family mode
    effectiveRentalIncome = houseHack ? rentalIncome : 0
    ownerPortionCalc = houseHack ? 0.50 : 1.0
    rentalPortionCalc = houseHack ? 0.50 : 0
  }
  
  // First-time homebuyer adjustments
  const fthb = params.firstTimeHomeBuyer || { enabled: false, noPMI: false, downPaymentAssistance: 0, lowerRate: false, rateDiscount: 0, taxCredit: 0 }
  const effectiveDownPaymentAssistance = fthb.enabled ? (fthb.downPaymentAssistance || 0) : 0
  const effectiveMortgageRate = fthb.enabled && fthb.lowerRate ? mortgageRate - (fthb.rateDiscount || 0) : mortgageRate
  
  // Initial state
  const downPayment = homePrice * (downPaymentPercent / 100)
  const closingCosts = homePrice * (params.closingCostPercent / 100)
  const totalUpfrontCost = downPayment + closingCosts - effectiveDownPaymentAssistance  // DPA reduces capital needed
  let loanAmount = homePrice - downPayment
  let homeValue = homePrice
  let stockPortfolio = Math.max(0, totalUpfrontCost)  // Rent scenario invests the capital (can't be negative)
  let buyerStockPortfolio = 0  // Buyer's savings when housing cost < market rent (Samar fix)
  let currentRentAmount = currentRent
  let currentRentalIncome = effectiveRentalIncome
  
  // HELOC state
  let helocBalance = 0
  let stocksFromHeloc = 0  // Stocks purchased with HELOC proceeds
  
  let cumulativeCostBuy = totalUpfrontCost  // Includes closing costs
  let cumulativeCostRent = 0
  let cumulativeTaxSavings = 0
  let cumulativeDepreciation = 0  // Track for depreciation recapture on sale
  
  // Monthly P&I calculation (using effective rate with FTHB discount)
  const monthlyRate = effectiveMortgageRate / 12
  const numPayments = 360
  const monthlyPI = loanAmount > 0 
    ? loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / (Math.pow(1 + monthlyRate, numPayments) - 1)
    : 0
  const annualPI = monthlyPI * 12
  
  // Track events
  const allEvents: string[] = []
  const yearResults: YearResult[] = []
  
  // Maintenance shock model initialization
  const shockEnabled = params.maintenanceShock?.enabled ?? false
  const shockComponents = shockEnabled ? (params.maintenanceShock?.components ?? defaultMaintenanceComponents) : []
  // Track current age of each component (ageAtPurchase = age when bought, increases by 1 each year)
  const componentAges: number[] = shockComponents.map(c => c.ageAtPurchase)
  const allMajorRepairs: MajorRepair[] = []
  
  // Scenario state
  let sold = false
  let currentMortgageRate = mortgageRate
  let jobLossActive = false
  let jobLossEnd = 0
  
  for (let year = 1; year <= years; year++) {
    if (sold) {
      // After selling, just track stock portfolio growth
      const stockReturn = randomNormal(stockReturnMean, stockReturnStdDev)
      stockPortfolio *= (1 + stockReturn)
      
      yearResults.push({
        year,
        homeValue: 0,
        loanBalance: 0,
        helocBalance: 0,
        equity: 0,
        stocksFromHeloc: 0,
        buyerStockPortfolio: 0,
        yearCostBuy: 0,
        cumulativeCostBuy,
        wealthBuy: stockPortfolio,  // After sale, wealth is in stocks
        yearRent: currentRentAmount * 12,
        cumulativeCostRent: cumulativeCostRent + currentRentAmount * 12,
        stockPortfolio,
        wealthRent: stockPortfolio,
        delta: 0,
        events: ['Sold'],
        maintenanceDetail: undefined,  // No maintenance detail after selling
      })
      // Stochastic rent growth in sold path too
      const soldRentGrowthRate = useStochasticRent
        ? Math.max(rentFloor - 1, rentGrowthMean + rentGrowthStdDev * 0) // Approximate: use mean in sold path
        : rentGrowth
      currentRentAmount *= (1 + (useStochasticRent ? rentGrowthMean : rentGrowth))
      cumulativeCostRent += currentRentAmount * 12
      continue
    }
    
    const events: string[] = []
    let yearMaintenanceDetail: YearMaintenanceDetail | undefined = undefined
    let yearMajorRepairs: MajorRepair[] = []
    
    // Check for job loss scenario
    if (scenarios.jobLoss && !jobLossActive) {
      const { probability, yearRange, durationMonths } = scenarios.jobLoss
      if (year >= yearRange[0] && year <= yearRange[1] && Math.random() < probability) {
        jobLossActive = true
        jobLossEnd = year + Math.ceil(durationMonths / 12)
        events.push(`Job loss (${durationMonths}mo)`)
        allEvents.push(`Year ${year}: Job loss`)
      }
    }
    if (jobLossActive && year >= jobLossEnd) {
      jobLossActive = false
      events.push('Job recovered')
    }
    
    // Check for refinance scenario
    if (scenarios.refinance) {
      const { probability, yearRange, newRate } = scenarios.refinance
      if (year >= yearRange[0] && year <= yearRange[1] && Math.random() < probability && newRate < currentMortgageRate) {
        // Refinance closing costs (~1.5% of remaining loan balance)
        const refiClosingCosts = loanAmount * 0.015
        cumulativeCostBuy += refiClosingCosts
        
        currentMortgageRate = newRate
        events.push(`Refinanced to ${(newRate * 100).toFixed(2)}% (cost: $${Math.round(refiClosingCosts).toLocaleString()})`)
        allEvents.push(`Year ${year}: Refinanced`)
      }
    }
    
    // Check for early sale scenario
    if (scenarios.earlySale) {
      const { probability, yearRange, sellingCostPercent } = scenarios.earlySale
      if (year >= yearRange[0] && year <= yearRange[1] && Math.random() < probability) {
        // Calculate taxes on early sale
        const earlySaleSellingCosts = homeValue * (sellingCostPercent / 100)
        const earlySaleGain = homeValue - homePrice
        const earlySaleCapGainsExemption = params.filingStatus === 'married' ? 500000 : 250000
        const earlySaleTaxableGain = Math.max(0, earlySaleGain - earlySaleCapGainsExemption)
        const earlySaleCapGainsTax = earlySaleTaxableGain * (params.capitalGainsTaxRate || 0.15)
        const earlySaleDepRecapture = cumulativeDepreciation * 0.25
        
        const saleProceeds = homeValue - loanAmount - earlySaleSellingCosts - earlySaleCapGainsTax - earlySaleDepRecapture
        sold = true
        events.push(`Sold (proceeds: $${Math.round(saleProceeds).toLocaleString()})`)
        allEvents.push(`Year ${year}: Sold house`)
        
        // When selling, pay off HELOC from proceeds
        const netSaleProceeds = saleProceeds - helocBalance + stocksFromHeloc
        yearResults.push({
          year,
          homeValue,
          loanBalance: loanAmount,
          helocBalance: 0,
          equity: netSaleProceeds,
          stocksFromHeloc: 0,
          buyerStockPortfolio,
          yearCostBuy: 0,
          cumulativeCostBuy,
          wealthBuy: netSaleProceeds + buyerStockPortfolio,
          yearRent: currentRentAmount * 12,
          cumulativeCostRent: cumulativeCostRent + currentRentAmount * 12,
          stockPortfolio,
          wealthRent: stockPortfolio,
          delta: netSaleProceeds + buyerStockPortfolio - stockPortfolio,
          events,
          maintenanceDetail: yearMaintenanceDetail,
        })
        continue
      }
    }
    
    // Sample correlated returns for this year
    const [appreciation, stockReturn] = correlatedNormals(
      appreciationMean, appreciationStdDev,
      stockReturnMean, stockReturnStdDev,
      params.marketCorrelation || 0.3  // Default 0.3 correlation
    )
    
    // House appreciates
    homeValue *= (1 + appreciation)
    
    // Annual costs (with growth)
    // Property tax: based on original purchase price, growing at assessment rate
    // (assessed values typically lag market values)
    const taxGrowthFactor = Math.pow(1 + (params.propertyTaxGrowth || 0.02), year - 1)
    const insuranceGrowthFactor = Math.pow(1 + (params.insuranceGrowth || 0.05), year - 1)
    
    // Year 1 proration based on closing month (1=Jan, 12=Dec)
    // If closing in August (month 8), Year 1 has 5 months (Aug-Dec)
    const closingMonth = params.closingMonth || 1  // Default January
    const year1Months = year === 1 ? (13 - closingMonth) : 12
    const year1Proration = year1Months / 12
    
    const annualPropertyTax = homePrice * propertyTaxRate * taxGrowthFactor * (year === 1 ? year1Proration : 1)
    const annualInsurance = insuranceAnnual * insuranceGrowthFactor * (year === 1 ? year1Proration : 1)
    // Maintenance: use shock model if enabled, otherwise smooth annual amount
    // Shock model: base maintenance = 30% of smooth, components roll for failures
    const smoothMaintenance = (params.maintenanceAnnual || 0) * Math.pow(1.03, year - 1) * (year === 1 ? year1Proration : 1)
    let annualMaintenance: number
    
    if (shockEnabled) {
      // Base routine maintenance = 30% of smooth amount
      const maintenanceBase = smoothMaintenance * 0.3
      let maintenanceShocks = 0
      
      // Roll for each component
      for (let ci = 0; ci < shockComponents.length; ci++) {
        const comp = shockComponents[ci]
        const age = componentAges[ci]
        const failureProb = comp.failureProbability(age)
        
        if (Math.random() < failureProb) {
          // Component failed!
          maintenanceShocks += comp.replacementCost
          yearMajorRepairs.push({
            year,
            component: comp.name,
            cost: comp.replacementCost,
          })
          allMajorRepairs.push({
            year,
            component: comp.name,
            cost: comp.replacementCost,
          })
          events.push(`${comp.name} replacement ($${(comp.replacementCost / 1000).toFixed(0)}k)`)
          allEvents.push(`Year ${year}: ${comp.name} replacement ($${(comp.replacementCost / 1000).toFixed(0)}k)`)
          
          // Reset component age to 0 (new replacement)
          componentAges[ci] = 0
        } else {
          // Component survived, age it by 1 year
          componentAges[ci]++
        }
      }
      
      const maintenanceTotal = maintenanceBase + maintenanceShocks
      annualMaintenance = maintenanceTotal
      
      yearMaintenanceDetail = {
        maintenanceBase: Math.round(maintenanceBase),
        maintenanceShocks: Math.round(maintenanceShocks),
        maintenanceTotal: Math.round(maintenanceTotal),
        majorRepairs: yearMajorRepairs,
      }
    } else {
      annualMaintenance = smoothMaintenance
    }
    const annualPMI = (fthb.enabled && fthb.noPMI) ? 0 : ((loanAmount / homeValue) > 0.8 ? loanAmount * 0.005 : 0) * (year === 1 ? year1Proration : 1)
    const annualHOA = (params.hoaMonthly || 0) * 12 * Math.pow(1.03, year - 1) * (year === 1 ? year1Proration : 1)
    
    // Recalculate P&I if refinanced
    let currentAnnualPI = annualPI
    if (currentMortgageRate !== mortgageRate) {
      const newMonthlyRate = currentMortgageRate / 12
      const remainingPayments = 360 - (year - 1) * 12
      if (remainingPayments > 0 && loanAmount > 0) {
        const newMonthlyPI = loanAmount * (newMonthlyRate * Math.pow(1 + newMonthlyRate, remainingPayments)) / 
                             (Math.pow(1 + newMonthlyRate, remainingPayments) - 1)
        currentAnnualPI = newMonthlyPI * 12
      }
    }
    
    const totalAnnualCost = currentAnnualPI + annualPropertyTax + annualInsurance + annualMaintenance + annualPMI + annualHOA
    
    // Interest and principal - calculate from actual loan balance (month by month)
    // This is more accurate than the previous approximation which diverged after year 5
    // Year 1 is prorated based on closing month
    let yearInterest = 0
    let yearPrincipal = 0
    let tempBalance = loanAmount
    const effectiveMonthlyRate = currentMortgageRate / 12
    const currentMonthlyPI = monthlyPI  // Use the payment calculated at loan origination
    
    const monthsThisYear = year === 1 ? year1Months : 12
    for (let month = 0; month < monthsThisYear; month++) {
      const monthInterest = tempBalance * effectiveMonthlyRate
      const monthPrincipal = Math.min(currentMonthlyPI - monthInterest, tempBalance)
      yearInterest += monthInterest
      yearPrincipal += monthPrincipal
      tempBalance = Math.max(0, tempBalance - monthPrincipal)
    }
    loanAmount = tempBalance  // Update loan balance after this year's payments
    
    // Tax savings (updated for OBBBA 2025)
    // $750k mortgage interest deduction cap (OBBBA made permanent)
    const maxDeductibleDebt = 750000
    const effectiveLoanForDeduction = Math.min(loanAmount + yearPrincipal, maxDeductibleDebt)
    const cappedInterestDeduction = yearInterest * (effectiveLoanForDeduction / Math.max(1, loanAmount + yearPrincipal))
    
    // PMI now deductible as mortgage interest (OBBBA 2026+)
    const mortgageInterestDeduction = cappedInterestDeduction + annualPMI
    
    // SALT cap increased to $40k (OBBBA) for incomes < $500k, phased out above
    const stateIncomeTax = w2Income * stateRate
    const saltTotal = annualPropertyTax + stateIncomeTax
    let saltCap = 40000
    if (w2Income > 500000) {
      // Phase out: reduced by 30% of excess over $500k until hits $10k floor
      const excess = w2Income - 500000
      saltCap = Math.max(10000, 40000 - excess * 0.30)
    }
    const saltDeduction = Math.min(saltTotal, saltCap)
    
    // HELOC interest NOT deductible for non-home purposes (OBBBA confirmed)
    // helocInterestCost is a cost, not a deduction
    
    // Rental income (calculate early for tax purposes)
    // Year 1 prorated based on closing month
    const vacancyAdjustment = 1 - (params.vacancyRate || 0)
    const hasRentalIncome = isMultiFamily || houseHack
    const yearRentalIncome = hasRentalIncome ? currentRentalIncome * monthsThisYear * vacancyAdjustment : 0
    
    // Rental depreciation (if renting out any portion)
    let rentalDepreciation = 0
    let rentalExpenseDeduction = 0
    let qbiDeduction = 0
    const taxStrategies = params.taxStrategies || { costSegregation: { enabled: false, shortLifePercent: 0.20, year1BonusDepreciation: 1.0 }, qbi: { enabled: false, qualifiesAsBusiness: false }, exchange1031: { enabled: false } }
    
    if (hasRentalIncome && yearRentalIncome > 0) {
      // Depreciation: rental portion of building value over 27.5 years
      const buildingValuePct = params.buildingValuePercent || 0.80  // Default 80% building, 20% land
      const buildingValue = homePrice * buildingValuePct
      const rentalBuildingValue = buildingValue * rentalPortionCalc
      
      // Cost Segregation: accelerate depreciation on short-life assets
      let yearDepreciation = 0
      if (taxStrategies.costSegregation?.enabled && year === 1) {
        // Year 1: Take bonus depreciation on short-life assets (5/7/15 year property)
        const shortLifePercent = taxStrategies.costSegregation.shortLifePercent || 0.20
        const bonusRate = taxStrategies.costSegregation.year1BonusDepreciation || 1.0  // 100% in 2026
        const shortLifeValue = rentalBuildingValue * shortLifePercent
        const longLifeValue = rentalBuildingValue * (1 - shortLifePercent)
        
        // Bonus depreciation on short-life assets (100% in Year 1)
        const bonusDepreciation = shortLifeValue * bonusRate
        // Regular 27.5 year depreciation on remaining building
        const regularDepreciation = longLifeValue / 27.5
        
        yearDepreciation = bonusDepreciation + regularDepreciation
      } else if (taxStrategies.costSegregation?.enabled && year > 1) {
        // After Year 1: only depreciate the long-life portion
        const shortLifePercent = taxStrategies.costSegregation.shortLifePercent || 0.20
        const longLifeValue = rentalBuildingValue * (1 - shortLifePercent)
        yearDepreciation = longLifeValue / 27.5
      } else {
        // Standard 27.5 year straight-line depreciation
        // IRS mid-month convention: Year 1 depreciation is prorated
        // Closing in month M = (12.5 - M) / 12 of annual depreciation
        const fullYearDepreciation = rentalBuildingValue / 27.5
        if (year === 1) {
          const midMonthFactor = (12.5 - closingMonth) / 12
          yearDepreciation = fullYearDepreciation * midMonthFactor
        } else {
          yearDepreciation = fullYearDepreciation
        }
      }
      rentalDepreciation = yearDepreciation
      
      // Rental expenses (rental portion of deductible costs)
      const rentalShareInterest = cappedInterestDeduction * rentalPortionCalc
      const rentalShareTax = annualPropertyTax * rentalPortionCalc
      const rentalShareInsurance = annualInsurance * rentalPortionCalc
      const rentalShareHOA = annualHOA * rentalPortionCalc
      const rentalShareMaintenance = annualMaintenance * rentalPortionCalc
      
      // Schedule E: Rental income - expenses - depreciation
      const scheduleEIncome = yearRentalIncome
      const scheduleEExpenses = rentalShareInterest + rentalShareTax + rentalShareInsurance + rentalShareHOA + rentalShareMaintenance + rentalDepreciation
      
      // Net rental income (for QBI calculation)
      const netRentalIncome = Math.max(0, scheduleEIncome - scheduleEExpenses)
      
      // QBI Deduction (Section 199A): 20% of qualified business income
      if (taxStrategies.qbi?.enabled && taxStrategies.qbi?.qualifiesAsBusiness && netRentalIncome > 0) {
        // QBI = 20% of net rental income
        // Subject to W-2 wage limit and taxable income limit, but simplified here
        qbiDeduction = netRentalIncome * 0.20
      }
      
      // Passive loss rules: 
      // - Can deduct up to $25k of passive losses against W2 if AGI < $100k
      // - Phases out $100-150k AGI (lose $1 for every $2 over $100k)
      // - Above $150k AGI, no passive loss deduction (losses carry forward, but we ignore that)
      const passiveLoss = Math.max(0, scheduleEExpenses - scheduleEIncome)
      let passiveLossAllowance = 0
      if (passiveLoss > 0 && w2Income < 150000) {
        const maxAllowance = 25000
        if (w2Income <= 100000) {
          passiveLossAllowance = Math.min(passiveLoss, maxAllowance)
        } else {
          // Phase out: lose $1 for every $2 over $100k
          const phaseOutReduction = (w2Income - 100000) / 2
          passiveLossAllowance = Math.min(passiveLoss, Math.max(0, maxAllowance - phaseOutReduction))
        }
      }
      
      // Rental tax benefit is ONLY the passive loss allowance that offsets W2 income
      // (The rental income itself is already subtracted from gross costs separately)
      rentalExpenseDeduction = passiveLossAllowance
      
      // Reduce owner-occupied deductions by rental portion
      // (Interest/tax already split - owner gets remaining portion)
      
      // Track cumulative depreciation for recapture on sale
      cumulativeDepreciation += rentalDepreciation
    }
    
    // Total itemized (owner-occupied portion only)
    // Use calculated owner portion (from units or legacy)
    // $750k limit applies to owner-occupied portion of loan only
    const ownerLoanPortion = (loanAmount + yearPrincipal) * ownerPortionCalc
    const ownerInterest = yearInterest * ownerPortionCalc
    const ownerInterestDeduction = ownerLoanPortion <= 750000 
      ? ownerInterest 
      : ownerInterest * (750000 / ownerLoanPortion)
    const ownerSaltDeduction = saltDeduction * ownerPortionCalc
    const totalItemized = ownerInterestDeduction + ownerSaltDeduction
    const standardDeduction = params.filingStatus === 'married' ? 32200 : 16100  // 2026 IRS values
    const itemizedBenefit = Math.max(0, totalItemized - standardDeduction)
    
    // Total tax savings: itemized benefit + rental deduction benefit + QBI
    const fthbTaxCredit = (fthb.enabled && fthb.taxCredit) ? fthb.taxCredit : 0
    const ownerOccupiedSavings = itemizedBenefit * (federalBracket + stateRate * 0.5)
    const rentalTaxSavings = rentalExpenseDeduction * federalBracket  // Rental losses offset at marginal rate
    // QBI is a deduction, so tax savings = qbiDeduction * marginal rate
    const qbiTaxSavings = qbiDeduction * federalBracket
    const yearTaxSavings = jobLossActive ? 0 : ownerOccupiedSavings + rentalTaxSavings + qbiTaxSavings + fthbTaxCredit
    cumulativeTaxSavings += yearTaxSavings
    
    // Update rental income for next year (already calculated yearRentalIncome above)
    currentRentalIncome *= (1 + rentalIncomeGrowth)
    
    // Net cost of buying (add HELOC interest if applicable)
    const helocInterestCost = helocBalance * (heloc?.rate || 0)
    const yearCostBuy = totalAnnualCost - yearRentalIncome - yearTaxSavings + helocInterestCost
    cumulativeCostBuy += yearCostBuy
    
    // Equity (before HELOC)
    const grossEquity = homeValue - loanAmount
    
    // --- HELOC STRATEGY ---
    // Check if we can/should take out a HELOC
    if (heloc?.enabled && year >= 2) {
      const equityPercent = grossEquity / homeValue
      const currentLTV = loanAmount / homeValue
      const maxHelocAmount = homeValue * heloc.maxLTV - loanAmount - helocBalance
      
      // Take HELOC if: enough equity AND room under max LTV
      if (equityPercent >= heloc.minEquityPercent && maxHelocAmount > 10000) {
        // Take out 80% of available HELOC room (conservative)
        const helocDraw = maxHelocAmount * 0.8
        helocBalance += helocDraw
        
        if (heloc.deployToStocks) {
          // Invest HELOC proceeds in stocks
          stocksFromHeloc += helocDraw
          events.push(`HELOC draw: $${Math.round(helocDraw).toLocaleString()} → stocks`)
          allEvents.push(`Year ${year}: HELOC $${Math.round(helocDraw/1000)}k`)
        }
      }
    }
    
    // Stocks from HELOC grow with market
    stocksFromHeloc *= (1 + stockReturn)
    
    // Net equity = home value - mortgage - HELOC
    const equity = grossEquity - helocBalance
    
    // Wealth from buying = net equity + stocks from HELOC
    // Wealth from buying = net equity + stocks from HELOC + stocks from rent savings (Samar fix)
    const wealthBuy = equity + stocksFromHeloc + buyerStockPortfolio
    
    // --- RENT SCENARIO ---
    // Stochastic rent growth, correlated with home appreciation
    let yearRentGrowth: number
    if (useStochasticRent) {
      // Correlate rent growth with home appreciation using Cholesky decomposition
      // appreciation is already sampled; derive rent growth from it
      // rentGrowth = rentGrowthMean + rentGrowthStdDev * (rentHomeCorrelation * z_appreciation + sqrt(1 - rentHomeCorrelation^2) * z_independent)
      // where z_appreciation = (appreciation - appreciationMean) / appreciationStdDev
      const zAppreciation = appreciationStdDev > 0
        ? (appreciation - appreciationMean) / appreciationStdDev
        : 0
      const zIndependent = randomNormal(0, 1)  // Independent shock for rent
      const zRent = rentHomeCorrelation * zAppreciation + Math.sqrt(Math.max(0, 1 - rentHomeCorrelation * rentHomeCorrelation)) * zIndependent
      yearRentGrowth = rentGrowthMean + rentGrowthStdDev * zRent
      // Sticky-downward: rent doesn't drop below floor (e.g., max 3% annual drop)
      yearRentGrowth = Math.max(yearRentGrowth, rentFloor - 1)  // rentFloor is like 0.97, so floor is -3%
    } else {
      yearRentGrowth = rentGrowth  // Fixed percentage
    }
    const yearRent = currentRentAmount * 12
    currentRentAmount *= (1 + yearRentGrowth)
    cumulativeCostRent += yearRent
    
    // Stock portfolios grow, plus we invest the difference
    // KEY: As rent grows, renter has LESS to invest each year
    // Samar fix: Buyer also invests savings when housing cost < market rent
    const monthlySavingsDiff = (yearCostBuy - yearRent) / 12
    
    // Monthly compounding for contributions: FV of annuity = PMT * [((1+r)^n - 1) / r]
    // where r = monthly return, n = 12 months
    const monthlyReturn = Math.pow(1 + stockReturn, 1/12) - 1
    const annuityFactor = monthlyReturn > 0.0001 
      ? ((Math.pow(1 + monthlyReturn, 12) - 1) / monthlyReturn)
      : 12  // If return ~0, just sum the contributions
    
    if (monthlySavingsDiff > 0) {
      // Buying costs more, so renter invests the difference throughout the year
      // Existing portfolio grows for full year, contributions compound monthly
      stockPortfolio = stockPortfolio * (1 + stockReturn) + monthlySavingsDiff * annuityFactor
      // Buyer has no savings to invest
      buyerStockPortfolio = buyerStockPortfolio * (1 + stockReturn)
    } else {
      // Buying costs less (house hack effective)
      // Renter just pays rent, portfolio grows but no new investment
      stockPortfolio = stockPortfolio * (1 + stockReturn)
      // Buyer invests the savings (negative diff = positive savings for buyer)
      const buyerMonthlySavings = -monthlySavingsDiff
      buyerStockPortfolio = buyerStockPortfolio * (1 + stockReturn) + buyerMonthlySavings * annuityFactor
    }
    
    // Note: Rent growth is modeled stochastically (correlated with home appreciation)
    // or as a fixed percentage, depending on rentStochasticGrowth setting.
    // This means yearRent varies per path, affecting renter's ability to save.
    
    const wealthRent = stockPortfolio
    const delta = wealthBuy - wealthRent
    
    yearResults.push({
      year,
      homeValue: Math.round(homeValue),
      loanBalance: Math.round(loanAmount),
      helocBalance: Math.round(helocBalance),
      equity: Math.round(equity),
      stocksFromHeloc: Math.round(stocksFromHeloc),
      buyerStockPortfolio: Math.round(buyerStockPortfolio),
      yearCostBuy: Math.round(yearCostBuy),
      cumulativeCostBuy: Math.round(cumulativeCostBuy),
      wealthBuy: Math.round(wealthBuy),
      yearRent: Math.round(yearRent),
      cumulativeCostRent: Math.round(cumulativeCostRent),
      stockPortfolio: Math.round(stockPortfolio),
      wealthRent: Math.round(wealthRent),
      delta: Math.round(delta),
      events,
      maintenanceDetail: yearMaintenanceDetail,
    })
  }
  
  const lastYear = yearResults[yearResults.length - 1]
  
  // Calculate exit costs and capital gains tax
  const finalHomeValue = lastYear?.homeValue || 0
  const finalLoanBalance = lastYear?.loanBalance || 0
  const finalHelocBalance = lastYear?.helocBalance || 0
  const finalStocksFromHeloc = lastYear?.stocksFromHeloc || 0
  
  // Exit strategy determines how we calculate final wealth
  const exitStrategy = params.exitStrategy || 'sell'
  const taxStrategies = params.taxStrategies || { costSegregation: { enabled: false, shortLifePercent: 0.20, year1BonusDepreciation: 1.0 }, qbi: { enabled: false, qualifiesAsBusiness: false }, exchange1031: { enabled: false } }
  
  let sellingCosts = 0
  let capitalGainsTax = 0
  let depreciationRecapture = 0
  let saleProceeds = 0
  
  if (exitStrategy === 'hold') {
    // Hold Forever: Paper equity only, no selling costs, no taxes
    // This is the "buy, borrow, die" strategy
    sellingCosts = 0
    capitalGainsTax = 0
    depreciationRecapture = 0
    saleProceeds = finalHomeValue - finalLoanBalance - finalHelocBalance
  } else if (exitStrategy === '1031' || taxStrategies.exchange1031?.enabled) {
    // 1031 Exchange: Selling costs apply, but all taxes deferred
    sellingCosts = finalHomeValue * (params.sellingCostPercent / 100)
    capitalGainsTax = 0
    depreciationRecapture = 0
    saleProceeds = finalHomeValue - finalLoanBalance - finalHelocBalance - sellingCosts
  } else if (exitStrategy === 'remote') {
    // Remote Landlord: Sell at end, but property was 100% rental after move-out
    // More depreciation taken = more recapture
    sellingCosts = finalHomeValue * (params.sellingCostPercent / 100)
    const capGainsExemption = 0  // No primary residence exemption if not living there 2 of last 5 years
    const totalGain = finalHomeValue - homePrice
    const taxableGain = Math.max(0, totalGain - capGainsExemption)
    capitalGainsTax = taxableGain * (params.capitalGainsTaxRate || 0.15)
    depreciationRecapture = cumulativeDepreciation * 0.25
    saleProceeds = finalHomeValue - finalLoanBalance - finalHelocBalance - sellingCosts - capitalGainsTax - depreciationRecapture
  } else {
    // Sell (default): Full selling costs and taxes, with primary residence exemption
    sellingCosts = finalHomeValue * (params.sellingCostPercent / 100)
    const capGainsExemption = params.filingStatus === 'married' ? 500000 : 250000
    const totalGain = finalHomeValue - homePrice
    const taxableGain = Math.max(0, totalGain - capGainsExemption)
    capitalGainsTax = taxableGain * (params.capitalGainsTaxRate || 0.15)
    depreciationRecapture = cumulativeDepreciation * 0.25
    saleProceeds = finalHomeValue - finalLoanBalance - finalHelocBalance - sellingCosts - capitalGainsTax - depreciationRecapture
  }
  
  const finalBuyerStockPortfolio = lastYear?.buyerStockPortfolio || 0
  const finalWealthBuyNet = saleProceeds + finalStocksFromHeloc + finalBuyerStockPortfolio
  
  const finalWealthRent = lastYear?.wealthRent || 0
  
  return {
    id: runId,
    years: yearResults,
    finalWealthBuy: Math.round(finalWealthBuyNet),
    finalWealthRent: finalWealthRent,
    finalDelta: Math.round(finalWealthBuyNet - finalWealthRent),
    events: allEvents,
    majorRepairs: allMajorRepairs,
    exitDetails: {
      sellingCosts: Math.round(sellingCosts),
      capitalGainsTax: Math.round(capitalGainsTax),
      depreciationRecapture: Math.round(depreciationRecapture),
      netProceeds: Math.round(saleProceeds),
    }
  }
}

// Default parameters based on Cambridge, MA scenario (2026 market rates)
export const defaultParams: SimulationParams = {
  homePrice: 1198000,             // 3-family Somerville target
  downPaymentPercent: 5,          // FTHB 5% down
  mortgageRate: 0.06,             // Current 30yr fixed (March 2026)
  propertyTaxRate: 0.011,         // Somerville rate
  insuranceAnnual: 5990,          // ~0.5% of value for multi-family
  
  // Additional costs
  closingCostPercent: 3,          // 3% closing costs
  hoaMonthly: 0,                  // Multi-family = no HOA
  maintenanceAnnual: 11980,       // ~1% of value for multi-family
  
  // Multi-family units (empty = single-family mode)
  units: [],
  
  houseHack: true,
  rentalIncome: 6000,             // 2 units @ $3k/mo each
  rentalIncomeGrowth: 0.03,       // Match rent growth
  vacancyRate: 0.05,              // 5% vacancy (~18 days/year turnover)
  
  stateProfile: 'ma',             // Massachusetts default
  w2Income: 108722,               // Ayaan's W2
  federalBracket: 0.24,           // 24% bracket at $108k (corrected)
  stateRate: 0.05,                // MA flat rate
  filingStatus: 'single',         // Single or married (affects std deduction & cap gains)
  buildingValuePercent: 0.80,     // 80% building, 20% land
  closingMonth: 8,                // August closing (default for Ayaan)
  
  currentRent: 1500,              // Ayaan's current rent
  rentGrowth: 0.03,              // Legacy: fixed 3% rent growth (used when rentStochasticGrowth = false)
  rentGrowthMean: 0.03,         // Stochastic: mean annual rent growth (3% historically)
  rentGrowthStdDev: 0.02,       // Stochastic: std dev of annual rent growth (2% = moderate volatility)
  rentHomeCorrelation: 0.65,    // Correlation between rent growth & home appreciation
  rentFloor: 0.97,              // Stochastic: rent doesn't drop more than 3% in a year (sticky downward)
  rentStochasticGrowth: false,   // Disabled by default (toggle in Advanced Settings)
  alternativeInvestmentPreset: 'sp500',
  
  // Historical distributions
  appreciationMean: 0.05,      // Cambridge long-term ~5%
  appreciationStdDev: 0.12,    // Housing is volatile (2008 was -15%, some years +15%)
  stockReturnMean: 0.10,       // S&P 500 historical
  stockReturnStdDev: 0.17,     // S&P 500 volatility
  marketCorrelation: 0.3,      // Housing-stock correlation (~0.3 historically)
  
  // Cost growth
  propertyTaxGrowth: 0.02,     // 2%/yr property tax increases
  insuranceGrowth: 0.05,       // 5%/yr insurance increases (has been brutal lately)
  
  // Exit costs
  sellingCostPercent: 6,       // 5-6% realtor + closing
  capitalGainsTaxRate: 0.15,   // 15% LTCG (above $250k exemption for primary)
  
  // First-time homebuyer benefits (enabled for Ayaan's scenario)
  firstTimeHomeBuyer: {
    enabled: true,
    noPMI: true,                 // ONE Mortgage / MassHousing
    downPaymentAssistance: 0,    // DPA grant amount
    lowerRate: false,
    rateDiscount: 0.005,         // 0.5% rate discount
    taxCredit: 0,                // Annual MCC credit
  },
  
  years: 10,                     // 10 year horizon
  numSimulations: 5000,
  
  // HELOC strategy (disabled by default)
  heloc: {
    enabled: false,
    minEquityPercent: 0.30,  // Need 30% equity before taking HELOC
    maxLTV: 0.80,            // Combined LTV cap
    rate: 0.085,             // HELOC rate ~8.5%
    deployToStocks: true,
  },
  
  scenarios: {},
  
  // Advanced tax strategies (all disabled by default)
  taxStrategies: {
    costSegregation: {
      enabled: false,
      shortLifePercent: 0.20,        // 20% of building is 5/7/15 year property
      year1BonusDepreciation: 1.0,   // 100% bonus depreciation in 2026
    },
    qbi: {
      enabled: false,
      qualifiesAsBusiness: false,    // Need 250+ hours/year to qualify
    },
    exchange1031: {
      enabled: false,                // Defer cap gains by reinvesting
    },
  },
  
  // Exit strategy
  exitStrategy: 'sell',  // 'sell' | 'hold' | '1031' | 'remote'
  
  // Remote landlord settings
  remoteLandlord: {
    propertyManagerPercent: 0.10,  // 10% PM fee
    moveOutYear: 5,                // Move out after year 5
  },
  
  // Maintenance shock model (disabled by default = backward compatible)
  maintenanceShock: {
    enabled: false,
    components: defaultMaintenanceComponents,
  },
}

// ============================================
// WHAT-IF SENSITIVITY ANALYSIS (Quick view)
// ============================================

export interface WhatIfScenario {
  id: string
  label: string
  description: string
  newP50Delta: number
  newWinRate: number
  deltaChange: number  // Change from base P50 delta
  winRateChange: number  // Change from base win rate
  direction: 'better' | 'worse' | 'neutral'
}

export interface WhatIfResult {
  baseP50Delta: number
  baseWinRate: number
  scenarios: WhatIfScenario[]
}

// Quick "what if" scenarios with predefined variations
export function runWhatIfAnalysis(
  baseParams: SimulationParams,
  numSims: number = 1000
): WhatIfResult {
  const testParams = { ...baseParams, numSimulations: numSims }
  
  // Run base case
  const baseResult = runSimulation(testParams)
  const baseP50 = baseResult.finalStats.delta.p50
  const baseWinRate = baseResult.finalStats.buyWinsProbability
  
  // Define what-if scenarios
  const scenarioDefs: Array<{
    id: string
    label: string
    description: string
    changes: Partial<SimulationParams>
  }> = [
    // Rate scenarios
    {
      id: 'rate-down-1',
      label: 'Rate -1%',
      description: `Rate drops to ${((baseParams.mortgageRate - 0.01) * 100).toFixed(1)}%`,
      changes: { mortgageRate: baseParams.mortgageRate - 0.01 },
    },
    {
      id: 'rate-up-1',
      label: 'Rate +1%',
      description: `Rate rises to ${((baseParams.mortgageRate + 0.01) * 100).toFixed(1)}%`,
      changes: { mortgageRate: baseParams.mortgageRate + 0.01 },
    },
    // Down payment scenarios
    {
      id: 'down-plus-5',
      label: 'Down +5%',
      description: `Put ${baseParams.downPaymentPercent + 5}% down`,
      changes: { downPaymentPercent: Math.min(50, baseParams.downPaymentPercent + 5) },
    },
    {
      id: 'down-minus-5',
      label: 'Down -5%',
      description: `Put ${Math.max(3, baseParams.downPaymentPercent - 5)}% down`,
      changes: { downPaymentPercent: Math.max(3, baseParams.downPaymentPercent - 5) },
    },
    // Price scenarios
    {
      id: 'price-down-10',
      label: 'Price -10%',
      description: `Buy at $${Math.round(baseParams.homePrice * 0.9).toLocaleString()}`,
      changes: { homePrice: baseParams.homePrice * 0.9 },
    },
    {
      id: 'price-up-10',
      label: 'Price +10%',
      description: `Buy at $${Math.round(baseParams.homePrice * 1.1).toLocaleString()}`,
      changes: { homePrice: baseParams.homePrice * 1.1 },
    },
    // Appreciation scenarios
    {
      id: 'appr-low',
      label: 'Appr 3%',
      description: 'Slower appreciation (3%/yr)',
      changes: { appreciationMean: 0.03 },
    },
    {
      id: 'appr-high',
      label: 'Appr 7%',
      description: 'Faster appreciation (7%/yr)',
      changes: { appreciationMean: 0.07 },
    },
    // Stock return scenarios
    {
      id: 'stock-low',
      label: 'Stocks 6%',
      description: 'Lower stock returns (6%/yr)',
      changes: { stockReturnMean: 0.06 },
    },
    {
      id: 'stock-high',
      label: 'Stocks 12%',
      description: 'Higher stock returns (12%/yr)',
      changes: { stockReturnMean: 0.12 },
    },
    // Hold period scenarios
    {
      id: 'years-5',
      label: '5 Years',
      description: 'Sell after 5 years',
      changes: { years: 5 },
    },
    {
      id: 'years-15',
      label: '15 Years',
      description: 'Hold for 15 years',
      changes: { years: 15 },
    },
  ]
  
  // Add rental income scenarios only if house hacking
  if (baseParams.houseHack || baseParams.units.length > 0) {
    const currentRentalIncome = baseParams.units.length > 0
      ? baseParams.units.filter(u => !u.ownerOccupied).reduce((sum, u) => sum + u.monthlyRent, 0)
      : baseParams.rentalIncome
    
    if (currentRentalIncome > 0) {
      scenarioDefs.push({
        id: 'rental-down-20',
        label: 'Rent -20%',
        description: `Rental income $${Math.round(currentRentalIncome * 0.8).toLocaleString()}/mo`,
        changes: baseParams.units.length > 0
          ? { units: baseParams.units.map(u => u.ownerOccupied ? u : { ...u, monthlyRent: u.monthlyRent * 0.8 }) }
          : { rentalIncome: baseParams.rentalIncome * 0.8 },
      })
      scenarioDefs.push({
        id: 'rental-up-20',
        label: 'Rent +20%',
        description: `Rental income $${Math.round(currentRentalIncome * 1.2).toLocaleString()}/mo`,
        changes: baseParams.units.length > 0
          ? { units: baseParams.units.map(u => u.ownerOccupied ? u : { ...u, monthlyRent: u.monthlyRent * 1.2 }) }
          : { rentalIncome: baseParams.rentalIncome * 1.2 },
      })
    }
  }
  
  // Run each scenario
  const scenarios: WhatIfScenario[] = []
  
  for (const def of scenarioDefs) {
    const scenarioParams = { ...testParams, ...def.changes }
    const result = runSimulation(scenarioParams)
    const newP50 = result.finalStats.delta.p50
    const newWinRate = result.finalStats.buyWinsProbability
    const deltaChange = newP50 - baseP50
    const winRateChange = newWinRate - baseWinRate
    
    scenarios.push({
      id: def.id,
      label: def.label,
      description: def.description,
      newP50Delta: newP50,
      newWinRate,
      deltaChange,
      winRateChange,
      direction: deltaChange > 5000 ? 'better' : deltaChange < -5000 ? 'worse' : 'neutral',
    })
  }
  
  // Sort by absolute impact (biggest changes first)
  scenarios.sort((a, b) => Math.abs(b.deltaChange) - Math.abs(a.deltaChange))
  
  return {
    baseP50Delta: baseP50,
    baseWinRate,
    scenarios,
  }
}

// ============================================
// SENSITIVITY ANALYSIS
// ============================================

export interface SensitivityResult {
  parameter: string
  label: string
  baseValue: number
  lowValue: number
  highValue: number
  lowWinRate: number
  baseWinRate: number
  highWinRate: number
  lowP50Delta: number
  baseP50Delta: number
  highP50Delta: number
  impact: number  // Spread between low and high outcomes (for ranking)
}

// Parameters to test in sensitivity analysis
const SENSITIVITY_PARAMS: Array<{
  key: keyof SimulationParams
  label: string
  lowMult?: number
  highMult?: number
  lowAdd?: number
  highAdd?: number
}> = [
  { key: 'homePrice', label: 'Home Price', lowMult: 0.9, highMult: 1.1 },
  { key: 'downPaymentPercent', label: 'Down Payment %', lowAdd: -5, highAdd: 10 },
  { key: 'mortgageRate', label: 'Mortgage Rate', lowAdd: -0.01, highAdd: 0.01 },
  { key: 'appreciationMean', label: 'Appreciation (μ)', lowAdd: -0.02, highAdd: 0.02 },
  { key: 'stockReturnMean', label: 'Stock Return (μ)', lowAdd: -0.02, highAdd: 0.02 },
  { key: 'rentalIncome', label: 'Rental Income', lowMult: 0.8, highMult: 1.2 },
  { key: 'currentRent', label: 'Current Rent', lowMult: 0.85, highMult: 1.15 },
  { key: 'hoaMonthly', label: 'HOA/Month', lowMult: 0.5, highMult: 1.5 },
]

export function runSensitivityAnalysis(
  baseParams: SimulationParams,
  quickMode: boolean = true  // Fewer simulations for speed
): SensitivityResult[] {
  const numSims = quickMode ? 1000 : baseParams.numSimulations
  const testParams = { ...baseParams, numSimulations: numSims }
  
  // Run base case
  const baseResult = runSimulation(testParams)
  const baseWinRate = baseResult.finalStats.buyWinsProbability
  const baseP50 = baseResult.finalStats.delta.p50
  
  const results: SensitivityResult[] = []
  
  for (const param of SENSITIVITY_PARAMS) {
    const baseValue = testParams[param.key] as number
    if (typeof baseValue !== 'number') continue
    
    // Skip rental income if not house hacking
    if (param.key === 'rentalIncome' && !testParams.houseHack && testParams.units.length === 0) continue
    
    // Calculate low and high values
    let lowValue: number, highValue: number
    if (param.lowMult !== undefined) {
      lowValue = baseValue * param.lowMult
      highValue = baseValue * (param.highMult || 1)
    } else {
      lowValue = baseValue + (param.lowAdd || 0)
      highValue = baseValue + (param.highAdd || 0)
    }
    
    // Clamp values
    if (param.key === 'downPaymentPercent') {
      lowValue = Math.max(3, lowValue)
      highValue = Math.min(50, highValue)
    }
    
    // Run low scenario
    const lowParams = { ...testParams, [param.key]: lowValue }
    const lowResult = runSimulation(lowParams)
    
    // Run high scenario
    const highParams = { ...testParams, [param.key]: highValue }
    const highResult = runSimulation(highParams)
    
    results.push({
      parameter: param.key,
      label: param.label,
      baseValue,
      lowValue,
      highValue,
      lowWinRate: lowResult.finalStats.buyWinsProbability,
      baseWinRate,
      highWinRate: highResult.finalStats.buyWinsProbability,
      lowP50Delta: lowResult.finalStats.delta.p50,
      baseP50Delta: baseP50,
      highP50Delta: highResult.finalStats.delta.p50,
      impact: Math.abs(highResult.finalStats.delta.p50 - lowResult.finalStats.delta.p50),
    })
  }
  
  // Sort by impact (biggest swings first)
  return results.sort((a, b) => b.impact - a.impact)
}

// ============================================
// BREAK-EVEN SURFACE (2D HEATMAP)
// ============================================

export interface HeatmapCell {
  x: number  // First variable value
  y: number  // Second variable value
  winRate: number
  p50Delta: number
}

export interface BreakEvenSurface {
  xLabel: string
  yLabel: string
  xValues: number[]
  yValues: number[]
  cells: HeatmapCell[][]  // [xIndex][yIndex]
  breakEvenLine?: Array<{ x: number; y: number }>  // Points where winRate ≈ 50%
}

export function runBreakEvenSurface(
  baseParams: SimulationParams,
  xParam: 'homePrice' | 'downPaymentPercent' | 'mortgageRate' = 'homePrice',
  yParam: 'downPaymentPercent' | 'mortgageRate' | 'rentalIncome' = 'downPaymentPercent',
  resolution: number = 7  // Grid points per axis
): BreakEvenSurface {
  const numSims = 500  // Fast mode for grid
  const testParams = { ...baseParams, numSimulations: numSims }
  
  // Define ranges
  const ranges: Record<string, { min: number; max: number; label: string }> = {
    homePrice: { 
      min: baseParams.homePrice * 0.8, 
      max: baseParams.homePrice * 1.2,
      label: 'Home Price'
    },
    downPaymentPercent: { 
      min: 5, 
      max: 25,
      label: 'Down Payment %'
    },
    mortgageRate: { 
      min: 0.05, 
      max: 0.08,
      label: 'Mortgage Rate'
    },
    rentalIncome: { 
      min: baseParams.rentalIncome * 0.5, 
      max: baseParams.rentalIncome * 1.5,
      label: 'Rental Income'
    },
  }
  
  const xRange = ranges[xParam]
  const yRange = ranges[yParam]
  
  // Generate grid values
  const xValues: number[] = []
  const yValues: number[] = []
  for (let i = 0; i < resolution; i++) {
    xValues.push(xRange.min + (xRange.max - xRange.min) * (i / (resolution - 1)))
    yValues.push(yRange.min + (yRange.max - yRange.min) * (i / (resolution - 1)))
  }
  
  // Run simulations for each cell
  const cells: HeatmapCell[][] = []
  const breakEvenPoints: Array<{ x: number; y: number }> = []
  
  for (let xi = 0; xi < xValues.length; xi++) {
    cells[xi] = []
    for (let yi = 0; yi < yValues.length; yi++) {
      const cellParams = {
        ...testParams,
        [xParam]: xValues[xi],
        [yParam]: yValues[yi],
      }
      
      const result = runSimulation(cellParams)
      const cell: HeatmapCell = {
        x: xValues[xi],
        y: yValues[yi],
        winRate: result.finalStats.buyWinsProbability,
        p50Delta: result.finalStats.delta.p50,
      }
      cells[xi][yi] = cell
      
      // Track break-even points (winRate between 45-55%)
      if (cell.winRate >= 0.45 && cell.winRate <= 0.55) {
        breakEvenPoints.push({ x: cell.x, y: cell.y })
      }
    }
  }
  
  return {
    xLabel: xRange.label,
    yLabel: yRange.label,
    xValues,
    yValues,
    cells,
    breakEvenLine: breakEvenPoints,
  }
}

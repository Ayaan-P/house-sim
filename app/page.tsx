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

// Math Explained Component - Shows all calculations with user's values
function MathExplained({ inputs, simResults }: { inputs: SimulationParams; simResults: SimulationSummary | null }) {
  const [isExpanded, setIsExpanded] = useState(false)
  
  if (!simResults) return null
  
  // Calculate all the values we'll show
  const downPayment = inputs.homePrice * (inputs.downPaymentPercent / 100)
  const loanAmount = inputs.homePrice - downPayment
  const closingCosts = inputs.homePrice * (inputs.closingCostPercent / 100)
  const totalUpfront = downPayment + closingCosts
  
  // Monthly mortgage payment (P&I)
  const monthlyRate = inputs.mortgageRate / 12
  const numPayments = 360
  const monthlyPI = loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / (Math.pow(1 + monthlyRate, numPayments) - 1)
  const annualPI = monthlyPI * 12
  
  // Annual costs
  const annualPropertyTax = inputs.homePrice * inputs.propertyTaxRate
  const annualInsurance = inputs.insuranceAnnual
  const annualMaintenance = inputs.maintenanceAnnual || 0  // Flat annual cost, not % of home
  const annualHOA = inputs.hoaMonthly * 12
  const annualPMI = (loanAmount / inputs.homePrice) > 0.8 ? loanAmount * 0.005 : 0
  
  // Year 1 interest (approximately 85% of payment is interest in year 1)
  const year1Interest = annualPI * 0.85
  const year1Principal = annualPI - year1Interest
  
  // Rental income (if applicable)
  const hasRental = inputs.units.length > 0 || inputs.houseHack
  const monthlyRentalIncome = inputs.units.length > 0 
    ? inputs.units.filter(u => !u.ownerOccupied).reduce((sum, u) => sum + u.monthlyRent, 0)
    : inputs.houseHack ? inputs.rentalIncome : 0
  const annualRentalIncome = monthlyRentalIncome * 12 * (1 - (inputs.vacancyRate || 0))
  
  // Owner vs rental portion
  const ownerPortion = inputs.units.length > 0 
    ? inputs.units.filter(u => u.ownerOccupied).length / inputs.units.length
    : inputs.houseHack ? 0.5 : 1.0
  const rentalPortion = 1 - ownerPortion
  
  // Tax deductions - owner portion
  const standardDeduction = inputs.filingStatus === 'married' ? 31000 : 15500
  const ownerInterest = year1Interest * ownerPortion
  const ownerPropertyTax = annualPropertyTax * ownerPortion
  const stateIncomeTax = inputs.w2Income * inputs.stateRate
  const saltDeduction = Math.min(ownerPropertyTax + stateIncomeTax, 40000)
  const mortgageInterestDeduction = Math.min(ownerInterest, loanAmount <= 750000 ? ownerInterest : ownerInterest * (750000 / loanAmount))
  const totalItemized = mortgageInterestDeduction + saltDeduction
  const ownerTaxBenefit = totalItemized > standardDeduction ? (totalItemized - standardDeduction) * inputs.federalBracket : 0
  
  // Rental tax benefits - Schedule E
  const buildingValue = inputs.homePrice * (inputs.buildingValuePercent || 0.80)
  const rentalBuildingValue = buildingValue * rentalPortion
  const annualDepreciation = hasRental ? rentalBuildingValue / 27.5 : 0
  
  const rentalInterest = year1Interest * rentalPortion
  const rentalPropertyTax = annualPropertyTax * rentalPortion
  const rentalInsurance = annualInsurance * rentalPortion
  const rentalHOA = annualHOA * rentalPortion
  const rentalMaintenance = annualMaintenance * rentalPortion
  
  const scheduleEExpenses = rentalInterest + rentalPropertyTax + rentalInsurance + rentalHOA + rentalMaintenance + annualDepreciation
  const passiveLoss = Math.max(0, scheduleEExpenses - annualRentalIncome)
  
  // Passive loss allowance ($25k, phases out $100-150k AGI)
  let passiveLossAllowance = 0
  if (passiveLoss > 0 && inputs.w2Income < 150000) {
    const maxAllowance = 25000
    if (inputs.w2Income <= 100000) {
      passiveLossAllowance = Math.min(passiveLoss, maxAllowance)
    } else {
      const phaseOutReduction = (inputs.w2Income - 100000) / 2
      passiveLossAllowance = Math.min(passiveLoss, Math.max(0, maxAllowance - phaseOutReduction))
    }
  }
  
  const rentalDeduction = Math.min(scheduleEExpenses, annualRentalIncome) + passiveLossAllowance
  const rentalTaxBenefit = rentalDeduction * inputs.federalBracket
  
  const totalTaxBenefit = ownerTaxBenefit + rentalTaxBenefit
  
  // Total cost of buying (Year 1)
  const totalAnnualCostBuy = annualPI + annualPropertyTax + annualInsurance + annualMaintenance + annualHOA + annualPMI
  const netCostBuy = totalAnnualCostBuy - annualRentalIncome - totalTaxBenefit
  
  // Rent scenario
  const annualRent = inputs.currentRent * 12
  const monthlySavings = (netCostBuy - annualRent) / 12
  
  // Projected values (Year N at median)
  const finalYear = simResults.yearlyStats[simResults.yearlyStats.length - 1]
  
  // Export function - generates markdown summary of all calculations
  const exportMath = () => {
    const f = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
    const pct = (n: number) => `${(n * 100).toFixed(2)}%`
    
    const markdown = `# House vs Rent Analysis
Generated: ${new Date().toLocaleDateString()}

## Property Details
- Home Price: ${f(inputs.homePrice)}
- Down Payment: ${inputs.downPaymentPercent}% (${f(downPayment)})
- Loan Amount: ${f(loanAmount)}
- Mortgage Rate: ${pct(inputs.mortgageRate)}
- Term: 30 years

## Upfront Costs
- Down Payment: ${f(downPayment)}
- Closing Costs (${inputs.closingCostPercent}%): ${f(closingCosts)}
- **Total Cash Needed: ${f(totalUpfront)}**

## Monthly Mortgage Payment
Formula: P = L × [r(1+r)^n] / [(1+r)^n - 1]
- L (Loan): ${f(loanAmount)}
- r (Monthly Rate): ${pct(monthlyRate)}
- n (Payments): ${numPayments}
- **Monthly P&I: ${f(monthlyPI)}**
- Annual P&I: ${f(annualPI)}

## Annual Costs (Year 1)
| Item | Amount |
|------|--------|
| Mortgage (P&I) | ${f(annualPI)} |
| Property Tax (${pct(inputs.propertyTaxRate)}) | ${f(annualPropertyTax)} |
| Insurance | ${f(annualInsurance)} |
| Maintenance | ${f(annualMaintenance)} |
| HOA | ${f(annualHOA)} |
| PMI | ${f(annualPMI)} |
| **Total Gross** | **${f(totalAnnualCostBuy)}** |

## Tax Deductions
### Owner-Occupied (Schedule A)
- Owner Portion: ${(ownerPortion * 100).toFixed(0)}%
- Mortgage Interest (Year 1): ${f(ownerInterest)}
- SALT (capped at $40k): ${f(saltDeduction)}
- Total Itemized: ${f(totalItemized)}
- Standard Deduction: ${f(standardDeduction)}
- Benefit Over Standard: ${f(Math.max(0, totalItemized - standardDeduction))}
- **Owner Tax Savings: ${f(ownerTaxBenefit)}**

${hasRental ? `### Rental (Schedule E)
- Rental Portion: ${(rentalPortion * 100).toFixed(0)}%
- Rental Income: ${f(annualRentalIncome)}
- Rental Expenses: ${f(scheduleEExpenses - annualDepreciation)}
- Depreciation (27.5 yr): ${f(annualDepreciation)}
- Total Schedule E Expenses: ${f(scheduleEExpenses)}
- Passive Loss: ${f(passiveLoss)}
- Passive Loss Allowance: ${f(passiveLossAllowance)}
- **Rental Tax Savings: ${f(rentalTaxBenefit)}**
` : ''}
**Total Tax Savings: ${f(totalTaxBenefit)}/yr**

## Net Cost of Buying
- Gross Costs: ${f(totalAnnualCostBuy)}
- Rental Income: -${f(annualRentalIncome)}
- Tax Savings: -${f(totalTaxBenefit)}
- **Net Annual Cost: ${f(netCostBuy)}**
- **Net Monthly Cost: ${f(netCostBuy / 12)}**

## Rent Alternative
- Current Rent: ${f(inputs.currentRent)}/mo (${f(annualRent)}/yr)
- Rent Growth: ${pct(inputs.rentGrowth)}/yr
- Buy vs Rent Difference: ${f(Math.abs(netCostBuy - annualRent))}/yr (${netCostBuy > annualRent ? 'buying costs more' : 'buying costs less'})

## Monte Carlo Assumptions
- Home Appreciation: μ=${pct(inputs.appreciationMean)}, σ=${pct(inputs.appreciationStdDev)}
- Stock Returns: μ=${pct(inputs.stockReturnMean)}, σ=${pct(inputs.stockReturnStdDev)}
- Correlation: ${pct(inputs.marketCorrelation || 0.3)}
- Simulations: ${inputs.numSimulations.toLocaleString()}
- Time Horizon: ${inputs.years} years

## Results (Year ${inputs.years})
| Scenario | P10 | P50 (Median) | P90 |
|----------|-----|--------------|-----|
| Buy | ${f(finalYear?.wealthBuy.p10 || 0)} | ${f(finalYear?.wealthBuy.p50 || 0)} | ${f(finalYear?.wealthBuy.p90 || 0)} |
| Rent | ${f(finalYear?.wealthRent.p10 || 0)} | ${f(finalYear?.wealthRent.p50 || 0)} | ${f(finalYear?.wealthRent.p90 || 0)} |
| Delta | ${f(finalYear?.delta.p10 || 0)} | ${f(finalYear?.delta.p50 || 0)} | ${f(finalYear?.delta.p90 || 0)} |

**Buy wins in ${(simResults.finalStats.buyWinsProbability * 100).toFixed(0)}% of simulations**

---
*Generated by HouseSim (house-vs-rent.netlify.app)*
`
    
    // Create and download file
    const blob = new Blob([markdown], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `house-analysis-${new Date().toISOString().split('T')[0]}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }
  
  // Share function - generates URL with ALL parameters (only non-default values)
  const [copied, setCopied] = useState(false)
  const shareUrl = () => {
    const params = new URLSearchParams()
    const d = defaultParams  // Compare against defaults
    
    // Helper to add param only if different from default
    const add = (key: string, val: number | string, def?: number | string) => {
      if (def === undefined || val !== def) params.set(key, val.toString())
    }
    const addPct = (key: string, val: number, def?: number) => {
      if (def === undefined || val !== def) params.set(key, (val * 100).toString())
    }
    
    // House (always include core params)
    params.set('price', inputs.homePrice.toString())
    params.set('down', inputs.downPaymentPercent.toString())
    addPct('rate', inputs.mortgageRate, d.mortgageRate)
    addPct('tax', inputs.propertyTaxRate, d.propertyTaxRate)
    add('insurance', inputs.insuranceAnnual, d.insuranceAnnual)
    
    // Additional costs
    add('closing', inputs.closingCostPercent, d.closingCostPercent)
    add('hoa', inputs.hoaMonthly, d.hoaMonthly)
    add('maint', inputs.maintenanceAnnual, d.maintenanceAnnual)
    
    // House hack / rental
    if (inputs.houseHack) params.set('househack', '1')
    if (inputs.rentalIncome > 0) add('rental', inputs.rentalIncome, 0)
    addPct('rentalgrowth', inputs.rentalIncomeGrowth, d.rentalIncomeGrowth)
    addPct('vacancy', inputs.vacancyRate, d.vacancyRate)
    
    // Tax
    add('income', inputs.w2Income, d.w2Income)
    addPct('fedbracket', inputs.federalBracket, d.federalBracket)
    addPct('staterate', inputs.stateRate, d.stateRate)
    if (inputs.filingStatus !== d.filingStatus) params.set('filing', inputs.filingStatus)
    addPct('buildingpct', inputs.buildingValuePercent, d.buildingValuePercent)
    
    // Alternative (rent)
    params.set('rent', inputs.currentRent.toString())
    addPct('rentgrowth', inputs.rentGrowth, d.rentGrowth)
    
    // Distributions
    addPct('appr', inputs.appreciationMean, d.appreciationMean)
    addPct('apprstd', inputs.appreciationStdDev, d.appreciationStdDev)
    addPct('stock', inputs.stockReturnMean, d.stockReturnMean)
    addPct('stockstd', inputs.stockReturnStdDev, d.stockReturnStdDev)
    addPct('corr', inputs.marketCorrelation, d.marketCorrelation)
    
    // Cost growth
    addPct('taxgrowth', inputs.propertyTaxGrowth, d.propertyTaxGrowth)
    addPct('insgrowth', inputs.insuranceGrowth, d.insuranceGrowth)
    
    // Exit costs
    add('sellcost', inputs.sellingCostPercent, d.sellingCostPercent)
    addPct('capgains', inputs.capitalGainsTaxRate, d.capitalGainsTaxRate)
    
    // Simulation
    params.set('years', inputs.years.toString())
    add('sims', inputs.numSimulations, d.numSimulations)
    
    // Multi-family
    if (inputs.units.length > 0) {
      params.set('type', `${inputs.units.length}-family`)
      const totalRent = inputs.units.filter(u => !u.ownerOccupied).reduce((sum, u) => sum + u.monthlyRent, 0)
      params.set('rental', totalRent.toString())
    }
    
    // FTHB
    if (inputs.firstTimeHomeBuyer?.enabled) {
      params.set('fthb', '1')
      if (inputs.firstTimeHomeBuyer.noPMI) params.set('nopmi', '1')
      if (inputs.firstTimeHomeBuyer.downPaymentAssistance > 0) params.set('dpa', inputs.firstTimeHomeBuyer.downPaymentAssistance.toString())
      if (inputs.firstTimeHomeBuyer.rateDiscount > 0) params.set('discount', (inputs.firstTimeHomeBuyer.rateDiscount * 100).toString())
      if (inputs.firstTimeHomeBuyer.taxCredit > 0) params.set('taxcredit', inputs.firstTimeHomeBuyer.taxCredit.toString())
    }
    
    // HELOC
    if (inputs.heloc?.enabled) {
      params.set('heloc', '1')
      if (inputs.heloc.minEquityPercent !== 0.30) params.set('helocmin', (inputs.heloc.minEquityPercent * 100).toString())
      if (inputs.heloc.maxLTV !== 0.80) params.set('helocltv', (inputs.heloc.maxLTV * 100).toString())
      if (inputs.heloc.rate !== 0.08) params.set('helocrate', (inputs.heloc.rate * 100).toString())
      if (!inputs.heloc.deployToStocks) params.set('helocnostocks', '1')
    }
    
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  
  return (
    <Section title="🧮 How The Math Works">
      <div className="flex gap-2">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex-1 text-left flex items-center justify-between p-4 bg-white/[0.02] rounded-xl border border-white/[0.08] hover:border-white/20 transition-colors"
        >
          <span className="text-white/70">
            {isExpanded ? 'Click to collapse' : 'Click to see step-by-step calculations with your numbers'}
          </span>
          <span className={`transform transition-transform text-white/50 ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
        </button>
        <button
          onClick={shareUrl}
          className={`px-4 py-2 ${copied ? 'bg-green-600' : 'bg-purple-600 hover:bg-purple-700'} text-white rounded-xl border ${copied ? 'border-green-500' : 'border-purple-500'} transition-colors flex items-center gap-2`}
          title="Copy shareable link"
        >
          <span>{copied ? '✓' : '🔗'}</span>
          <span className="hidden sm:inline">{copied ? 'Copied!' : 'Share'}</span>
        </button>
        <button
          onClick={exportMath}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl border border-blue-500 transition-colors flex items-center gap-2"
          title="Export calculations as Markdown"
        >
          <span>📥</span>
          <span className="hidden sm:inline">Export</span>
        </button>
      </div>
      
      {isExpanded && (
        <div className="mt-4 space-y-6 text-sm">
          
          {/* Step 1: Upfront Costs */}
          <div className="p-4 bg-blue-900/20 border border-blue-500/30 rounded-xl">
            <h4 className="text-blue-400 font-bold mb-3">Step 1: What You Pay Upfront</h4>
            <div className="space-y-2 text-white/80">
              <div className="flex justify-between">
                <span>Home Price</span>
                <span className="font-mono">{formatCurrency(inputs.homePrice)}</span>
              </div>
              <div className="flex justify-between pl-4 text-white/60">
                <span>Down Payment ({inputs.downPaymentPercent}%)</span>
                <span className="font-mono">− {formatCurrency(downPayment)}</span>
              </div>
              <div className="flex justify-between border-t border-white/10 pt-2">
                <span>Loan Amount</span>
                <span className="font-mono font-bold">{formatCurrency(loanAmount)}</span>
              </div>
              <div className="flex justify-between pt-2">
                <span>Closing Costs ({inputs.closingCostPercent}%)</span>
                <span className="font-mono">{formatCurrency(closingCosts)}</span>
              </div>
              <div className="flex justify-between border-t border-white/10 pt-2 text-blue-400">
                <span className="font-bold">Total Cash Needed</span>
                <span className="font-mono font-bold">{formatCurrency(totalUpfront)}</span>
              </div>
            </div>
            <p className="mt-3 text-xs text-white/50">
              💡 This is the capital you need to buy. If renting, this money goes into the stock market instead.
            </p>
          </div>
          
          {/* Step 2: Monthly Mortgage */}
          <div className="p-4 bg-purple-900/20 border border-purple-500/30 rounded-xl">
            <h4 className="text-purple-400 font-bold mb-3">Step 2: Your Mortgage Payment</h4>
            <div className="space-y-2 text-white/80">
              <div className="text-white/50 text-xs mb-2">
                Formula: P = L × [r(1+r)ⁿ] / [(1+r)ⁿ - 1]
                <br />
                Where L = loan, r = monthly rate, n = payments
              </div>
              <div className="flex justify-between">
                <span>Loan Amount (L)</span>
                <span className="font-mono">{formatCurrency(loanAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span>Monthly Rate (r = {(inputs.mortgageRate * 100).toFixed(2)}% ÷ 12)</span>
                <span className="font-mono">{(monthlyRate * 100).toFixed(4)}%</span>
              </div>
              <div className="flex justify-between">
                <span>Number of Payments (n = 30 years × 12)</span>
                <span className="font-mono">360</span>
              </div>
              <div className="flex justify-between border-t border-white/10 pt-2 text-purple-400">
                <span className="font-bold">Monthly P&I Payment</span>
                <span className="font-mono font-bold">{formatCurrency(monthlyPI)}/mo</span>
              </div>
              <div className="flex justify-between text-white/60">
                <span>Annual P&I</span>
                <span className="font-mono">{formatCurrency(annualPI)}/yr</span>
              </div>
            </div>
            <p className="mt-3 text-xs text-white/50">
              💡 In Year 1, ~{(0.85 * 100).toFixed(0)}% ({formatCurrency(year1Interest)}) goes to interest, only ~{(0.15 * 100).toFixed(0)}% ({formatCurrency(year1Principal)}) builds equity.
            </p>
          </div>
          
          {/* Step 3: Total Annual Costs */}
          <div className="p-4 bg-red-900/20 border border-red-500/30 rounded-xl">
            <h4 className="text-red-400 font-bold mb-3">Step 3: Total Cost of Owning (Year 1)</h4>
            <div className="space-y-2 text-white/80">
              <div className="flex justify-between">
                <span>Mortgage (P&I)</span>
                <span className="font-mono">{formatCurrency(annualPI)}</span>
              </div>
              <div className="flex justify-between">
                <span>Property Tax ({(inputs.propertyTaxRate * 100).toFixed(2)}%)</span>
                <span className="font-mono">{formatCurrency(annualPropertyTax)}</span>
              </div>
              <div className="flex justify-between">
                <span>Insurance</span>
                <span className="font-mono">{formatCurrency(annualInsurance)}</span>
              </div>
              <div className="flex justify-between">
                <span>Maintenance/Repairs</span>
                <span className="font-mono">{formatCurrency(annualMaintenance)}</span>
              </div>
              {inputs.hoaMonthly > 0 && (
                <div className="flex justify-between">
                  <span>HOA ({formatCurrency(inputs.hoaMonthly)}/mo)</span>
                  <span className="font-mono">{formatCurrency(annualHOA)}</span>
                </div>
              )}
              {annualPMI > 0 && (
                <div className="flex justify-between">
                  <span>PMI (down &lt; 20%)</span>
                  <span className="font-mono">{formatCurrency(annualPMI)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-white/10 pt-2">
                <span className="font-bold">Gross Annual Cost</span>
                <span className="font-mono font-bold">{formatCurrency(totalAnnualCostBuy)}</span>
              </div>
              
              {/* Deductions */}
              {hasRental && (
                <div className="flex justify-between text-green-400">
                  <span>− Rental Income (after {((inputs.vacancyRate || 0) * 100).toFixed(0)}% vacancy)</span>
                  <span className="font-mono">−{formatCurrency(annualRentalIncome)}</span>
                </div>
              )}
              {totalTaxBenefit > 0 && (
                <div className="flex justify-between text-green-400">
                  <span>− Tax Savings (owner + rental)</span>
                  <span className="font-mono">−{formatCurrency(totalTaxBenefit)}</span>
                </div>
              )}
              
              <div className="flex justify-between border-t border-white/10 pt-2 text-red-400">
                <span className="font-bold">Net Annual Cost (Buying)</span>
                <span className="font-mono font-bold">{formatCurrency(netCostBuy)}</span>
              </div>
              <div className="flex justify-between text-white/60">
                <span>Monthly</span>
                <span className="font-mono">{formatCurrency(netCostBuy / 12)}/mo</span>
              </div>
            </div>
          </div>
          
          {/* Step 4: Tax Math */}
          <div className="p-4 bg-yellow-900/20 border border-yellow-500/30 rounded-xl">
            <h4 className="text-yellow-400 font-bold mb-3">Step 4: Tax Deductions Explained</h4>
            <div className="space-y-2 text-white/80">
              {hasRental && (
                <div className="text-white/50 text-xs mb-2">
                  Owner portion: {(ownerPortion * 100).toFixed(0)}% | Rental portion: {(rentalPortion * 100).toFixed(0)}%
                </div>
              )}
              
              {/* Owner-Occupied Deductions */}
              <div className="text-white/60 text-xs mt-2">Owner-Occupied (Schedule A):</div>
              <div className="flex justify-between pl-4">
                <span>Standard Deduction ({inputs.filingStatus})</span>
                <span className="font-mono">{formatCurrency(standardDeduction)}</span>
              </div>
              <div className="flex justify-between pl-4">
                <span>Mortgage Interest ({(ownerPortion * 100).toFixed(0)}%)</span>
                <span className="font-mono">{formatCurrency(mortgageInterestDeduction)}</span>
              </div>
              <div className="flex justify-between pl-4">
                <span>SALT (capped at $40k)</span>
                <span className="font-mono">{formatCurrency(saltDeduction)}</span>
              </div>
              <div className="flex justify-between pl-4">
                <span>Total Itemized</span>
                <span className="font-mono">{formatCurrency(totalItemized)}</span>
              </div>
              <div className="flex justify-between pl-4">
                <span>Benefit Over Standard</span>
                <span className={`font-mono ${totalItemized > standardDeduction ? 'text-green-400' : 'text-white/40'}`}>
                  {totalItemized > standardDeduction ? `+${formatCurrency(totalItemized - standardDeduction)}` : 'None'}
                </span>
              </div>
              {ownerTaxBenefit > 0 && (
                <div className="flex justify-between pl-4 text-yellow-400">
                  <span>Owner Tax Savings</span>
                  <span className="font-mono">{formatCurrency(ownerTaxBenefit)}</span>
                </div>
              )}
              
              {/* Rental Deductions */}
              {hasRental && (
                <>
                  <div className="text-white/60 text-xs mt-4">Rental (Schedule E):</div>
                  <div className="flex justify-between pl-4">
                    <span>Rental Income</span>
                    <span className="font-mono">{formatCurrency(annualRentalIncome)}</span>
                  </div>
                  <div className="flex justify-between pl-4">
                    <span>Rental Expenses (interest, tax, ins, maint)</span>
                    <span className="font-mono">{formatCurrency(scheduleEExpenses - annualDepreciation)}</span>
                  </div>
                  <div className="flex justify-between pl-4">
                    <span>+ Depreciation (27.5 yr)</span>
                    <span className="font-mono">{formatCurrency(annualDepreciation)}</span>
                  </div>
                  <div className="flex justify-between pl-4">
                    <span>Total Schedule E Expenses</span>
                    <span className="font-mono">{formatCurrency(scheduleEExpenses)}</span>
                  </div>
                  {passiveLoss > 0 && (
                    <>
                      <div className="flex justify-between pl-4 text-orange-400">
                        <span>Passive Loss (expenses − income)</span>
                        <span className="font-mono">{formatCurrency(passiveLoss)}</span>
                      </div>
                      <div className="flex justify-between pl-4 text-green-400">
                        <span>Passive Loss Allowance (up to $25k)</span>
                        <span className="font-mono">{formatCurrency(passiveLossAllowance)}</span>
                      </div>
                      {inputs.w2Income > 100000 && inputs.w2Income < 150000 && (
                        <div className="text-white/40 text-xs pl-4">
                          (Phased out: AGI ${inputs.w2Income.toLocaleString()} → lose ${((inputs.w2Income - 100000) / 2).toLocaleString()})
                        </div>
                      )}
                    </>
                  )}
                  <div className="flex justify-between pl-4 text-yellow-400">
                    <span>Rental Tax Savings</span>
                    <span className="font-mono">{formatCurrency(rentalTaxBenefit)}</span>
                  </div>
                </>
              )}
              
              <div className="flex justify-between border-t border-white/10 pt-2 text-yellow-400">
                <span className="font-bold">TOTAL TAX SAVINGS</span>
                <span className="font-mono font-bold">{formatCurrency(totalTaxBenefit)}/yr</span>
              </div>
            </div>
            <p className="mt-3 text-xs text-white/50">
              💡 Passive losses above income can offset up to $25k of W2 income if AGI &lt; $100k (phases out $100-150k).
            </p>
          </div>
          
          {/* Step 5: Rent Comparison */}
          <div className="p-4 bg-emerald-900/20 border border-emerald-500/30 rounded-xl">
            <h4 className="text-emerald-400 font-bold mb-3">Step 5: Rent + Invest Alternative</h4>
            <div className="space-y-2 text-white/80">
              <div className="flex justify-between">
                <span>Current Rent</span>
                <span className="font-mono">{formatCurrency(inputs.currentRent)}/mo</span>
              </div>
              <div className="flex justify-between">
                <span>Annual Rent</span>
                <span className="font-mono">{formatCurrency(annualRent)}/yr</span>
              </div>
              <div className="flex justify-between">
                <span>Rent Growth Rate</span>
                <span className="font-mono">{(inputs.rentGrowth * 100).toFixed(1)}%/yr</span>
              </div>
              <div className="flex justify-between border-t border-white/10 pt-2">
                <span>Buy costs {netCostBuy > annualRent ? 'more' : 'less'} by</span>
                <span className={`font-mono ${netCostBuy > annualRent ? 'text-red-400' : 'text-green-400'}`}>
                  {formatCurrency(Math.abs(netCostBuy - annualRent))}/yr
                </span>
              </div>
              <div className="flex justify-between text-white/60">
                <span>Monthly difference</span>
                <span className="font-mono">{formatCurrency(Math.abs(monthlySavings))}/mo</span>
              </div>
            </div>
            <p className="mt-3 text-xs text-white/50">
              💡 If renting is cheaper, you invest the {formatCurrency(totalUpfront)} down payment PLUS {formatCurrency(Math.abs(monthlySavings))}/mo savings into stocks.
              {netCostBuy < annualRent && ` If buying is cheaper, YOU invest the ${formatCurrency(Math.abs(monthlySavings))}/mo savings.`}
            </p>
          </div>
          
          {/* Step 6: Monte Carlo */}
          <div className="p-4 bg-cyan-900/20 border border-cyan-500/30 rounded-xl">
            <h4 className="text-cyan-400 font-bold mb-3">Step 6: The Monte Carlo Magic</h4>
            <div className="space-y-3 text-white/80">
              <p>
                We run <span className="text-cyan-400 font-bold">{inputs.numSimulations.toLocaleString()}</span> simulations. 
                In each one, we randomly sample:
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-black/30 rounded-lg">
                  <div className="text-white/60 text-xs mb-1">Home Appreciation</div>
                  <div className="font-mono">
                    μ = {(inputs.appreciationMean * 100).toFixed(1)}%/yr
                    <br />
                    σ = {(inputs.appreciationStdDev * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-white/40 mt-1">
                    Range: roughly {((inputs.appreciationMean - 2*inputs.appreciationStdDev) * 100).toFixed(0)}% to +{((inputs.appreciationMean + 2*inputs.appreciationStdDev) * 100).toFixed(0)}%
                  </div>
                </div>
                <div className="p-3 bg-black/30 rounded-lg">
                  <div className="text-white/60 text-xs mb-1">Stock Returns</div>
                  <div className="font-mono">
                    μ = {(inputs.stockReturnMean * 100).toFixed(1)}%/yr
                    <br />
                    σ = {(inputs.stockReturnStdDev * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-white/40 mt-1">
                    Range: roughly {((inputs.stockReturnMean - 2*inputs.stockReturnStdDev) * 100).toFixed(0)}% to +{((inputs.stockReturnMean + 2*inputs.stockReturnStdDev) * 100).toFixed(0)}%
                  </div>
                </div>
              </div>
              <p className="text-white/60 text-xs">
                Each year, we draw random returns from normal distributions and compound them. 
                After {inputs.years} years, we compare: <span className="text-blue-400">Home Equity</span> vs <span className="text-green-400">Stock Portfolio</span>.
              </p>
            </div>
          </div>
          
          {/* Step 7: Final Comparison */}
          <div className="p-4 bg-gradient-to-br from-green-900/30 to-blue-900/30 border border-white/20 rounded-xl">
            <h4 className="text-white font-bold mb-3">Step 7: Final Wealth Comparison (Year {inputs.years})</h4>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <div className="text-blue-400 font-bold mb-2">🏠 If You Buy</div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-white/60">Home Value (P50)</span>
                    <span className="font-mono">{formatCurrency(finalYear?.wealthBuy.p50 || 0)}</span>
                  </div>
                  <div className="text-xs text-white/40 pl-2">
                    (equity after selling costs, mortgage payoff, taxes)
                  </div>
                </div>
              </div>
              <div>
                <div className="text-green-400 font-bold mb-2">📈 If You Rent + Invest</div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-white/60">Portfolio Value (P50)</span>
                    <span className="font-mono">{formatCurrency(finalYear?.wealthRent.p50 || 0)}</span>
                  </div>
                  <div className="text-xs text-white/40 pl-2">
                    (down payment + monthly savings, compounded)
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-white/20 text-center">
              <div className="text-white/60 mb-1">Median Outcome (P50)</div>
              <div className={`text-2xl font-bold ${(finalYear?.delta.p50 || 0) > 0 ? 'text-green-400' : 'text-red-400'}`}>
                {(finalYear?.delta.p50 || 0) > 0 ? 'Buying wins by ' : 'Renting wins by '}
                {formatCurrency(Math.abs(finalYear?.delta.p50 || 0))}
              </div>
              <div className="text-white/50 text-sm mt-1">
                Buy wins in {(simResults.finalStats.buyWinsProbability * 100).toFixed(0)}% of {inputs.numSimulations.toLocaleString()} simulations
              </div>
            </div>
          </div>
          
          {/* Disclaimer */}
          <div className="p-4 bg-white/[0.02] border border-white/[0.06] rounded-xl text-xs text-white/40">
            <strong className="text-white/60">⚠️ Important Caveats:</strong>
            <ul className="mt-2 space-y-1 list-disc list-inside">
              <li>This assumes you stay the full {inputs.years} years. Selling early typically favors renting.</li>
              <li>Real returns have "fat tails" — extreme outcomes (crashes, booms) happen more than normal distributions suggest.</li>
              <li>Housing and stocks are modeled with {((inputs.marketCorrelation || 0.3) * 100).toFixed(0)}% correlation — they often move together in crises.</li>
              <li>This ignores lifestyle factors: stability, ability to renovate, forced savings discipline, etc.</li>
              <li>Tax laws change. This uses 2026 rules (SALT cap, mortgage interest limits).</li>
              <li>This is not financial advice. It's math. Your situation may differ.</li>
            </ul>
          </div>
          
        </div>
      )}
    </Section>
  )
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
  
  // Parse URL params - comprehensive list of all SimulationParams fields
  useEffect(() => {
    const p = (key: string) => searchParams.get(key)
    const pNum = (key: string) => p(key) ? parseFloat(p(key)!) : null
    const pInt = (key: string) => p(key) ? parseInt(p(key)!, 10) : null
    const pBool = (key: string) => p(key) === '1' || p(key) === 'true'
    const pPct = (key: string) => pNum(key) !== null ? pNum(key)! / 100 : null  // Convert percentage to decimal
    
    // Check if any params exist
    if (!searchParams.toString()) return
    
    setInputs(prev => {
      const updates: Partial<SimulationParams> = {}
      
      // House
      if (pNum('price') !== null) updates.homePrice = pNum('price')!
      if (pNum('down') !== null) updates.downPaymentPercent = pNum('down')!
      if (pPct('rate') !== null) updates.mortgageRate = pPct('rate')!
      if (pPct('tax') !== null) updates.propertyTaxRate = pPct('tax')!
      if (pNum('insurance') !== null) updates.insuranceAnnual = pNum('insurance')!
      
      // Additional costs
      if (pPct('closing') !== null) updates.closingCostPercent = pNum('closing')!
      if (pNum('hoa') !== null) updates.hoaMonthly = pNum('hoa')!
      if (pNum('maint') !== null) updates.maintenanceAnnual = pNum('maint')!
      
      // House hack / rental
      if (pBool('househack')) updates.houseHack = true
      if (pNum('rental') !== null) updates.rentalIncome = pNum('rental')!
      if (pPct('rentalgrowth') !== null) updates.rentalIncomeGrowth = pPct('rentalgrowth')!
      if (pPct('vacancy') !== null) updates.vacancyRate = pPct('vacancy')!
      
      // Tax
      if (pNum('income') !== null) updates.w2Income = pNum('income')!
      if (pPct('fedbracket') !== null) updates.federalBracket = pPct('fedbracket')!
      if (pPct('staterate') !== null) updates.stateRate = pPct('staterate')!
      if (p('filing') === 'married') updates.filingStatus = 'married'
      if (pPct('buildingpct') !== null) updates.buildingValuePercent = pPct('buildingpct')!
      
      // Alternative (rent)
      if (pNum('rent') !== null) updates.currentRent = pNum('rent')!
      if (pPct('rentgrowth') !== null) updates.rentGrowth = pPct('rentgrowth')!
      
      // Distributions
      if (pPct('appr') !== null) updates.appreciationMean = pPct('appr')!
      if (pPct('apprstd') !== null) updates.appreciationStdDev = pPct('apprstd')!
      if (pPct('stock') !== null) updates.stockReturnMean = pPct('stock')!
      if (pPct('stockstd') !== null) updates.stockReturnStdDev = pPct('stockstd')!
      if (pPct('corr') !== null) updates.marketCorrelation = pPct('corr')!
      
      // Cost growth
      if (pPct('taxgrowth') !== null) updates.propertyTaxGrowth = pPct('taxgrowth')!
      if (pPct('insgrowth') !== null) updates.insuranceGrowth = pPct('insgrowth')!
      
      // Exit costs
      if (pPct('sellcost') !== null) updates.sellingCostPercent = pNum('sellcost')!
      if (pPct('capgains') !== null) updates.capitalGainsTaxRate = pPct('capgains')!
      
      // Simulation
      if (pInt('years') !== null) updates.years = pInt('years')!
      if (pInt('sims') !== null) updates.numSimulations = pInt('sims')!
      
      // FTHB
      if (pBool('fthb')) {
        updates.firstTimeHomeBuyer = {
          enabled: true,
          noPMI: pBool('nopmi'),
          downPaymentAssistance: pNum('dpa') || 0,
          lowerRate: pPct('discount') !== null,
          rateDiscount: pPct('discount') || 0,
          taxCredit: pNum('taxcredit') || 0,
        }
      }
      
      // HELOC
      if (pBool('heloc')) {
        updates.heloc = {
          enabled: true,
          minEquityPercent: pPct('helocmin') || 0.30,
          maxLTV: pPct('helocltv') || 0.80,
          rate: pPct('helocrate') || 0.08,
          deployToStocks: !pBool('helocnostocks'),
        }
      }
      
      // Multi-family setup
      const type = p('type')
      if (type && (type.includes('family') || type.includes('Family'))) {
        const familyType = type.toLowerCase().includes('3') ? '3-family' 
          : type.toLowerCase().includes('4') ? '4-family' 
          : '2-family'
        
        const units = createMultiFamilyUnits(familyType)
        
        const rental = pNum('rental')
        if (rental !== null) {
          const rentalUnits = units.filter(u => !u.ownerOccupied)
          const perUnit = rental / rentalUnits.length
          rentalUnits.forEach(u => { u.monthlyRent = Math.round(perUnit) })
        }
        
        updates.units = units
        updates.houseHack = true
      } else if (pNum('rental') !== null) {
        updates.rentalIncome = pNum('rental')!
        updates.houseHack = true
      }
      
      return { ...prev, ...updates }
    })
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
              <InputField label="Maintenance/yr" value={inputs.maintenanceAnnual} onChange={(v: number) => update('maintenanceAnnual', v)} prefix="$" />
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
          
          {/* Math Explained Section */}
          <MathExplained inputs={inputs} simResults={simResults} />
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

'use client'

import { useState, useMemo, useCallback, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { PageWrapper, Header, Section } from '@/components/layout'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area, ComposedChart, ReferenceLine,
} from 'recharts'
import { 
  runSimulation, defaultParams, SimulationParams, SimulationSummary, SimulationRun,
  Unit, createMultiFamilyUnits, getUnitSummary,
  runSensitivityAnalysis, SensitivityResult,
  runBreakEvenSurface, BreakEvenSurface,
  runWhatIfAnalysis, WhatIfResult, WhatIfScenario
} from '@/lib/monte-carlo'
import { KeyboardShortcuts } from '@/components/KeyboardShortcuts'
import { ResultsSkeleton, SimulationProgress } from '@/components/Skeleton'
import { NationalComparison } from '@/components/NationalComparison'

// Wrapper component to handle searchParams with Suspense
function HousePageContent() {
  return <HousePageInner />
}

export default function HousePage() {
  return (
    <Suspense fallback={
      <PageWrapper>
        <Header title="House Monte Carlo Simulation" />
        <div className="text-center py-12 text-[var(--content-subtle)]">Loading...</div>
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
  // PMI: required if LTV > 80%, unless FTHB noPMI benefit
  const needsPMI = (loanAmount / inputs.homePrice) > 0.8 && !(inputs.firstTimeHomeBuyer?.enabled && inputs.firstTimeHomeBuyer?.noPMI)
  const annualPMI = needsPMI ? loanAmount * 0.005 : 0
  
  // Year 1 interest - calculate actual amortization for first 12 payments
  let year1Interest = 0
  let year1Principal = 0
  let balance = loanAmount
  for (let i = 0; i < 12; i++) {
    const monthInterest = balance * monthlyRate
    const monthPrincipal = monthlyPI - monthInterest
    year1Interest += monthInterest
    year1Principal += monthPrincipal
    balance -= monthPrincipal
  }
  
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
  const standardDeduction = inputs.filingStatus === 'married' ? 32200 : 16100  // 2026 IRS values
  const ownerInterest = year1Interest * ownerPortion
  const ownerPropertyTax = annualPropertyTax * ownerPortion
  const stateIncomeTax = inputs.w2Income * inputs.stateRate
  const saltDeduction = Math.min(ownerPropertyTax + stateIncomeTax, 40000)
  // $750k limit applies to owner-occupied portion of loan only
  const ownerLoanPortion = loanAmount * ownerPortion
  const mortgageInterestDeduction = ownerLoanPortion <= 750000 
    ? ownerInterest 
    : ownerInterest * (750000 / ownerLoanPortion)
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
  
  // Rental tax benefit is ONLY the passive loss allowance that offsets W2 income
  // (The rental income itself is already subtracted from gross costs separately)
  const rentalTaxBenefit = passiveLossAllowance * inputs.federalBracket
  
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
- Mortgage Interest (Year 1): ${f(mortgageInterestDeduction)}
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
  
  // Export CSV with formulas for Google Sheets
  const exportCSV = () => {
    // Calculate all values needed for export
    const fthb = inputs.firstTimeHomeBuyer || { enabled: false, noPMI: false }
    const effectivePMI = fthb.enabled && fthb.noPMI ? 0 : annualPMI
    const costSeg = inputs.taxStrategies?.costSegregation || { enabled: false, shortLifePercent: 0.20 }
    const qbi = inputs.taxStrategies?.qbi || { enabled: false }
    const exitStrategy = inputs.exitStrategy || 'sell'
    
    // Cost segregation depreciation
    const rentalBuildingValue = inputs.homePrice * 0.8 * rentalPortion
    let year1Depreciation = rentalBuildingValue / 27.5
    let suspendedLossPerYear = 0
    if (costSeg.enabled) {
      const shortLifeValue = rentalBuildingValue * costSeg.shortLifePercent
      const longLifeValue = rentalBuildingValue * (1 - costSeg.shortLifePercent)
      year1Depreciation = shortLifeValue + (longLifeValue / 27.5)
    }
    
    // Passive loss with cost seg
    const scheduleEExpensesCostSeg = (year1Interest * rentalPortion) + (annualPropertyTax * rentalPortion) + 
      (annualInsurance * rentalPortion) + (annualMaintenance * rentalPortion) + year1Depreciation
    const passiveLossCostSeg = Math.max(0, scheduleEExpensesCostSeg - annualRentalIncome)
    suspendedLossPerYear = Math.max(0, passiveLossCostSeg - passiveLossAllowance)
    
    // Exit calculations (10 year projection)
    const years = inputs.years || 10
    const appreciationRate = inputs.appreciationMean || 0.05
    const futureHomeValue = inputs.homePrice * Math.pow(1 + appreciationRate, years)
    const totalDepreciation = costSeg.enabled 
      ? (rentalBuildingValue * costSeg.shortLifePercent) + ((rentalBuildingValue * (1 - costSeg.shortLifePercent)) / 27.5 * years)
      : (rentalBuildingValue / 27.5) * years
    const totalSuspendedLosses = suspendedLossPerYear * years
    const capitalGain = futureHomeValue - inputs.homePrice
    const capGainsExemption = inputs.filingStatus === 'married' ? 500000 : 250000
    const taxableGain = exitStrategy === 'remote' ? capitalGain : Math.max(0, capitalGain - capGainsExemption)
    const capitalGainsTax = (exitStrategy === 'hold' || exitStrategy === '1031') ? 0 : taxableGain * 0.15
    const depreciationRecapture = (exitStrategy === 'hold' || exitStrategy === '1031') ? 0 : totalDepreciation * 0.25
    const sellingCosts = (exitStrategy === 'hold') ? 0 : futureHomeValue * 0.06
    
    const csv = `House vs Rent Calculator - Full Export
Generated: ${new Date().toISOString()}
URL: ${typeof window !== 'undefined' ? window.location.href : ''}

=== INPUTS ===
Item,Value,Formula/Notes

PROPERTY,,
Home Price,$${inputs.homePrice.toLocaleString()},
Down Payment %,${inputs.downPaymentPercent}%,
Down Payment,$${downPayment.toLocaleString()},=HomePrice*DownPct/100
Loan Amount,$${loanAmount.toLocaleString()},=HomePrice-DownPayment
Interest Rate,${(inputs.mortgageRate * 100).toFixed(2)}%,
Loan Term,30 years,360 months
Monthly P&I,$${monthlyPI.toFixed(0)},=PMT(rate/12;360;-LoanAmount)
Annual P&I,$${annualPI.toFixed(0)},=MonthlyPI*12
Year 1 Interest,$${year1Interest.toFixed(0)},Actual amortization calc (not approximation)

COSTS,,
Property Tax Rate,${(inputs.propertyTaxRate * 100).toFixed(2)}%,
Annual Property Tax,$${annualPropertyTax.toFixed(0)},=HomePrice*TaxRate
Insurance,$${inputs.insuranceAnnual.toLocaleString()},
Maintenance,$${inputs.maintenanceAnnual.toLocaleString()},
HOA,$${(inputs.hoaMonthly * 12).toLocaleString()},Annual
PMI,$${effectivePMI.toFixed(0)},${fthb.enabled && fthb.noPMI ? 'FTHB noPMI eliminates' : 'Until 20% equity'}

INCOME,,
W2 Income,$${inputs.w2Income.toLocaleString()},
Federal Tax Bracket,${(inputs.federalBracket * 100).toFixed(0)}%,
State Tax Rate,${(inputs.stateRate * 100).toFixed(1)}%,
Monthly Rental Income,$${inputs.units.length > 0 ? inputs.units.filter(u => !u.ownerOccupied).reduce((s, u) => s + u.monthlyRent, 0).toLocaleString() : inputs.rentalIncome.toLocaleString()},${inputs.units.length > 0 ? inputs.units.filter(u => !u.ownerOccupied).length + ' rental units' : ''}
Vacancy Rate,${((inputs.vacancyRate || 0.05) * 100).toFixed(0)}%,
Annual Rental (net vacancy),$${annualRentalIncome.toFixed(0)},=MonthlyRent*12*(1-VacancyRate)

=== OWNER-OCCUPIED PORTION (${(ownerPortion * 100).toFixed(0)}%) ===
Item,Value,Formula/Notes

Owner Share,${(ownerPortion * 100).toFixed(1)}%,${inputs.units.length > 0 ? '1 of ' + inputs.units.length + ' units' : 'Based on sqft/unit split'}
Owner Interest,$${(year1Interest * ownerPortion).toFixed(0)},=Year1Interest*OwnerPct
Owner Property Tax,$${(annualPropertyTax * ownerPortion).toFixed(0)},=PropTax*OwnerPct
State Income Tax,$${(inputs.w2Income * inputs.stateRate).toFixed(0)},=W2*StateRate
SALT Deduction (capped $40k),$${saltDeduction.toFixed(0)},=MIN(OwnerPropTax+StateIncomeTax; 40000)
Mortgage Interest Deduction,$${mortgageInterestDeduction.toFixed(0)},Owner portion (under $750k limit)
Total Itemized,$${totalItemized.toFixed(0)},=MortgageInt+SALT
Standard Deduction,$${standardDeduction.toLocaleString()},2026 IRS (${inputs.filingStatus || 'single'})
Benefit Over Standard,$${Math.max(0, totalItemized - standardDeduction).toFixed(0)},=MAX(0; Itemized-Standard)
Owner Tax Savings,$${ownerTaxBenefit.toFixed(0)},=BenefitOverStandard*FedBracket

=== RENTAL PORTION (${(rentalPortion * 100).toFixed(0)}%) - SCHEDULE E ===
Item,Value,Formula/Notes

Rental Share,${(rentalPortion * 100).toFixed(1)}%,${inputs.units.length > 0 ? (inputs.units.length - 1) + ' of ' + inputs.units.length + ' units' : ''}
Rental Interest,$${(year1Interest * rentalPortion).toFixed(0)},=Year1Interest*RentalPct
Rental Property Tax,$${(annualPropertyTax * rentalPortion).toFixed(0)},=PropTax*RentalPct
Rental Insurance,$${(annualInsurance * rentalPortion).toFixed(0)},=Insurance*RentalPct
Rental Maintenance,$${(annualMaintenance * rentalPortion).toFixed(0)},=Maintenance*RentalPct
Building Value (80% of price),$${(inputs.homePrice * 0.8).toFixed(0)},Land is not depreciable
Rental Building Value,$${rentalBuildingValue.toFixed(0)},=BuildingValue*RentalPct

DEPRECIATION,,
Method,${costSeg.enabled ? 'Cost Segregation' : 'Standard 27.5 year'},
${costSeg.enabled ? 'Short-Life Assets (5/7/15yr)' : 'Annual Depreciation'},$${costSeg.enabled ? (rentalBuildingValue * costSeg.shortLifePercent).toFixed(0) : (rentalBuildingValue / 27.5).toFixed(0)},${costSeg.enabled ? '20% of rental building; 100% bonus depreciation Year 1' : '=RentalBuilding/27.5'}
${costSeg.enabled ? 'Long-Life Annual (27.5yr)' : ''}${costSeg.enabled ? ',$' + (rentalBuildingValue * (1 - costSeg.shortLifePercent) / 27.5).toFixed(0) : ''},${costSeg.enabled ? '=80%*RentalBuilding/27.5' : ''}
Year 1 Total Depreciation,$${year1Depreciation.toFixed(0)},

SCHEDULE E CALCULATION,,
Rental Income,$${annualRentalIncome.toFixed(0)},
Total Expenses,$${scheduleEExpensesCostSeg.toFixed(0)},=RentalInt+RentalTax+RentalIns+RentalMaint+Depreciation
Net Rental Income (Loss),($${passiveLossCostSeg.toFixed(0)}),=Income-Expenses (negative = loss)

PASSIVE LOSS RULES,,
Max Passive Loss Allowance,$25000,IRS limit
AGI Phaseout Start,$100000,Lose $1 for every $2 over
Your AGI,$${inputs.w2Income.toLocaleString()},
Phaseout Reduction,$${Math.max(0, (inputs.w2Income - 100000) / 2).toFixed(0)},=MAX(0; (AGI-100000)/2)
Your Allowance,$${passiveLossAllowance.toFixed(0)},=MIN(PassiveLoss; MAX(0; 25000-Phaseout))
Suspended Loss (carried forward),$${suspendedLossPerYear.toFixed(0)},=PassiveLoss-Allowance (releases at sale)
Rental Tax Savings,$${rentalTaxBenefit.toFixed(0)},=Allowance*FedBracket

${qbi.enabled ? `QBI DEDUCTION (Section 199A),,
Net Rental Income,$${Math.max(0, annualRentalIncome - scheduleEExpenses).toFixed(0)},Must be positive
QBI Deduction (20%),$${(Math.max(0, annualRentalIncome - scheduleEExpenses) * 0.20).toFixed(0)},=NetRentalIncome*20%
QBI Tax Savings,$${(Math.max(0, annualRentalIncome - scheduleEExpenses) * 0.20 * inputs.federalBracket).toFixed(0)},=QBI*FedBracket
` : ''}
=== YEAR 1 SUMMARY ===
Item,Value,Formula/Notes

Gross Annual Cost,$${totalAnnualCostBuy.toFixed(0)},=PI+Tax+Insurance+Maintenance+HOA+PMI
Rental Income Offset,-$${annualRentalIncome.toFixed(0)},
Tax Savings,-$${totalTaxBenefit.toFixed(0)},=OwnerTaxSavings+RentalTaxSavings
Net Annual Cost,$${netCostBuy.toFixed(0)},=Gross-Rental-TaxSavings
Net Monthly Cost,$${(netCostBuy / 12).toFixed(0)},=NetAnnual/12

Comparison to Renting,,
Your Current Rent,$${inputs.currentRent}/mo,
Annual Rent,$${(inputs.currentRent * 12).toFixed(0)},
Buying Costs More By,$${(netCostBuy - inputs.currentRent * 12).toFixed(0)}/yr,${netCostBuy > inputs.currentRent * 12 ? 'But you build equity' : 'Buying is cheaper!'}

=== EXIT ANALYSIS (Year ${years}) ===
Item,Value,Formula/Notes

Exit Strategy,${exitStrategy.toUpperCase()},${exitStrategy === 'sell' ? 'Pay all taxes' : exitStrategy === 'hold' ? 'Never sell (buy-borrow-die)' : exitStrategy === '1031' ? 'Defer taxes via exchange' : 'Move away; full rental'}

APPRECIATION,,
Annual Rate,${(appreciationRate * 100).toFixed(1)}%,Mean assumption
Future Home Value,$${futureHomeValue.toFixed(0)},=HomePrice*(1+Rate)^Years
Capital Gain,$${capitalGain.toFixed(0)},=FutureValue-HomePrice
Primary Residence Exemption,$${exitStrategy === 'remote' ? 0 : capGainsExemption.toLocaleString()},${exitStrategy === 'remote' ? 'Lost (not primary residence)' : '($250k single / $500k married)'}
Taxable Gain,$${taxableGain.toFixed(0)},=Gain-Exemption
Capital Gains Tax (15%),$${capitalGainsTax.toFixed(0)},${exitStrategy === 'hold' || exitStrategy === '1031' ? 'Deferred (exit strategy)' : '=TaxableGain*15%'}

DEPRECIATION RECAPTURE,,
Total Depreciation Taken,$${totalDepreciation.toFixed(0)},=${years} years of depreciation
Recapture Tax (25%),$${depreciationRecapture.toFixed(0)},${exitStrategy === 'hold' || exitStrategy === '1031' ? 'Deferred (exit strategy)' : '=TotalDepr*25%'}

SUSPENDED LOSSES,,
Annual Suspended,$${suspendedLossPerYear.toFixed(0)},Losses over passive allowance
Total Suspended (${years}yr),$${totalSuspendedLosses.toFixed(0)},Release at sale to offset gains
Tax Benefit at Sale,$${(totalSuspendedLosses * inputs.federalBracket).toFixed(0)},=Suspended*FedBracket

NET EXIT,,
Selling Costs (6%),$${sellingCosts.toFixed(0)},${exitStrategy === 'hold' ? 'None (not selling)' : '=FutureValue*6%'}
Cap Gains Tax,$${capitalGainsTax.toFixed(0)},
Depreciation Recapture,$${depreciationRecapture.toFixed(0)},
Suspended Loss Offset,-$${(totalSuspendedLosses * inputs.federalBracket).toFixed(0)},
Total Exit Taxes,$${(capitalGainsTax + depreciationRecapture - totalSuspendedLosses * inputs.federalBracket).toFixed(0)},

=== ASSUMPTIONS & SOURCES ===
Item,Value,Source

Standard Deduction (Single),$16100,IRS 2026
Standard Deduction (Married),$32200,IRS 2026
SALT Cap,$40000,OBBBA 2026
Mortgage Interest Limit,$750000,OBBBA 2026 (permanent)
Depreciation Period,27.5 years,IRS Pub 527
Building Value %,80%,IRS guideline (land not depreciable)
Passive Loss Max,$25000,IRS Pub 925
Passive Loss Phaseout,$100k-$150k AGI,IRS Pub 925
Capital Gains Rate,15%,LTCG for most brackets
Depreciation Recapture,25%,Section 1250
Primary Residence Exemption,$250k/$500k,Section 121
`
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `house-calc-${new Date().toISOString().split('T')[0]}.csv`
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
    add('close', inputs.closingMonth, d.closingMonth)
    
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
    
    // Exit Strategy
    if (inputs.exitStrategy && inputs.exitStrategy !== 'sell') {
      params.set('exit', inputs.exitStrategy)
    }
    
    // Tax Strategies
    if (inputs.taxStrategies?.costSegregation?.enabled) params.set('costseg', '1')
    if (inputs.taxStrategies?.qbi?.enabled) params.set('qbi', '1')
    // Note: 1031 is now part of exitStrategy, but keep for backwards compat
    if (inputs.taxStrategies?.exchange1031?.enabled) params.set('1031', '1')
    
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  
  return (
    <Section title="How The Math Works">
      <div className="flex gap-2">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex-1 text-left flex items-center justify-between p-4 bg-[var(--surface)] rounded-xl border border-[var(--border)] hover:border-[var(--border)] transition-colors"
        >
          <span className="text-[var(--content-muted)]">
            {isExpanded ? 'Click to collapse' : 'Click to see step-by-step calculations with your numbers'}
          </span>
          <span className={`transform transition-transform text-[var(--content-subtle)] ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
        </button>
        <button
          onClick={shareUrl}
          className={`px-4 py-2 ${copied ? 'bg-green-600' : 'bg-purple-600 hover:bg-purple-700'} text-[var(--content)] rounded-xl border ${copied ? 'border-green-500' : 'border-purple-500'} transition-colors flex items-center gap-2`}
          title="Copy shareable link"
        >
          <span>{copied ? '✓' : '🔗'}</span>
          <span className="hidden sm:inline">{copied ? 'Copied!' : 'Share'}</span>
        </button>
        <button
          onClick={exportMath}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-[var(--content)] rounded-xl border border-blue-500 transition-colors flex items-center gap-2"
          title="Export calculations as Markdown"
        >
          <span>MD</span>
          <span className="hidden sm:inline">MD</span>
        </button>
        <button
          onClick={exportCSV}
          className="px-4 py-2 bg-green-600 hover:bg-green-700 text-[var(--content)] rounded-xl border border-green-500 transition-colors flex items-center gap-2"
          title="Export as CSV with formulas for Google Sheets"
        >
          <span>CSV</span>
          <span className="hidden sm:inline">Sheets</span>
        </button>
      </div>
      
      {isExpanded && (
        <div className="mt-4 space-y-6 text-sm">
          
          {/* Step 1: Upfront Costs */}
          <div className="p-4 bg-blue-900/20 border border-blue-500/30 rounded-xl">
            <h4 className="text-blue-400 font-bold mb-3">Step 1: What You Pay Upfront</h4>
            <div className="space-y-2 text-[var(--content-muted)]">
              <div className="flex justify-between">
                <span>Home Price</span>
                <span className="font-mono">{formatCurrency(inputs.homePrice)}</span>
              </div>
              <div className="flex justify-between pl-4 text-[var(--content-subtle)]">
                <span>Down Payment ({inputs.downPaymentPercent}%)</span>
                <span className="font-mono">− {formatCurrency(downPayment)}</span>
              </div>
              <div className="flex justify-between border-t border-[var(--border)] pt-2">
                <span>Loan Amount</span>
                <span className="font-mono font-bold">{formatCurrency(loanAmount)}</span>
              </div>
              <div className="flex justify-between pt-2">
                <span>Closing Costs ({inputs.closingCostPercent}%)</span>
                <span className="font-mono">{formatCurrency(closingCosts)}</span>
              </div>
              <div className="flex justify-between border-t border-[var(--border)] pt-2 text-blue-400">
                <span className="font-bold">Total Cash Needed</span>
                <span className="font-mono font-bold">{formatCurrency(totalUpfront)}</span>
              </div>
            </div>
            <p className="mt-3 text-xs text-[var(--content-subtle)]">
              💡 This is the capital you need to buy. If renting, this money goes into the stock market instead.
            </p>
          </div>
          
          {/* Step 2: Monthly Mortgage */}
          <div className="p-4 bg-purple-900/20 border border-purple-500/30 rounded-xl">
            <h4 className="text-purple-400 font-bold mb-3">Step 2: Your Mortgage Payment</h4>
            <div className="space-y-2 text-[var(--content-muted)]">
              <div className="text-[var(--content-subtle)] text-xs mb-2">
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
              <div className="flex justify-between border-t border-[var(--border)] pt-2 text-purple-400">
                <span className="font-bold">Monthly P&I Payment</span>
                <span className="font-mono font-bold">{formatCurrency(monthlyPI)}/mo</span>
              </div>
              <div className="flex justify-between text-[var(--content-subtle)]">
                <span>Annual P&I</span>
                <span className="font-mono">{formatCurrency(annualPI)}/yr</span>
              </div>
            </div>
            <p className="mt-3 text-xs text-[var(--content-subtle)]">
              💡 In Year 1, ~{(0.85 * 100).toFixed(0)}% ({formatCurrency(year1Interest)}) goes to interest, only ~{(0.15 * 100).toFixed(0)}% ({formatCurrency(year1Principal)}) builds equity.
            </p>
          </div>
          
          {/* Step 3: Total Annual Costs */}
          <div className="p-4 bg-red-900/20 border border-red-500/30 rounded-xl">
            <h4 className="text-red-400 font-bold mb-3">Step 3: Total Cost of Owning (Year 1)</h4>
            <div className="space-y-2 text-[var(--content-muted)]">
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
              <div className="flex justify-between border-t border-[var(--border)] pt-2">
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
              
              <div className="flex justify-between border-t border-[var(--border)] pt-2 text-red-400">
                <span className="font-bold">Net Annual Cost (Buying)</span>
                <span className="font-mono font-bold">{formatCurrency(netCostBuy)}</span>
              </div>
              <div className="flex justify-between text-[var(--content-subtle)]">
                <span>Monthly</span>
                <span className="font-mono">{formatCurrency(netCostBuy / 12)}/mo</span>
              </div>
            </div>
          </div>
          
          {/* Step 4: Tax Math */}
          <div className="p-4 bg-yellow-900/20 border border-yellow-500/30 rounded-xl">
            <h4 className="text-yellow-400 font-bold mb-3">Step 4: Tax Deductions Explained</h4>
            <div className="space-y-2 text-[var(--content-muted)]">
              {hasRental && (
                <div className="text-[var(--content-subtle)] text-xs mb-2">
                  Owner portion: {(ownerPortion * 100).toFixed(0)}% | Rental portion: {(rentalPortion * 100).toFixed(0)}%
                </div>
              )}
              
              {/* Owner-Occupied Deductions */}
              <div className="text-[var(--content-subtle)] text-xs mt-2">Owner-Occupied (Schedule A):</div>
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
                <span className={`font-mono ${totalItemized > standardDeduction ? 'text-green-400' : 'text-[var(--content-subtle)]'}`}>
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
                  <div className="text-[var(--content-subtle)] text-xs mt-4">Rental (Schedule E):</div>
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
                        <div className="text-[var(--content-subtle)] text-xs pl-4">
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
              
              <div className="flex justify-between border-t border-[var(--border)] pt-2 text-yellow-400">
                <span className="font-bold">TOTAL TAX SAVINGS</span>
                <span className="font-mono font-bold">{formatCurrency(totalTaxBenefit)}/yr</span>
              </div>
            </div>
            <p className="mt-3 text-xs text-[var(--content-subtle)]">
              💡 Passive losses above income can offset up to $25k of W2 income if AGI &lt; $100k (phases out $100-150k).
            </p>
          </div>
          
          {/* Step 5: Rent Comparison */}
          <div className="p-4 bg-emerald-900/20 border border-emerald-500/30 rounded-xl">
            <h4 className="text-emerald-400 font-bold mb-3">Step 5: Rent + Invest Alternative</h4>
            <div className="space-y-2 text-[var(--content-muted)]">
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
              <div className="flex justify-between border-t border-[var(--border)] pt-2">
                <span>Buy costs {netCostBuy > annualRent ? 'more' : 'less'} by</span>
                <span className={`font-mono ${netCostBuy > annualRent ? 'text-red-400' : 'text-green-400'}`}>
                  {formatCurrency(Math.abs(netCostBuy - annualRent))}/yr
                </span>
              </div>
              <div className="flex justify-between text-[var(--content-subtle)]">
                <span>Monthly difference</span>
                <span className="font-mono">{formatCurrency(Math.abs(monthlySavings))}/mo</span>
              </div>
            </div>
            <p className="mt-3 text-xs text-[var(--content-subtle)]">
              💡 If renting is cheaper, you invest the {formatCurrency(totalUpfront)} down payment PLUS {formatCurrency(Math.abs(monthlySavings))}/mo savings into stocks.
              {netCostBuy < annualRent && ` If buying is cheaper, YOU invest the ${formatCurrency(Math.abs(monthlySavings))}/mo savings.`}
            </p>
          </div>
          
          {/* Step 6: Distributions */}
          <div className="p-4 bg-cyan-900/20 border border-cyan-500/30 rounded-xl">
            <h4 className="text-cyan-400 font-bold mb-3">Step 6: Return Distributions</h4>
            <div className="space-y-3 text-[var(--content-muted)]">
              <p>
                We run <span className="text-cyan-400 font-bold">{inputs.numSimulations.toLocaleString()}</span> simulations. 
                In each one, we randomly sample:
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-[var(--surface)] rounded-lg">
                  <div className="text-[var(--content-subtle)] text-xs mb-1">Home Appreciation</div>
                  <div className="font-mono">
                    μ = {(inputs.appreciationMean * 100).toFixed(1)}%/yr
                    <br />
                    σ = {(inputs.appreciationStdDev * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-[var(--content-subtle)] mt-1">
                    Range: roughly {((inputs.appreciationMean - 2*inputs.appreciationStdDev) * 100).toFixed(0)}% to +{((inputs.appreciationMean + 2*inputs.appreciationStdDev) * 100).toFixed(0)}%
                  </div>
                </div>
                <div className="p-3 bg-[var(--surface)] rounded-lg">
                  <div className="text-[var(--content-subtle)] text-xs mb-1">Stock Returns</div>
                  <div className="font-mono">
                    μ = {(inputs.stockReturnMean * 100).toFixed(1)}%/yr
                    <br />
                    σ = {(inputs.stockReturnStdDev * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-[var(--content-subtle)] mt-1">
                    Range: roughly {((inputs.stockReturnMean - 2*inputs.stockReturnStdDev) * 100).toFixed(0)}% to +{((inputs.stockReturnMean + 2*inputs.stockReturnStdDev) * 100).toFixed(0)}%
                  </div>
                </div>
              </div>
              <p className="text-[var(--content-subtle)] text-xs">
                Each year, we draw random returns from normal distributions and compound them. 
                After {inputs.years} years, we compare: <span className="text-blue-400">Home Equity</span> vs <span className="text-green-400">Stock Portfolio</span>.
              </p>
            </div>
          </div>
          
          {/* Step 7: Final Comparison */}
          <div className="p-4 bg-gradient-to-br from-green-900/30 to-blue-900/30 border border-[var(--border)] rounded-xl">
            <h4 className="text-[var(--content)] font-bold mb-3">Step 7: Final Wealth Comparison (Year {inputs.years})</h4>
            <div className="text-xs text-[var(--content-subtle)] mb-3">
              Exit strategy: <span className="text-[var(--content-muted)] font-medium">
                {inputs.exitStrategy === 'hold' && 'Hold Forever (paper equity, no taxes)'}
                {inputs.exitStrategy === '1031' && '1031 Exchange (defer all taxes)'}
                {inputs.exitStrategy === 'remote' && 'Remote Landlord (100% rental, PM fees)'}
                {(!inputs.exitStrategy || inputs.exitStrategy === 'sell') && 'Sell (pay all taxes)'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <div className="text-blue-400 font-bold mb-2">If You Buy</div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[var(--content-subtle)]">Wealth (P50)</span>
                    <span className="font-mono">{formatCurrency(finalYear?.wealthBuy.p50 || 0)}</span>
                  </div>
                  <div className="text-xs text-[var(--content-subtle)] pl-2">
                    {inputs.exitStrategy === 'hold' && '(paper equity, no selling costs or taxes)'}
                    {inputs.exitStrategy === '1031' && '(after selling costs, taxes deferred)'}
                    {inputs.exitStrategy === 'remote' && '(after selling costs + full taxes)'}
                    {(!inputs.exitStrategy || inputs.exitStrategy === 'sell') && '(after selling costs, mortgage, taxes)'}
                  </div>
                </div>
              </div>
              <div>
                <div className="text-green-400 font-bold mb-2">If You Rent + Invest</div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[var(--content-subtle)]">Portfolio Value (P50)</span>
                    <span className="font-mono">{formatCurrency(finalYear?.wealthRent.p50 || 0)}</span>
                  </div>
                  <div className="text-xs text-[var(--content-subtle)] pl-2">
                    (down payment + monthly savings, compounded)
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-[var(--border)] text-center">
              <div className="text-[var(--content-subtle)] mb-1">Median Outcome (P50)</div>
              <div className={`text-2xl font-bold ${(finalYear?.delta.p50 || 0) > 0 ? 'text-green-400' : 'text-red-400'}`}>
                {(finalYear?.delta.p50 || 0) > 0 ? 'Buying wins by ' : 'Renting wins by '}
                {formatCurrency(Math.abs(finalYear?.delta.p50 || 0))}
              </div>
              <div className="text-[var(--content-subtle)] text-sm mt-1">
                Buy wins in {(simResults.finalStats.buyWinsProbability * 100).toFixed(0)}% of {inputs.numSimulations.toLocaleString()} simulations
              </div>
            </div>
          </div>
          
          {/* Disclaimer */}
          <div className="p-4 bg-[var(--surface)] border border-[var(--border)] rounded-xl text-xs text-[var(--content-subtle)]">
            <strong className="text-[var(--content-subtle)]">Important Caveats:</strong>
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

// Interactive Histogram Component for Monte Carlo Results
interface HistogramBin {
  rangeMin: number
  rangeMax: number
  count: number
  percentage: number
  cumulativePercentile: number  // What percentile this bin ends at
  runs: { id: number; delta: number; wealthBuy: number; wealthRent: number }[]
}

interface DeltaHistogramProps {
  runs: SimulationRun[]
  finalStats: {
    delta: { p10: number; p25: number; p50: number; p75: number; p90: number; mean: number }
    buyWinsProbability: number
  }
  numSimulations: number
  formatCurrency: (n: number) => string
}

function DeltaHistogram({ runs, finalStats, numSimulations, formatCurrency }: DeltaHistogramProps) {
  const [hoveredBin, setHoveredBin] = useState<HistogramBin | null>(null)
  const [selectedBin, setSelectedBin] = useState<HistogramBin | null>(null)
  const [animationComplete, setAnimationComplete] = useState(false)
  
  // Calculate histogram bins from runs
  const histogramData = useMemo(() => {
    const deltas = runs.map(r => r.finalDelta)
    const min = Math.min(...deltas)
    const max = Math.max(...deltas)
    
    // Use ~20-30 bins for good granularity
    const numBins = Math.min(30, Math.max(15, Math.ceil(Math.sqrt(runs.length))))
    const binWidth = (max - min) / numBins
    
    // Create bins
    const bins: HistogramBin[] = []
    let cumulative = 0
    
    for (let i = 0; i < numBins; i++) {
      const rangeMin = min + i * binWidth
      const rangeMax = min + (i + 1) * binWidth
      
      const runsInBin = runs.filter(r => {
        if (i === numBins - 1) {
          // Last bin includes the max value
          return r.finalDelta >= rangeMin && r.finalDelta <= rangeMax
        }
        return r.finalDelta >= rangeMin && r.finalDelta < rangeMax
      })
      
      const count = runsInBin.length
      const percentage = (count / runs.length) * 100
      cumulative += count
      
      bins.push({
        rangeMin,
        rangeMax,
        count,
        percentage,
        cumulativePercentile: (cumulative / runs.length) * 100,
        runs: runsInBin.slice(0, 10).map(r => ({
          id: r.id,
          delta: r.finalDelta,
          wealthBuy: r.finalWealthBuy,
          wealthRent: r.finalWealthRent,
        })),
      })
    }
    
    return { bins, min, max, maxCount: Math.max(...bins.map(b => b.count)) }
  }, [runs])
  
  // Trigger animation on mount
  useEffect(() => {
    const timer = setTimeout(() => setAnimationComplete(true), 50)
    return () => clearTimeout(timer)
  }, [runs])
  
  // Reset animation when runs change
  useEffect(() => {
    setAnimationComplete(false)
    const timer = setTimeout(() => setAnimationComplete(true), 50)
    return () => clearTimeout(timer)
  }, [runs])
  
  // Calculate percentile for a given value
  const getPercentile = (value: number) => {
    const count = runs.filter(r => r.finalDelta <= value).length
    return (count / runs.length) * 100
  }
  
  return (
    <div className="space-y-4">
      {/* Histogram Chart */}
      <div className="relative">
        {/* Y-axis label */}
        <div className="absolute -left-2 top-1/2 -translate-y-1/2 -rotate-90 text-[var(--content-subtle)] text-xs whitespace-nowrap">
          Simulations
        </div>
        
        {/* Chart area */}
        <div className="ml-8 h-48 md:h-64 flex items-end gap-[1px] md:gap-0.5">
          {histogramData.bins.map((bin, idx) => {
            const heightPercent = (bin.count / histogramData.maxCount) * 100
            const isNegative = bin.rangeMax < 0
            const isPositive = bin.rangeMin >= 0
            const isZeroCrossing = bin.rangeMin < 0 && bin.rangeMax >= 0
            
            // Color based on delta value
            let bgColor = 'bg-blue-500'
            if (isNegative) bgColor = 'bg-red-500'
            else if (isPositive) bgColor = 'bg-green-500'
            else if (isZeroCrossing) bgColor = 'bg-gradient-to-t from-red-500 to-green-500'
            
            const isHovered = hoveredBin === bin
            const isSelected = selectedBin === bin
            
            return (
              <div
                key={idx}
                className={`flex-1 relative cursor-pointer transition-all duration-300 ease-out
                           ${isHovered || isSelected ? 'opacity-100 scale-y-105' : 'opacity-80 hover:opacity-95'}
                           ${isSelected ? 'ring-2 ring-[var(--border)]' : ''}`}
                style={{ 
                  height: animationComplete ? `${heightPercent}%` : '0%',
                  transitionDelay: `${idx * 15}ms`,
                }}
                onMouseEnter={() => setHoveredBin(bin)}
                onMouseLeave={() => setHoveredBin(null)}
                onClick={() => setSelectedBin(selectedBin === bin ? null : bin)}
              >
                <div className={`absolute inset-0 ${bgColor} rounded-t-sm`} />
                
                {/* Percentile markers on specific bins */}
                {idx > 0 && histogramData.bins[idx - 1].cumulativePercentile < 10 && bin.cumulativePercentile >= 10 && (
                  <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] text-[var(--content-subtle)] whitespace-nowrap">P10</div>
                )}
                {idx > 0 && histogramData.bins[idx - 1].cumulativePercentile < 50 && bin.cumulativePercentile >= 50 && (
                  <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] text-yellow-400 font-bold whitespace-nowrap">P50</div>
                )}
                {idx > 0 && histogramData.bins[idx - 1].cumulativePercentile < 90 && bin.cumulativePercentile >= 90 && (
                  <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] text-[var(--content-subtle)] whitespace-nowrap">P90</div>
                )}
              </div>
            )
          })}
        </div>
        
        {/* X-axis */}
        <div className="ml-8 flex justify-between mt-2 text-xs text-[var(--content-subtle)]">
          <span>{formatCurrency(histogramData.min)}</span>
          <span className="text-[var(--content-subtle)]">← Rent wins | Buy wins →</span>
          <span>{formatCurrency(histogramData.max)}</span>
        </div>
        
        {/* Zero line indicator */}
        {histogramData.min < 0 && histogramData.max > 0 && (
          <div 
            className="absolute bottom-8 w-0.5 h-48 md:h-64 bg-[var(--surface-muted)]"
            style={{ 
              left: `calc(2rem + ${((0 - histogramData.min) / (histogramData.max - histogramData.min)) * 100}% - 1px)` 
            }}
          >
            <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] text-[var(--content-muted)] whitespace-nowrap">$0</span>
          </div>
        )}
      </div>
      
      {/* Hover tooltip */}
      {hoveredBin && !selectedBin && (
        <div className="p-3 bg-[var(--surface)] border border-[var(--border)] rounded-lg animate-in fade-in duration-150">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <div>
              <span className="text-[var(--content-subtle)]">Range:</span>
              <span className="text-[var(--content)] ml-1 font-mono">{formatCurrency(hoveredBin.rangeMin)} to {formatCurrency(hoveredBin.rangeMax)}</span>
            </div>
            <div>
              <span className="text-[var(--content-subtle)]">Count:</span>
              <span className="text-[var(--content)] ml-1 font-mono">{hoveredBin.count.toLocaleString()} ({hoveredBin.percentage.toFixed(1)}%)</span>
            </div>
            <div>
              <span className="text-[var(--content-subtle)]">Percentile:</span>
              <span className="text-[var(--content)] ml-1 font-mono">P{Math.round(hoveredBin.cumulativePercentile - hoveredBin.percentage / 2)} – P{Math.round(hoveredBin.cumulativePercentile)}</span>
            </div>
          </div>
        </div>
      )}
      
      {/* Selected bin detail panel */}
      {selectedBin && (
        <div className="p-4 bg-[var(--surface)] border border-[var(--border)] rounded-xl animate-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-[var(--content)] font-medium">
              Bin Details: {formatCurrency(selectedBin.rangeMin)} to {formatCurrency(selectedBin.rangeMax)}
            </h4>
            <button 
              onClick={() => setSelectedBin(null)}
              className="text-[var(--content-subtle)] hover:text-[var(--content-muted)] transition-colors"
            >
              ✕
            </button>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="bg-[var(--surface)] rounded-lg p-2">
              <div className="text-[var(--content-subtle)] text-xs">Simulations</div>
              <div className="text-[var(--content)] font-mono text-lg">{selectedBin.count.toLocaleString()}</div>
              <div className="text-[var(--content-subtle)] text-xs">{selectedBin.percentage.toFixed(2)}% of total</div>
            </div>
            <div className="bg-[var(--surface)] rounded-lg p-2">
              <div className="text-[var(--content-subtle)] text-xs">Percentile Range</div>
              <div className="text-[var(--content)] font-mono text-lg">P{Math.round(selectedBin.cumulativePercentile - selectedBin.percentage)} – P{Math.round(selectedBin.cumulativePercentile)}</div>
            </div>
            <div className="bg-[var(--surface)] rounded-lg p-2">
              <div className="text-[var(--content-subtle)] text-xs">Avg Delta</div>
              <div className={`font-mono text-lg ${(selectedBin.rangeMin + selectedBin.rangeMax) / 2 > 0 ? 'text-green-400' : 'text-red-400'}`}>
                {formatCurrency((selectedBin.rangeMin + selectedBin.rangeMax) / 2)}
              </div>
            </div>
            <div className="bg-[var(--surface)] rounded-lg p-2">
              <div className="text-[var(--content-subtle)] text-xs">Outcome</div>
              <div className={`font-medium ${selectedBin.rangeMax < 0 ? 'text-red-400' : selectedBin.rangeMin > 0 ? 'text-green-400' : 'text-yellow-400'}`}>
                {selectedBin.rangeMax < 0 ? 'Rent wins' : selectedBin.rangeMin > 0 ? 'Buy wins' : 'Mixed'}
              </div>
            </div>
          </div>
          
          {/* Sample runs from this bin */}
          <div className="text-[var(--content-subtle)] text-xs mb-2">Sample Simulations (up to 10)</div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {selectedBin.runs.map((run, i) => (
              <div key={i} className="flex items-center gap-4 text-xs bg-[var(--surface)] rounded px-2 py-1">
                <span className="text-[var(--content-subtle)] w-8">#{run.id}</span>
                <span className="text-green-400/80">Buy: {formatCurrency(run.wealthBuy)}</span>
                <span className="text-red-400/80">Rent: {formatCurrency(run.wealthRent)}</span>
                <span className={`ml-auto font-mono ${run.delta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  Δ {formatCurrency(run.delta)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Legend / Key Stats */}
      <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-[var(--content-subtle)]">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 bg-red-500 rounded-sm" />
          <span>Rent wins ({((1 - finalStats.buyWinsProbability) * 100).toFixed(0)}%)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 bg-green-500 rounded-sm" />
          <span>Buy wins ({(finalStats.buyWinsProbability * 100).toFixed(0)}%)</span>
        </div>
        <div className="text-[var(--content-subtle)]">|</div>
        <span>Hover for percentile • Click for details</span>
      </div>
    </div>
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
  const [whatIfResults, setWhatIfResults] = useState<WhatIfResult | null>(null)
  const [isRunningSensitivity, setIsRunningSensitivity] = useState(false)
  const [isRunningBreakEven, setIsRunningBreakEven] = useState(false)
  const [isRunningWhatIf, setIsRunningWhatIf] = useState(false)
  
  // Collapsible state (must be before URL parsing useEffect)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showStrategies, setShowStrategies] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)
  
  // Parse URL params - comprehensive list of all SimulationParams fields
  useEffect(() => {
    const p = (key: string) => searchParams.get(key)
    const pNum = (key: string) => p(key) ? parseFloat(p(key)!) : null
    const pInt = (key: string) => p(key) ? parseInt(p(key)!, 10) : null
    const pBool = (key: string) => p(key) === '1' || p(key) === 'true'
    const pPct = (key: string) => pNum(key) !== null ? pNum(key)! / 100 : null  // Convert percentage to decimal
    
    // Auto-open collapsed sections BEFORE early return (even if no params change inputs)
    const hasAdvancedParams = p('hoa') || p('maint') || p('income') || p('fedbracket') || p('appr') || p('stock')
    const hasStrategyParams = p('fthb') || p('heloc')
    if (hasAdvancedParams) setShowAdvanced(true)
    if (hasStrategyParams) setShowStrategies(true)
    
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
      if (pInt('close') !== null) updates.closingMonth = pInt('close')!
      
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
      
      // Exit Strategy
      const exitParam = p('exit')
      if (exitParam && ['sell', 'hold', '1031', 'remote'].includes(exitParam)) {
        updates.exitStrategy = exitParam as 'sell' | 'hold' | '1031' | 'remote'
      }
      
      // Tax Strategies
      if (pBool('costseg') || pBool('qbi') || pBool('1031')) {
        updates.taxStrategies = {
          costSegregation: {
            enabled: pBool('costseg'),
            shortLifePercent: 0.20,
            year1BonusDepreciation: 1.0,
          },
          qbi: {
            enabled: pBool('qbi'),
            qualifiesAsBusiness: pBool('qbi'),
          },
          exchange1031: {
            enabled: pBool('1031'),
          },
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
        
        // Multi-family defaults (unless explicitly set in URL)
        if (pNum('hoa') === null) updates.hoaMonthly = 0
        // Scale insurance/maintenance by price (roughly 0.5% of value for insurance, 1% for maintenance)
        const basePrice = pNum('price') || 1000000
        if (pNum('insurance') === null) updates.insuranceAnnual = Math.round(basePrice * 0.005)  // ~$6k for $1.2M
        if (pNum('maint') === null) updates.maintenanceAnnual = Math.round(basePrice * 0.01)     // ~$12k for $1.2M
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
  
  // Share URL generation (used by keyboard shortcuts and share button)
  const shareUrl = useCallback(() => {
    const params = new URLSearchParams()
    const d = defaultParams
    
    const add = (key: string, val: number | string, def?: number | string) => {
      if (def === undefined || val !== def) params.set(key, val.toString())
    }
    const addPct = (key: string, val: number, def?: number) => {
      if (def === undefined || val !== def) params.set(key, (val * 100).toString())
    }
    
    // Core params (always include)
    params.set('price', inputs.homePrice.toString())
    params.set('down', inputs.downPaymentPercent.toString())
    addPct('rate', inputs.mortgageRate, d.mortgageRate)
    addPct('tax', inputs.propertyTaxRate, d.propertyTaxRate)
    add('insurance', inputs.insuranceAnnual, d.insuranceAnnual)
    add('closing', inputs.closingCostPercent, d.closingCostPercent)
    add('hoa', inputs.hoaMonthly, d.hoaMonthly)
    add('maint', inputs.maintenanceAnnual, d.maintenanceAnnual)
    if (inputs.houseHack) params.set('househack', '1')
    if (inputs.rentalIncome > 0) add('rental', inputs.rentalIncome, 0)
    add('income', inputs.w2Income, d.w2Income)
    addPct('fedbracket', inputs.federalBracket, d.federalBracket)
    addPct('staterate', inputs.stateRate, d.stateRate)
    params.set('rent', inputs.currentRent.toString())
    addPct('rentgrowth', inputs.rentGrowth, d.rentGrowth)
    addPct('appr', inputs.appreciationMean, d.appreciationMean)
    addPct('stock', inputs.stockReturnMean, d.stockReturnMean)
    params.set('years', inputs.years.toString())
    
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
    }
    
    // Exit Strategy
    if (inputs.exitStrategy && inputs.exitStrategy !== 'sell') {
      params.set('exit', inputs.exitStrategy)
    }
    
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`
    navigator.clipboard.writeText(url)
    setShareCopied(true)
    setTimeout(() => setShareCopied(false), 2000)
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
  
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null)
  
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})
  
  const InputField = ({ label, value, onChange, suffix = '', hint = '', prefix = '', tooltip = '', min, max }: {
    label: string
    value: number | string
    onChange: (v: number) => void
    suffix?: string
    hint?: string
    prefix?: string
    tooltip?: string
    min?: number
    max?: number
  }) => {
    const error = validationErrors[label]
    
    const validateAndSet = (input: HTMLInputElement, val: string) => {
      const parsed = parseFloat(val)
      if (isNaN(parsed)) {
        input.value = String(value)
        setValidationErrors(prev => ({ ...prev, [label]: '' }))
        return
      }
      
      // Check bounds
      if (min !== undefined && parsed < min) {
        setValidationErrors(prev => ({ ...prev, [label]: `Min: ${min}` }))
        onChange(min)
        input.value = String(min)
        setTimeout(() => setValidationErrors(prev => ({ ...prev, [label]: '' })), 2000)
        return
      }
      if (max !== undefined && parsed > max) {
        setValidationErrors(prev => ({ ...prev, [label]: `Max: ${max}` }))
        onChange(max)
        input.value = String(max)
        setTimeout(() => setValidationErrors(prev => ({ ...prev, [label]: '' })), 2000)
        return
      }
      
      setValidationErrors(prev => ({ ...prev, [label]: '' }))
      onChange(parsed)
    }
    
    return (
      <div className="mb-4 relative">
        <label className="block text-sm font-medium text-[var(--content-muted)] mb-1.5">
          {label}
          {hint && <span className="text-[var(--content-subtle)] font-normal ml-1">({hint})</span>}
          {tooltip && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                setActiveTooltip(activeTooltip === label ? null : label)
              }}
              className="ml-1 text-[var(--content-subtle)] hover:text-[var(--content-muted)] transition-colors"
              aria-label={`Show info for ${label}`}
            >
              <span className="icon-info" aria-hidden="true">i</span>
            </button>
          )}
        </label>
        {tooltip && activeTooltip === label && (
          <div className="themed-tooltip absolute z-10 top-6 left-0 right-0 p-2 border rounded-lg text-xs shadow-lg">
            {tooltip}
          </div>
        )}
        <div className="relative">
          {prefix && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--content-subtle)]">{prefix}</span>
          )}
          <input
            type="text"
            inputMode="decimal"
            key={value}
            defaultValue={value}
            onBlur={(e) => validateAndSet(e.target, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                validateAndSet(e.target as HTMLInputElement, (e.target as HTMLInputElement).value)
                ;(e.target as HTMLInputElement).blur()
              }
            }}
            className={`themed-input w-full border rounded-lg px-4 py-2.5 text-base font-mono
                       focus:ring-1 focus:outline-none transition-colors
                       ${error ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : 'focus:border-[var(--accent)] focus:ring-[var(--accent)]'}
                       ${prefix ? 'pl-8' : ''} ${suffix ? 'pr-12' : ''}`}
          />
          {suffix && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--content-subtle)] font-medium">{suffix}</span>
          )}
        </div>
        {error && (
          <div className="absolute -bottom-5 left-0 text-xs text-red-400 animate-pulse">
            {error}
          </div>
        )}
      </div>
    )
  }
  
  const Stat = ({ label, value, sub = '', color = 'white', delay = 0 }: {
    label: string
    value: string
    sub?: string
    color?: 'white' | 'green' | 'red' | 'blue'
    delay?: number
  }) => (
    <div 
      className="bg-[var(--surface)] rounded-lg p-3 md:p-4 border border-[var(--border)] min-w-0 
                 transition-all duration-300 hover:bg-[var(--surface-muted)] hover:border-[var(--border)]
                 animate-in fade-in slide-in-from-bottom-2"
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'backwards' }}
    >
      <div className="text-[var(--content-subtle)] text-[10px] sm:text-xs md:text-sm mb-1 truncate leading-tight">{label}</div>
      <div className={`text-base sm:text-lg md:text-2xl font-bold font-mono truncate transition-colors ${color === 'green' ? 'text-green-400' : color === 'red' ? 'text-red-400' : color === 'blue' ? 'text-blue-400' : 'text-[var(--content)]'}`}>
        {value}
      </div>
      {sub && <div className="text-[var(--content-subtle)] text-[10px] sm:text-xs mt-1">{sub}</div>}
    </div>
  )

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
        data-section="hero"
        className="bg-gradient-to-br from-[var(--surface-muted)] to-transparent border border-[var(--border)] rounded-xl sm:rounded-2xl p-4 sm:p-6 mb-4 sm:mb-6"
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 mb-4 sm:mb-6">
          {/* Price */}
          <div className="relative">
            <label className="flex items-center gap-1 text-xs text-[var(--content-muted)] mb-1">
              Price
              <button type="button" onClick={() => setActiveTooltip(activeTooltip === 'price' ? null : 'price')} className="text-[var(--content-subtle)] hover:text-[var(--content-muted)] transition-colors" aria-label="Show info for Price"><span className="icon-info" aria-hidden="true">i</span></button>
            </label>
            {activeTooltip === 'price' && <div className="themed-tooltip absolute z-10 top-5 left-0 right-0 p-2 border rounded-lg text-xs shadow-lg">Purchase price of the property</div>}
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--content-subtle)]">$</span>
              <input
                type="text"
                key={inputs.homePrice}
                defaultValue={inputs.homePrice}
                onBlur={(e) => {
                  const v = parseFloat(e.target.value.replace(/,/g, ''))
                  if (!isNaN(v)) {
                    const clamped = Math.max(10000, Math.min(50000000, v))
                    update('homePrice', clamped)
                    if (clamped !== v) e.target.value = String(clamped)
                  }
                }}
                className={`themed-input w-full pl-7 pr-3 py-2 sm:py-3 border rounded-xl text-base sm:text-lg font-mono focus:outline-none ${validationErrors['price'] ? 'border-red-500 focus:border-red-500' : 'focus:border-[var(--accent)]'}`}
              />
            </div>
            {validationErrors['price'] && <div className="absolute -bottom-4 left-0 text-xs text-red-400">{validationErrors['price']}</div>}
          </div>
          
          {/* Down Payment */}
          <div className="relative">
            <label className="flex items-center gap-1 text-xs text-[var(--content-muted)] mb-1">
              Down
              <button type="button" onClick={() => setActiveTooltip(activeTooltip === 'down' ? null : 'down')} className="text-[var(--content-subtle)] hover:text-[var(--content-muted)] transition-colors" aria-label="Show info for Down"><span className="icon-info" aria-hidden="true">i</span></button>
            </label>
            {activeTooltip === 'down' && <div className="themed-tooltip absolute z-10 top-5 left-0 right-0 p-2 border rounded-lg text-xs shadow-lg">Down payment %. FTHB programs allow 3-5%.</div>}
            <div className="relative">
              <input
                type="text"
                key={inputs.downPaymentPercent}
                defaultValue={inputs.downPaymentPercent}
                onBlur={(e) => {
                  const v = parseFloat(e.target.value)
                  if (!isNaN(v)) {
                    const clamped = Math.max(0, Math.min(100, v))
                    update('downPaymentPercent', clamped)
                    if (clamped !== v) e.target.value = String(clamped)
                  }
                }}
                className="themed-input w-full pl-3 pr-8 py-2 sm:py-3 border rounded-xl text-base sm:text-lg font-mono focus:outline-none"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--content-subtle)]">%</span>
            </div>
          </div>
          
          {/* Rate */}
          <div className="relative">
            <label className="flex items-center gap-1 text-xs text-[var(--content-muted)] mb-1">
              Rate
              <button type="button" onClick={() => setActiveTooltip(activeTooltip === 'rate' ? null : 'rate')} className="text-[var(--content-subtle)] hover:text-[var(--content-muted)] transition-colors" aria-label="Show info for Rate"><span className="icon-info" aria-hidden="true">i</span></button>
            </label>
            {activeTooltip === 'rate' && <div className="themed-tooltip absolute z-10 top-5 left-0 right-0 p-2 border rounded-lg text-xs shadow-lg">Mortgage interest rate (30-year fixed)</div>}
            <div className="relative">
              <input
                type="text"
                key={inputs.mortgageRate}
                defaultValue={(inputs.mortgageRate * 100).toFixed(2)}
                onBlur={(e) => {
                  const v = parseFloat(e.target.value)
                  if (!isNaN(v)) {
                    const clamped = Math.max(0, Math.min(25, v))
                    update('mortgageRate', clamped / 100)
                    if (clamped !== v) e.target.value = clamped.toFixed(2)
                  }
                }}
                className="themed-input w-full pl-3 pr-8 py-2 sm:py-3 border rounded-xl text-base sm:text-lg font-mono focus:outline-none"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--content-subtle)]">%</span>
            </div>
          </div>
          
          {/* Your Rent */}
          <div className="relative">
            <label className="flex items-center gap-1 text-xs text-[var(--content-muted)] mb-1">
              Your Rent
              <button type="button" onClick={() => setActiveTooltip(activeTooltip === 'rent' ? null : 'rent')} className="text-[var(--content-subtle)] hover:text-[var(--content-muted)] transition-colors" aria-label="Show info for Your Rent"><span className="icon-info" aria-hidden="true">i</span></button>
            </label>
            {activeTooltip === 'rent' && <div className="themed-tooltip absolute z-10 top-5 left-0 right-0 p-2 border rounded-lg text-xs shadow-lg">What you currently pay. Used to calculate opportunity cost.</div>}
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--content-subtle)]">$</span>
              <input
                type="text"
                key={inputs.currentRent}
                defaultValue={inputs.currentRent}
                onBlur={(e) => {
                  const v = parseFloat(e.target.value.replace(/,/g, ''))
                  if (!isNaN(v)) {
                    const clamped = Math.max(0, Math.min(50000, v))
                    update('currentRent', clamped)
                    if (clamped !== v) e.target.value = String(clamped)
                  }
                }}
                className="themed-input w-full pl-7 pr-3 py-2 sm:py-3 border rounded-xl text-base sm:text-lg font-mono focus:outline-none"
              />
            </div>
          </div>
          
          {/* Years */}
          <div className="relative">
            <label className="flex items-center gap-1 text-xs text-[var(--content-muted)] mb-1">
              Years
              <button type="button" onClick={() => setActiveTooltip(activeTooltip === 'years' ? null : 'years')} className="text-[var(--content-subtle)] hover:text-[var(--content-muted)] transition-colors" aria-label="Show info for Years"><span className="icon-info" aria-hidden="true">i</span></button>
            </label>
            {activeTooltip === 'years' && <div className="themed-tooltip absolute z-10 top-5 left-0 right-0 p-2 border rounded-lg text-xs shadow-lg">How long you plan to hold. Longer = more likely buying wins.</div>}
            <div className="relative">
              <input
                type="text"
                key={inputs.years}
                defaultValue={inputs.years}
                onBlur={(e) => {
                  const v = parseInt(e.target.value)
                  if (!isNaN(v)) {
                    const clamped = Math.max(1, Math.min(50, v))
                    update('years', clamped)
                    if (clamped !== v) e.target.value = String(clamped)
                  }
                }}
                className="themed-input w-full pl-3 pr-8 py-2 sm:py-3 border rounded-xl text-base sm:text-lg font-mono focus:outline-none"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--content-subtle)]">yr</span>
            </div>
          </div>
          
          {/* Closing Month */}
          <div className="relative">
            <label className="flex items-center gap-1 text-xs text-[var(--content-muted)] mb-1">
              Close
              <button type="button" onClick={() => setActiveTooltip(activeTooltip === 'close' ? null : 'close')} className="text-[var(--content-subtle)] hover:text-[var(--content-muted)] transition-colors" aria-label="Show info for Close"><span className="icon-info" aria-hidden="true">i</span></button>
            </label>
            {activeTooltip === 'close' && <div className="themed-tooltip absolute z-10 top-5 left-0 right-0 p-2 border rounded-lg text-xs shadow-lg">Month you close. Year 1 is prorated.</div>}
            <select
              value={inputs.closingMonth || 1}
              onChange={(e) => update('closingMonth', parseInt(e.target.value))}
              className="themed-input w-full px-3 py-2 sm:py-3 border rounded-xl text-base sm:text-lg focus:outline-none"
            >
              {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
        </div>
        
        {/* Rental Strategy Quick Toggle */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-4 mb-4 sm:mb-6">
          <span className="text-[var(--content-subtle)] text-xs sm:text-sm">Rental:</span>
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
                    ? 'bg-[#84BABF] text-[var(--content)] shadow-lg shadow-[#84BABF]/20'
                    : 'bg-[var(--surface)] text-[var(--content-subtle)] hover:bg-[var(--surface-muted)] hover:text-[var(--content-muted)]'
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
              <span className="text-[var(--content-subtle)]">income</span>
            </div>
          )}
        </div>
        
        {/* Room Rental Input */}
        {inputs.units.length === 0 && inputs.houseHack && (
          <div className="flex items-center gap-4 p-3 bg-[var(--surface)] rounded-lg mb-4">
            <span className="text-[var(--content-subtle)] text-sm">Rental income:</span>
            <div className="relative w-32">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--content-subtle)] text-sm">$</span>
              <input
                type="text"
                key={inputs.rentalIncome}
                defaultValue={inputs.rentalIncome}
                onBlur={(e) => {
                  const v = parseFloat(e.target.value.replace(/,/g, ''))
                  if (!isNaN(v)) {
                    const clamped = Math.max(0, Math.min(50000, v))
                    update('rentalIncome', clamped)
                    if (clamped !== v) e.target.value = String(clamped)
                  }
                }}
                className="themed-input w-full pl-6 pr-2 py-1.5 border rounded-lg font-mono text-sm"
              />
            </div>
            <span className="text-[var(--content-subtle)] text-sm">/mo</span>
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
                    : 'bg-[var(--surface)] border-[var(--border)] hover:border-[var(--border)]'
                }`}
                onClick={() => {
                  const newUnits = inputs.units.map((u, i) => ({ ...u, ownerOccupied: i === idx }))
                  update('units', newUnits)
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[var(--content-muted)] text-sm">{unit.beds}BR/{unit.baths}BA</span>
                  {unit.ownerOccupied && <span className="rounded-full border border-green-500/40 bg-green-500/10 px-2 py-0.5 text-green-400 text-xs">You</span>}
                </div>
                {!unit.ownerOccupied && (
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--content-subtle)] text-xs">$</span>
                    <input
                      type="text"
                      key={unit.monthlyRent}
                      defaultValue={unit.monthlyRent}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => {
                        const v = parseFloat(e.target.value.replace(/,/g, ''))
                        if (!isNaN(v)) {
                          const clamped = Math.max(0, Math.min(50000, v))
                          const newUnits = [...inputs.units]
                          newUnits[idx] = { ...unit, monthlyRent: clamped }
                          update('units', newUnits)
                          if (clamped !== v) e.target.value = String(clamped)
                        }
                      }}
                      className="themed-input w-full pl-5 pr-2 py-1 border rounded text-green-400 font-mono text-sm"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        
        {/* ===== ADVANCED SETTINGS (Collapsible) ===== */}
        <div className="mb-4">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            data-shortcut="advanced"
            className="flex items-center gap-2 text-[var(--content-subtle)] hover:text-[var(--content-muted)] text-sm transition-colors"
          >
            <span className={`icon-disclosure transition-transform ${showAdvanced ? 'rotate-90' : ''}`} aria-hidden="true" />
            Advanced Settings <kbd className="ml-2 px-1.5 py-0.5 bg-[var(--surface-muted)] rounded text-[10px] text-[var(--content-subtle)] hidden md:inline">A</kbd>
          </button>
          
          {showAdvanced && (
            <div className="mt-4 p-4 bg-[var(--surface)] border border-[var(--border)] rounded-xl">
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                <InputField label="HOA/mo" value={inputs.hoaMonthly} onChange={(v: number) => update('hoaMonthly', v)} prefix="$" tooltip="Monthly HOA dues. Multi-family usually $0." min={0} max={5000} />
                <InputField label="Maintenance/yr" value={inputs.maintenanceAnnual} onChange={(v: number) => update('maintenanceAnnual', v)} prefix="$" tooltip="Annual repairs/upkeep. ~1% of home value." min={0} max={100000} />
                <InputField label="Closing %" value={inputs.closingCostPercent} onChange={(v: number) => update('closingCostPercent', v)} suffix="%" tooltip="Closing costs as % of price. Usually 2-4%." min={0} max={10} />
                <InputField label="W2 Income" value={inputs.w2Income} onChange={(v: number) => update('w2Income', v)} prefix="$" tooltip="Your annual W2 income. Affects tax brackets and passive loss limits." min={0} max={10000000} />
                <InputField label="Fed Tax" value={(inputs.federalBracket * 100).toFixed(0)} onChange={(v: number) => update('federalBracket', v / 100)} suffix="%" tooltip="Your marginal federal tax bracket." min={0} max={50} />
                <InputField label="State Tax" value={(inputs.stateRate * 100).toFixed(0)} onChange={(v: number) => update('stateRate', v / 100)} suffix="%" tooltip="State income tax rate. MA is 5% flat." min={0} max={15} />
                <InputField label="Appreciation μ" value={(inputs.appreciationMean * 100).toFixed(1)} onChange={(v: number) => update('appreciationMean', v / 100)} suffix="%" tooltip="Mean annual home appreciation. Historical ~5%." min={-20} max={30} />
                <InputField label="Appreciation σ" value={(inputs.appreciationStdDev * 100).toFixed(1)} onChange={(v: number) => update('appreciationStdDev', v / 100)} suffix="%" tooltip="Std dev of appreciation. Higher = more volatility." min={0} max={50} />
                <InputField label="Stock Return μ" value={(inputs.stockReturnMean * 100).toFixed(1)} onChange={(v: number) => update('stockReturnMean', v / 100)} suffix="%" tooltip="Mean annual S&P 500 return. Historical ~10%." min={-50} max={50} />
                <InputField label="Stock Return σ" value={(inputs.stockReturnStdDev * 100).toFixed(1)} onChange={(v: number) => update('stockReturnStdDev', v / 100)} suffix="%" tooltip="Std dev of stock returns. Historical ~17%." min={0} max={100} />
                <InputField label="Rent Growth" value={(inputs.rentGrowth * 100).toFixed(0)} onChange={(v: number) => update('rentGrowth', v / 100)} suffix="%" tooltip="Annual rent increase for your current rent." min={-10} max={20} />
              </div>
            </div>
          )}
        </div>
      
        {/* ===== STRATEGIES (Collapsible) ===== */}
        <div className="mb-4">
          <button
            onClick={() => setShowStrategies(!showStrategies)}
            data-shortcut="strategies"
            className="flex items-center gap-2 text-[var(--content-subtle)] hover:text-[var(--content-muted)] text-sm transition-colors"
          >
            <span className={`icon-disclosure transition-transform ${showStrategies ? 'rotate-90' : ''}`} aria-hidden="true" />
            Strategies / Scenarios <kbd className="ml-2 px-1.5 py-0.5 bg-[var(--surface-muted)] rounded text-[10px] text-[var(--content-subtle)] hidden md:inline">T</kbd>
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
                  className="w-4 h-4 rounded border-violet-500/50 bg-[var(--surface)] text-violet-500" 
                />
                <span className="text-violet-300 font-medium">First-Time Homebuyer (ONE Mortgage, MassHousing)</span>
              </label>
              {inputs.firstTimeHomeBuyer?.enabled && (
                <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={inputs.firstTimeHomeBuyer?.noPMI || false}
                      onChange={(e) => update('firstTimeHomeBuyer', { ...inputs.firstTimeHomeBuyer, noPMI: e.target.checked })}
                      className="w-3 h-3 rounded" />
                    <span className="text-[var(--content-muted)]">No PMI</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={inputs.firstTimeHomeBuyer?.lowerRate || false}
                      onChange={(e) => update('firstTimeHomeBuyer', { ...inputs.firstTimeHomeBuyer, lowerRate: e.target.checked })}
                      className="w-3 h-3 rounded" />
                    <span className="text-[var(--content-muted)]">-0.25% Rate</span>
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
                  className="w-4 h-4 rounded border-emerald-500/50 bg-[var(--surface)] text-emerald-500" 
                />
                <span className="text-emerald-300 font-medium">HELOC → Equities (extract equity, deploy to stocks)</span>
              </label>
            </div>
            
            {/* Advanced Tax Strategies */}
            <div className="p-4 bg-[var(--surface)] border border-[var(--border)] rounded-xl">
              <div className="text-[var(--content-subtle)] text-sm mb-3">Advanced Tax Strategies</div>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer" title="Accelerate depreciation by reclassifying 20% of building as 5/7/15-year assets. 100% bonus depreciation in Year 1.">
                  <input type="checkbox" checked={inputs.taxStrategies?.costSegregation?.enabled || false}
                    onChange={(e) => update('taxStrategies', {
                      ...inputs.taxStrategies,
                      costSegregation: { 
                        enabled: e.target.checked, 
                        shortLifePercent: 0.20, 
                        year1BonusDepreciation: 1.0 
                      }
                    })}
                    className="w-4 h-4 rounded border-purple-500/50 bg-[var(--surface)] text-purple-500" />
                  <span className="text-purple-300 font-medium">Cost Segregation Study</span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer" title="20% QBI deduction on net rental income. Requires 250+ hours/year managing property.">
                  <input type="checkbox" checked={inputs.taxStrategies?.qbi?.enabled || false}
                    onChange={(e) => update('taxStrategies', {
                      ...inputs.taxStrategies,
                      qbi: { enabled: e.target.checked, qualifiesAsBusiness: e.target.checked }
                    })}
                    className="w-4 h-4 rounded border-amber-500/50 bg-[var(--surface)] text-amber-500" />
                  <span className="text-amber-300 font-medium">QBI Deduction (199A)</span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer" title="Defer capital gains and depreciation recapture by reinvesting into like-kind property.">
                  <input type="checkbox" checked={inputs.taxStrategies?.exchange1031?.enabled || false}
                    onChange={(e) => update('taxStrategies', {
                      ...inputs.taxStrategies,
                      exchange1031: { enabled: e.target.checked }
                    })}
                    className="w-4 h-4 rounded border-cyan-500/50 bg-[var(--surface)] text-cyan-500" />
                  <span className="text-cyan-300 font-medium">1031 Exchange</span>
                </label>
              </div>
            </div>
            
            {/* Exit Strategy */}
            <div className="p-4 bg-[var(--surface)] border border-[var(--border)] rounded-xl">
              <div className="text-[var(--content-subtle)] text-sm mb-3">Exit Strategy</div>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: 'sell', label: 'Sell', color: 'red', desc: 'Pay all taxes' },
                  { value: 'hold', label: 'Hold Forever', color: 'green', desc: 'Paper equity, no taxes' },
                  { value: '1031', label: '1031 Exchange', color: 'cyan', desc: 'Defer taxes, upgrade' },
                  { value: 'remote', label: 'Remote Landlord', color: 'amber', desc: '100% rental, hire PM' },
                ].map(({ value, label, color, desc }) => (
                  <button
                    key={value}
                    onClick={() => update('exitStrategy', value as 'sell' | 'hold' | '1031' | 'remote')}
                    className={`px-3 py-1.5 rounded-lg text-sm transition-all ${
                      inputs.exitStrategy === value
                        ? `bg-${color}-500/30 border-${color}-500 text-${color}-300`
                        : 'bg-[var(--surface)] border-[var(--border)] text-[var(--content-subtle)] hover:bg-[var(--surface-muted)]'
                    } border`}
                    title={desc}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="text-[var(--content-subtle)] text-xs mt-2">
                {inputs.exitStrategy === 'sell' && '→ Sell at year N, pay 6% costs + capital gains + depreciation recapture'}
                {inputs.exitStrategy === 'hold' && '→ Never sell, paper equity only (buy-borrow-die strategy)'}
                {inputs.exitStrategy === '1031' && '→ Exchange into bigger property, defer all taxes indefinitely'}
                {inputs.exitStrategy === 'remote' && '→ Move away, hire property manager (10% of rent), lose primary residence exemption'}
              </div>
            </div>
            
            {/* Scenarios */}
            <div className="p-4 bg-[var(--surface)] border border-[var(--border)] rounded-xl">
              <div className="text-[var(--content-subtle)] text-sm mb-3">Risk Scenarios</div>
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
        
        {/* Run Button */}
        <button 
          onClick={runSim}
          disabled={isRunning}
          className="w-full py-3 sm:py-4 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 
                     disabled:from-gray-700 disabled:to-gray-600 disabled:cursor-not-allowed
                     rounded-xl text-[var(--content)] font-bold text-base sm:text-lg shadow-lg shadow-blue-900/30
                     transition-all duration-200 hover:shadow-blue-900/50 hover:scale-[1.01] active:scale-[0.99]
                     flex items-center justify-center gap-2 sm:gap-3 group"
        >
          {isRunning ? (
            <>
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span className="animate-pulse">Running {inputs.numSimulations.toLocaleString()} simulations...</span>
            </>
          ) : (
            <>
              <span className="group-hover:translate-x-0.5 transition-transform">Run Simulation</span> 
              <kbd className="ml-2 px-2 py-0.5 bg-[var(--surface-muted)] rounded text-sm hidden md:inline group-hover:bg-[var(--surface-muted)] transition-colors">R</kbd>
            </>
          )}
        </button>
      </div>
      
      {/* Results */}
      {simResults && (
        <div data-section="results" className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          {/* Summary Stats */}
          <Section title="Simulation Results">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
              <Stat 
                label="Buy Wins Probability" 
                value={formatPercent(simResults.finalStats.buyWinsProbability)}
                color={simResults.finalStats.buyWinsProbability > 0.5 ? 'green' : 'red'}
                sub={`${inputs.numSimulations.toLocaleString()} simulations`}
                delay={0}
              />
              <Stat 
                label={`Median Delta (Yr ${inputs.years})`}
                value={formatCurrency(simResults.finalStats.delta.p50)}
                color={simResults.finalStats.delta.p50 > 0 ? 'green' : 'red'}
                sub="P50"
                delay={50}
              />
              <Stat 
                label="Worst Case Delta" 
                value={formatCurrency(simResults.finalStats.delta.p10)}
                sub="P10"
                color="red"
                delay={100}
              />
              <Stat 
                label="Best Case Delta" 
                value={formatCurrency(simResults.finalStats.delta.p90)}
                sub="P90"
                color="green"
                delay={150}
              />
              <Stat 
                label="Median Wealth (Buy)" 
                value={formatCurrency(simResults.finalStats.wealthBuy.p50)}
                sub="P50"
                color="blue"
                delay={200}
              />
              <Stat 
                label="Median Wealth (Rent)" 
                value={formatCurrency(simResults.finalStats.wealthRent.p50)}
                sub="P50"
                delay={250}
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
          
          {/* Interactive Monte Carlo Histogram */}
          <Section title="Final Outcome Distribution (Interactive)">
            <DeltaHistogram 
              runs={simResults.runs} 
              finalStats={simResults.finalStats}
              numSimulations={inputs.numSimulations}
              formatCurrency={formatCurrency}
            />
          </Section>
          
          {/* HELOC Stats (if enabled) */}
          {inputs.heloc.enabled && (
            <Section title="HELOC Activity (Sample Runs)">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="text-sm font-medium text-[var(--content-subtle)] mb-2">Runs with HELOC Draws</h4>
                  <p className="text-2xl font-bold text-green-400">
                    {simResults.runs.filter(r => r.years.some(y => y.helocBalance > 0)).length.toLocaleString()} / {inputs.numSimulations.toLocaleString()}
                  </p>
                  <p className="text-xs text-[var(--content-subtle)]">
                    ({((simResults.runs.filter(r => r.years.some(y => y.helocBalance > 0)).length / inputs.numSimulations) * 100).toFixed(0)}% of simulations used HELOC)
                  </p>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-[var(--content-subtle)] mb-2">Avg Final HELOC Stocks (when used)</h4>
                  {(() => {
                    const runsWithHeloc = simResults.runs.filter(r => r.years[r.years.length - 1]?.stocksFromHeloc > 0)
                    const avgStocks = runsWithHeloc.length > 0 
                      ? runsWithHeloc.reduce((sum, r) => sum + (r.years[r.years.length - 1]?.stocksFromHeloc || 0), 0) / runsWithHeloc.length
                      : 0
                    return (
                      <>
                        <p className="text-2xl font-bold text-blue-400">{formatCurrency(avgStocks)}</p>
                        <p className="text-xs text-[var(--content-subtle)]">Stocks purchased with HELOC proceeds</p>
                      </>
                    )
                  })()}
                </div>
              </div>
            </Section>
          )}
          
          {/* Detailed Table */}
          <Section title="Year-by-Year Percentiles">
            {/* Mobile view: simplified card layout */}
            <div className="md:hidden space-y-2">
              {simResults.yearlyStats.map((y) => (
                <div key={y.year} className="bg-[var(--surface)] rounded-lg p-3 border border-[var(--border)]">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-[var(--content-subtle)] text-sm font-medium">Year {y.year}</span>
                    <span className={`text-sm font-bold ${y.delta.p50 > 0 ? 'text-green-400' : 'text-red-400'}`}>
                      Δ {formatCurrency(y.delta.p50)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-[var(--content-subtle)]">Buy:</span>
                      <span className="text-green-400 ml-1">{formatCurrency(y.wealthBuy.p50)}</span>
                    </div>
                    <div>
                      <span className="text-[var(--content-subtle)]">Rent:</span>
                      <span className="text-red-400 ml-1">{formatCurrency(y.wealthRent.p50)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop view: full table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[var(--content-subtle)] border-b border-[var(--border)]">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
              <div className="bg-green-900/10 rounded-lg p-3 sm:p-4 border border-green-500/20">
                <h4 className="text-sm font-medium text-green-400/80 mb-2">Buy Scenario (Year {inputs.years})</h4>
                <div className="grid grid-cols-2 gap-1 sm:gap-2 text-xs sm:text-sm">
                  <div className="text-[var(--content-subtle)]">Min: <span className="text-green-400">{formatCurrency(simResults.finalStats.wealthBuy.min)}</span></div>
                  <div className="text-[var(--content-subtle)]">Max: <span className="text-green-400">{formatCurrency(simResults.finalStats.wealthBuy.max)}</span></div>
                  <div className="text-[var(--content-subtle)]">P10: <span className="text-green-400">{formatCurrency(simResults.finalStats.wealthBuy.p10)}</span></div>
                  <div className="text-[var(--content-subtle)]">P90: <span className="text-green-400">{formatCurrency(simResults.finalStats.wealthBuy.p90)}</span></div>
                  <div className="text-[var(--content-subtle)]">Mean: <span className="text-green-400">{formatCurrency(simResults.finalStats.wealthBuy.mean)}</span></div>
                  <div className="text-[var(--content-subtle)]">Median: <span className="text-green-400">{formatCurrency(simResults.finalStats.wealthBuy.p50)}</span></div>
                </div>
              </div>
              <div className="bg-red-900/10 rounded-lg p-3 sm:p-4 border border-red-500/20">
                <h4 className="text-sm font-medium text-red-400/80 mb-2">Rent Scenario (Year {inputs.years})</h4>
                <div className="grid grid-cols-2 gap-1 sm:gap-2 text-xs sm:text-sm">
                  <div className="text-[var(--content-subtle)]">Min: <span className="text-red-400">{formatCurrency(simResults.finalStats.wealthRent.min)}</span></div>
                  <div className="text-[var(--content-subtle)]">Max: <span className="text-red-400">{formatCurrency(simResults.finalStats.wealthRent.max)}</span></div>
                  <div className="text-[var(--content-subtle)]">P10: <span className="text-red-400">{formatCurrency(simResults.finalStats.wealthRent.p10)}</span></div>
                  <div className="text-[var(--content-subtle)]">P90: <span className="text-red-400">{formatCurrency(simResults.finalStats.wealthRent.p90)}</span></div>
                  <div className="text-[var(--content-subtle)]">Mean: <span className="text-red-400">{formatCurrency(simResults.finalStats.wealthRent.mean)}</span></div>
                  <div className="text-[var(--content-subtle)]">Median: <span className="text-red-400">{formatCurrency(simResults.finalStats.wealthRent.p50)}</span></div>
                </div>
              </div>
            </div>
          </Section>
          
          {/* Interpretation */}
          <Section title="Interpretation">
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
              <p className="text-[var(--content-subtle)] mt-4">
                Note: This simulation samples from normal distributions for both housing appreciation (μ={formatPercent(inputs.appreciationMean)}, σ={formatPercent(inputs.appreciationStdDev)}) 
                and stock returns (μ={formatPercent(inputs.stockReturnMean)}, σ={formatPercent(inputs.stockReturnStdDev)}). 
                Real returns have fat tails — extreme outcomes are more likely than this model suggests.
              </p>
            </div>
          </Section>
          
          {/* Advanced Analysis Section */}
          <Section title="Advanced Analysis">
            <div className="flex flex-wrap gap-2 sm:gap-4 mb-4 sm:mb-6">
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
                className="px-3 sm:px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:cursor-not-allowed
                           rounded-lg text-[var(--content)] font-medium text-xs sm:text-sm transition-colors flex items-center gap-2 touch-target"
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
                  <><span className="hidden xs:inline">Sensitivity</span><span className="xs:hidden">Sens.</span> Analysis</>
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
                className="px-3 sm:px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:cursor-not-allowed
                           rounded-lg text-[var(--content)] font-medium text-xs sm:text-sm transition-colors flex items-center gap-2 touch-target"
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
                  <>Break-Even Surface</>
                )}
              </button>
              
              <button
                onClick={() => {
                  setIsRunningWhatIf(true)
                  setTimeout(() => {
                    const results = runWhatIfAnalysis(inputs, 1000)
                    setWhatIfResults(results)
                    setIsRunningWhatIf(false)
                  }, 50)
                }}
                disabled={isRunningWhatIf}
                className="px-3 sm:px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:cursor-not-allowed
                           rounded-lg text-[var(--content)] font-medium text-xs sm:text-sm transition-colors flex items-center gap-2 touch-target"
              >
                {isRunningWhatIf ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Running...
                  </>
                ) : (
                  <>What If?</>
                )}
              </button>
            </div>
            
            {/* What-If Sensitivity Results */}
            {whatIfResults && (
              <div className="mb-8">
                <h4 className="text-base sm:text-lg font-bold text-[var(--content)] mb-3 sm:mb-4">What If? Scenarios</h4>
                <p className="text-[var(--content-subtle)] text-xs sm:text-sm mb-3 sm:mb-4">
                  How do common changes affect your outcome? Base case: <span className="text-[var(--content)]">{formatCurrency(whatIfResults.baseP50Delta)}</span> median delta, <span className="text-[var(--content)]">{formatPercent(whatIfResults.baseWinRate)}</span> buy wins.
                </p>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {whatIfResults.scenarios.map((scenario) => {
                    const bgColor = scenario.direction === 'better' 
                      ? 'bg-green-900/20 border-green-500/30 hover:border-green-500/50' 
                      : scenario.direction === 'worse'
                        ? 'bg-red-900/20 border-red-500/30 hover:border-red-500/50'
                        : 'bg-[var(--surface)] border-[var(--border)] hover:border-[var(--border)]'
                    
                    const deltaColor = scenario.deltaChange > 0 ? 'text-green-400' : scenario.deltaChange < 0 ? 'text-red-400' : 'text-[var(--content-subtle)]'
                    const winRateColor = scenario.winRateChange > 0.02 ? 'text-green-400' : scenario.winRateChange < -0.02 ? 'text-red-400' : 'text-[var(--content-subtle)]'
                    
                    return (
                      <div 
                        key={scenario.id}
                        className={`p-3 sm:p-4 rounded-xl border transition-colors ${bgColor}`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium text-[var(--content)] text-sm sm:text-base">{scenario.label}</span>
                          <span className={`text-xs sm:text-sm font-mono ${deltaColor}`}>
                            {scenario.deltaChange >= 0 ? '+' : ''}{formatCurrency(scenario.deltaChange)}
                          </span>
                        </div>
                        <div className="text-[var(--content-subtle)] text-xs sm:text-sm mb-2">{scenario.description}</div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-[var(--content-subtle)]">
                            P50: <span className="text-[var(--content-muted)]">{formatCurrency(scenario.newP50Delta)}</span>
                          </span>
                          <span className={winRateColor}>
                            Win: {formatPercent(scenario.newWinRate)} ({scenario.winRateChange >= 0 ? '+' : ''}{(scenario.winRateChange * 100).toFixed(1)}%)
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
                
                <div className="mt-4 flex items-center gap-4 text-xs text-[var(--content-subtle)]">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-green-500/30 border border-green-500/50" />
                    <span>Better for buying</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-red-500/30 border border-red-500/50" />
                    <span>Worse for buying</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-[var(--surface-muted)] border border-[var(--border)]" />
                    <span>Minimal impact</span>
                  </div>
                </div>
              </div>
            )}
            
            {/* Sensitivity Analysis Results (Tornado Chart) */}
            {sensitivityResults && (
              <div className="mb-8">
                <h4 className="text-base sm:text-lg font-bold text-[var(--content)] mb-3 sm:mb-4">Sensitivity Analysis</h4>
                <p className="text-[var(--content-subtle)] text-xs sm:text-sm mb-3 sm:mb-4">
                  Which inputs swing the outcome most? Bars show P50 delta change when varying each parameter ±10-20%.
                </p>
                <div className="space-y-2 sm:space-y-3">
                  {sensitivityResults.map((result) => {
                    const maxImpact = sensitivityResults[0]?.impact || 1
                    const leftWidth = Math.abs(result.lowP50Delta - result.baseP50Delta) / maxImpact * 100
                    const rightWidth = Math.abs(result.highP50Delta - result.baseP50Delta) / maxImpact * 100
                    const leftColor = result.lowP50Delta < result.baseP50Delta ? 'bg-red-500' : 'bg-green-500'
                    const rightColor = result.highP50Delta > result.baseP50Delta ? 'bg-green-500' : 'bg-red-500'
                    
                    return (
                      <div key={result.parameter} className="flex items-center gap-2 sm:gap-4">
                        <div className="w-20 sm:w-32 text-xs sm:text-sm text-[var(--content-muted)] text-right shrink-0 truncate">
                          {result.label}
                        </div>
                        <div className="flex-1 flex items-center h-5 sm:h-6">
                          {/* Left bar (low value effect) */}
                          <div className="flex-1 flex justify-end">
                            <div 
                              className={`h-4 sm:h-5 ${leftColor} rounded-l`}
                              style={{ width: `${Math.min(leftWidth, 100)}%` }}
                            />
                          </div>
                          {/* Center line */}
                          <div className="w-px h-5 sm:h-6 bg-[var(--border)]" />
                          {/* Right bar (high value effect) */}
                          <div className="flex-1">
                            <div 
                              className={`h-4 sm:h-5 ${rightColor} rounded-r`}
                              style={{ width: `${Math.min(rightWidth, 100)}%` }}
                            />
                          </div>
                        </div>
                        <div className="w-16 sm:w-24 text-[10px] sm:text-xs text-[var(--content-subtle)] shrink-0 text-right">
                          ±{formatCurrency(result.impact / 2)}
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="mt-3 sm:mt-4 flex justify-center gap-4 sm:gap-6 text-[10px] sm:text-xs text-[var(--content-subtle)]">
                  <span>← Lower value</span>
                  <span className="text-[var(--content-subtle)]">|</span>
                  <span>Higher value →</span>
                </div>
              </div>
            )}
            
            {/* Break-Even Surface (Heatmap) */}
            {breakEvenSurface && (
              <div>
                <h4 className="text-base sm:text-lg font-bold text-[var(--content)] mb-3 sm:mb-4">Break-Even Surface</h4>
                <p className="text-[var(--content-subtle)] text-xs sm:text-sm mb-3 sm:mb-4">
                  Win probability (buy vs rent) across {breakEvenSurface.xLabel} × {breakEvenSurface.yLabel}. 
                  Green = buy wins, Red = rent wins, Yellow = break-even.
                </p>
                <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
                  <div className="inline-block min-w-max">
                    {/* Y-axis label */}
                    <div className="flex">
                      <div className="w-14 sm:w-20" />
                      <div className="flex-1 text-center text-[10px] sm:text-xs text-[var(--content-subtle)] mb-1 sm:mb-2">
                        {breakEvenSurface.xLabel}
                      </div>
                    </div>
                    
                    {/* Grid */}
                    <div className="flex">
                      {/* Y-axis */}
                      <div className="w-14 sm:w-20 flex flex-col justify-between pr-1 sm:pr-2 text-right">
                        <div className="text-[10px] sm:text-xs text-[var(--content-subtle)] -rotate-0">
                          {breakEvenSurface.yLabel}
                        </div>
                        {breakEvenSurface.yValues.slice().reverse().map((y, i) => (
                          <div key={i} className="text-[10px] sm:text-xs text-[var(--content-subtle)] h-8 sm:h-10 flex items-center justify-end">
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
                                    className="w-9 h-8 sm:w-12 sm:h-10 flex items-center justify-center text-[10px] sm:text-xs font-bold border border-black/20"
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
                            <div key={i} className="w-9 sm:w-12 text-center text-[10px] sm:text-xs text-[var(--content-subtle)]">
                              ${(x/1000).toFixed(0)}k
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="mt-3 sm:mt-4 flex flex-wrap items-center gap-3 sm:gap-4 text-[10px] sm:text-xs text-[var(--content-subtle)]">
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 sm:w-4 sm:h-4 rounded" style={{ backgroundColor: 'rgb(255, 0, 0)' }} />
                    <span>Rent wins</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 sm:w-4 sm:h-4 rounded" style={{ backgroundColor: 'rgb(255, 255, 0)' }} />
                    <span>Break-even</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 sm:w-4 sm:h-4 rounded" style={{ backgroundColor: 'rgb(0, 255, 0)' }} />
                    <span>Buy wins</span>
                  </div>
                </div>
              </div>
            )}
          </Section>
          
          {/* Math Explained Section */}
          <MathExplained inputs={inputs} simResults={simResults} />
          
          {/* National Comparison Section */}
          <Section title="🇺🇸 Market Context">
            <NationalComparison userParams={inputs} userResults={simResults} />
          </Section>
        </div>
      )}
      
      {/* Loading skeleton while simulation runs */}
      {isRunning && !simResults && (
        <ResultsSkeleton />
      )}
      
      {!simResults && !isRunning && (
        <div className="text-center py-12 text-[var(--content-subtle)] animate-in fade-in duration-300">
          Configure parameters above and click &quot;Run Simulation&quot; to see Monte Carlo results.
        </div>
      )}
      
      {/* Progress bar at top during simulation */}
      <SimulationProgress isRunning={isRunning} total={inputs.numSimulations} />
      
      {/* Keyboard Shortcuts */}
      <KeyboardShortcuts
        onRunSimulation={runSim}
        onShare={shareUrl}
        isRunning={isRunning}
        hasResults={!!simResults}
      />
    </PageWrapper>
  )
}

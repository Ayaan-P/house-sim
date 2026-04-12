'use client'

import { useState, useCallback } from 'react'
import { SimulationParams, SimulationSummary, getAlternativeInvestmentLabel, getStateTaxProfileLabel } from '@/lib/monte-carlo'

interface ExportPDFProps {
  inputs: SimulationParams
  results: SimulationSummary
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

export function ExportPDF({ inputs, results }: ExportPDFProps) {
  const [isGenerating, setIsGenerating] = useState(false)
  
  const generatePDF = useCallback(async () => {
    setIsGenerating(true)
    
    try {
      // Dynamically import jsPDF
      const { jsPDF } = await import('jspdf')
      
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      })
      
      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()
      const margin = 15
      const contentWidth = pageWidth - (margin * 2)
      let y = margin
      
      // Colors
      const colors = {
        primary: [30, 41, 59] as [number, number, number],      // slate-800
        accent: [59, 130, 246] as [number, number, number],     // blue-500
        green: [34, 197, 94] as [number, number, number],       // green-500
        red: [239, 68, 68] as [number, number, number],         // red-500
        muted: [100, 116, 139] as [number, number, number],     // slate-500
        light: [148, 163, 184] as [number, number, number],     // slate-400
      }
      
      // Helper functions
      const setColor = (color: [number, number, number]) => {
        doc.setTextColor(color[0], color[1], color[2])
      }
      
      const drawLine = (yPos: number) => {
        doc.setDrawColor(200, 200, 200)
        doc.line(margin, yPos, pageWidth - margin, yPos)
      }
      
      const checkPageBreak = (neededHeight: number) => {
        if (y + neededHeight > pageHeight - margin) {
          doc.addPage()
          y = margin
          return true
        }
        return false
      }
      
      const alternativeInvestmentLabel = getAlternativeInvestmentLabel(inputs)
      const stateProfileLabel = getStateTaxProfileLabel(inputs.stateProfile)

      // ===== PAGE 1: HEADER & SUMMARY =====
      
      // Title
      doc.setFontSize(24)
      doc.setFont('helvetica', 'bold')
      setColor(colors.primary)
      doc.text('House vs Rent Analysis', margin, y + 8)
      y += 12
      
      // Subtitle
      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')
      setColor(colors.muted)
      doc.text(`Generated ${new Date().toLocaleDateString()} | ${inputs.numSimulations.toLocaleString()} Monte Carlo Simulations`, margin, y + 4)
      y += 12
      
      drawLine(y)
      y += 8
      
      // ===== MAIN RESULT BOX =====
      const buyWins = results.finalStats.buyWinsProbability > 0.5
      const winProb = buyWins ? results.finalStats.buyWinsProbability : 1 - results.finalStats.buyWinsProbability
      const boxColor = buyWins ? [34, 197, 94, 0.1] : [239, 68, 68, 0.1]
      const textColor = buyWins ? colors.green : colors.red
      
      // Draw result box
      doc.setFillColor(buyWins ? 240 : 254, buyWins ? 253 : 242, buyWins ? 244 : 242)
      doc.roundedRect(margin, y, contentWidth, 35, 3, 3, 'F')
      
      doc.setFontSize(28)
      doc.setFont('helvetica', 'bold')
      setColor(textColor)
      doc.text(buyWins ? 'BUYING WINS' : 'RENTING WINS', pageWidth / 2, y + 15, { align: 'center' })
      
      doc.setFontSize(16)
      doc.text(`${formatPercent(winProb)} of simulations`, pageWidth / 2, y + 25, { align: 'center' })
      
      doc.setFontSize(9)
      setColor(colors.muted)
      doc.text(`Over ${inputs.years} years with ${formatCurrency(inputs.homePrice)} home`, pageWidth / 2, y + 32, { align: 'center' })
      
      y += 45
      
      // ===== KEY METRICS GRID =====
      doc.setFontSize(14)
      doc.setFont('helvetica', 'bold')
      setColor(colors.primary)
      doc.text('Key Metrics', margin, y)
      y += 8
      
      const metrics = [
        { label: 'Median Delta (P50)', value: formatCurrency(results.finalStats.delta.p50), color: results.finalStats.delta.p50 > 0 ? colors.green : colors.red },
        { label: 'Worst Case (P10)', value: formatCurrency(results.finalStats.delta.p10), color: colors.red },
        { label: 'Best Case (P90)', value: formatCurrency(results.finalStats.delta.p90), color: colors.green },
        { label: 'Buy Wealth (P50)', value: formatCurrency(results.finalStats.wealthBuy.p50), color: colors.accent },
        { label: 'Rent Wealth (P50)', value: formatCurrency(results.finalStats.wealthRent.p50), color: colors.muted },
        { label: 'Hold Period', value: `${inputs.years} years`, color: colors.primary },
      ]
      
      const colWidth = contentWidth / 3
      metrics.forEach((metric, i) => {
        const col = i % 3
        const row = Math.floor(i / 3)
        const x = margin + (col * colWidth)
        const rowY = y + (row * 18)
        
        doc.setFontSize(8)
        setColor(colors.muted)
        doc.text(metric.label, x, rowY)
        
        doc.setFontSize(14)
        doc.setFont('helvetica', 'bold')
        setColor(metric.color)
        doc.text(metric.value, x, rowY + 6)
      })
      
      y += 40
      drawLine(y)
      y += 8
      
      // ===== PROPERTY DETAILS =====
      doc.setFontSize(14)
      doc.setFont('helvetica', 'bold')
      setColor(colors.primary)
      doc.text('Property & Financing', margin, y)
      y += 8
      
      const downPayment = inputs.homePrice * (inputs.downPaymentPercent / 100)
      const loanAmount = inputs.homePrice - downPayment
      const monthlyRate = inputs.mortgageRate / 12
      const numPayments = 360
      const monthlyPI = loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / (Math.pow(1 + monthlyRate, numPayments) - 1)
      
      const propertyDetails = [
        ['Home Price', formatCurrency(inputs.homePrice)],
        ['Down Payment', `${inputs.downPaymentPercent}% (${formatCurrency(downPayment)})`],
        ['Loan Amount', formatCurrency(loanAmount)],
        ['Interest Rate', `${(inputs.mortgageRate * 100).toFixed(2)}%`],
        ['Monthly P&I', formatCurrency(monthlyPI)],
        ['State Profile', stateProfileLabel],
        ['Property Tax', `${(inputs.propertyTaxRate * 100).toFixed(2)}%`],
        ['Insurance', `${formatCurrency(inputs.insuranceAnnual)}/yr`],
        ['Maintenance', `${formatCurrency(inputs.maintenanceAnnual)}/yr`],
      ]
      
      if (inputs.hoaMonthly > 0) {
        propertyDetails.push(['HOA', `${formatCurrency(inputs.hoaMonthly)}/mo`])
      }
      
      // Rental income
      const rentalIncome = inputs.units.length > 0 
        ? inputs.units.filter(u => !u.ownerOccupied).reduce((sum, u) => sum + u.monthlyRent, 0)
        : inputs.houseHack ? inputs.rentalIncome : 0
      
      if (rentalIncome > 0) {
        propertyDetails.push(['Rental Income', `${formatCurrency(rentalIncome)}/mo`])
      }
      
      const halfIdx = Math.ceil(propertyDetails.length / 2)
      const leftDetails = propertyDetails.slice(0, halfIdx)
      const rightDetails = propertyDetails.slice(halfIdx)
      
      doc.setFontSize(9)
      leftDetails.forEach((detail, i) => {
        doc.setFont('helvetica', 'normal')
        setColor(colors.muted)
        doc.text(detail[0], margin, y + (i * 5))
        doc.setFont('helvetica', 'bold')
        setColor(colors.primary)
        doc.text(detail[1], margin + 40, y + (i * 5))
      })
      
      rightDetails.forEach((detail, i) => {
        doc.setFont('helvetica', 'normal')
        setColor(colors.muted)
        doc.text(detail[0], pageWidth / 2, y + (i * 5))
        doc.setFont('helvetica', 'bold')
        setColor(colors.primary)
        doc.text(detail[1], pageWidth / 2 + 40, y + (i * 5))
      })
      
      y += Math.max(leftDetails.length, rightDetails.length) * 5 + 8
      drawLine(y)
      y += 8
      
      // ===== RENT ALTERNATIVE =====
      doc.setFontSize(14)
      doc.setFont('helvetica', 'bold')
      setColor(colors.primary)
      doc.text('Rent Alternative', margin, y)
      y += 8
      
      const rentDetails = [
        ['Current Rent', `${formatCurrency(inputs.currentRent)}/mo`],
        ['Annual Rent', formatCurrency(inputs.currentRent * 12)],
        ['Rent Growth', inputs.rentStochasticGrowth
          ? `Stochastic (μ=${formatPercent(inputs.rentGrowthMean)}, σ=${formatPercent(inputs.rentGrowthStdDev)})`
          : formatPercent(inputs.rentGrowth)],
      ]
      
      if (inputs.rentStochasticGrowth) {
        rentDetails.push(
          ['Rent-Home Correlation', formatPercent(inputs.rentHomeCorrelation)],
          ['Rent Floor', `Max ${(Math.round((1 - inputs.rentFloor) * 100))}% annual drop`],
        )
      }
      
      doc.setFontSize(9)
      rentDetails.forEach((detail, i) => {
        doc.setFont('helvetica', 'normal')
        setColor(colors.muted)
        doc.text(detail[0], margin, y + (i * 5))
        doc.setFont('helvetica', 'bold')
        setColor(colors.primary)
        doc.text(detail[1], margin + 40, y + (i * 5))
      })
      
      y += rentDetails.length * 5 + 8
      drawLine(y)
      y += 8
      
      // ===== ASSUMPTIONS =====
      doc.setFontSize(14)
      doc.setFont('helvetica', 'bold')
      setColor(colors.primary)
      doc.text('Monte Carlo Assumptions', margin, y)
      y += 8
      
      const assumptions = [
        ['State Taxes', `${stateProfileLabel} (${(inputs.stateRate * 100).toFixed(1)}% income, ${(inputs.propertyTaxRate * 100).toFixed(2)}% property)`],
        ['Home Appreciation', `μ=${formatPercent(inputs.appreciationMean)}, σ=${formatPercent(inputs.appreciationStdDev)}`],
        [alternativeInvestmentLabel, `μ=${formatPercent(inputs.stockReturnMean)}, σ=${formatPercent(inputs.stockReturnStdDev)}`],
        ['Market Correlation', formatPercent(inputs.marketCorrelation || 0.3)],
        ['Simulations', inputs.numSimulations.toLocaleString()],
      ]
      
      doc.setFontSize(9)
      assumptions.forEach((detail, i) => {
        doc.setFont('helvetica', 'normal')
        setColor(colors.muted)
        doc.text(detail[0], margin, y + (i * 5))
        doc.setFont('helvetica', 'bold')
        setColor(colors.primary)
        doc.text(detail[1], margin + 45, y + (i * 5))
      })
      
      y += assumptions.length * 5 + 8
      
      // ===== PAGE 2: YEAR BY YEAR TABLE =====
      doc.addPage()
      y = margin
      
      doc.setFontSize(14)
      doc.setFont('helvetica', 'bold')
      setColor(colors.primary)
      doc.text('Year-by-Year Projections', margin, y)
      y += 10
      
      // Table header
      const tableHeaders = ['Year', 'Buy (P50)', 'Rent (P50)', 'Delta (P50)', 'Trend']
      const colWidths = [15, 32, 32, 32, 20]
      
      doc.setFillColor(240, 240, 240)
      doc.rect(margin, y - 4, contentWidth, 8, 'F')
      
      doc.setFontSize(8)
      doc.setFont('helvetica', 'bold')
      setColor(colors.muted)
      let tableX = margin
      tableHeaders.forEach((header, i) => {
        doc.text(header, tableX + 2, y)
        tableX += colWidths[i]
      })
      y += 6
      
      // Table rows
      doc.setFont('helvetica', 'normal')
      results.yearlyStats.forEach((yearData) => {
        checkPageBreak(6)
        
        tableX = margin
        
        // Year
        setColor(colors.primary)
        doc.text(yearData.year.toString(), tableX + 2, y)
        tableX += colWidths[0]
        
        // Buy wealth
        setColor(colors.green)
        doc.text(formatCurrency(yearData.wealthBuy.p50), tableX + 2, y)
        tableX += colWidths[1]
        
        // Rent wealth
        setColor(colors.red)
        doc.text(formatCurrency(yearData.wealthRent.p50), tableX + 2, y)
        tableX += colWidths[2]
        
        // Delta
        const deltaColor = yearData.delta.p50 > 0 ? colors.green : colors.red
        setColor(deltaColor)
        doc.text(formatCurrency(yearData.delta.p50), tableX + 2, y)
        tableX += colWidths[3]
        
        // Win probability - calculate from delta (positive delta = buy wins)
        const deltaIsPositive = yearData.delta.p50 > 0
        setColor(deltaIsPositive ? colors.green : colors.red)
        doc.text(deltaIsPositive ? '▲' : '▼', tableX + 2, y)
        
        y += 5
        
        // Light row separator
        if (yearData.year % 5 === 0) {
          doc.setDrawColor(230, 230, 230)
          doc.line(margin, y - 2, pageWidth - margin, y - 2)
        }
      })
      
      y += 10
      
      // ===== RENTAL METRICS (if applicable) =====
      if (results.rentalMetrics && (results.rentalMetrics.cashOnCashReturn > 0 || results.rentalMetrics.capRate > 0)) {
        checkPageBreak(50)
        drawLine(y)
        y += 8
        
        doc.setFontSize(14)
        doc.setFont('helvetica', 'bold')
        setColor(colors.primary)
        doc.text('Investment Metrics', margin, y)
        y += 10
        
        const metrics = results.rentalMetrics
        const investmentMetrics = [
          ['Cash-on-Cash Return', formatPercent(metrics.cashOnCashReturn)],
          ['Cap Rate', formatPercent(metrics.capRate)],
          ['Monthly Cash Flow', formatCurrency(metrics.monthlyCashFlow)],
          ['1% Rule', metrics.passesOnePercentRule ? 'PASS ✓' : 'FAIL ✗'],
        ]
        
        doc.setFontSize(9)
        investmentMetrics.forEach((detail, i) => {
          doc.setFont('helvetica', 'normal')
          setColor(colors.muted)
          doc.text(detail[0], margin, y + (i * 6))
          doc.setFont('helvetica', 'bold')
          setColor(colors.primary)
          doc.text(detail[1], margin + 50, y + (i * 6))
        })
        
        y += investmentMetrics.length * 6 + 8
      }
      
      // ===== TAX STRATEGIES (if enabled) =====
      const hasStrategies = inputs.firstTimeHomeBuyer?.enabled || 
                           inputs.heloc?.enabled || 
                           inputs.taxStrategies?.costSegregation?.enabled ||
                           inputs.taxStrategies?.qbi?.enabled ||
                           (inputs.exitStrategy && inputs.exitStrategy !== 'sell')
      
      if (hasStrategies) {
        checkPageBreak(40)
        drawLine(y)
        y += 8
        
        doc.setFontSize(14)
        doc.setFont('helvetica', 'bold')
        setColor(colors.primary)
        doc.text('Active Strategies', margin, y)
        y += 8
        
        doc.setFontSize(9)
        const strategies: string[] = []
        
        if (inputs.firstTimeHomeBuyer?.enabled) {
          strategies.push('✓ First-Time Homebuyer (FTHB) Program')
          if (inputs.firstTimeHomeBuyer.noPMI) strategies.push('  - No PMI required')
        }
        if (inputs.heloc?.enabled) {
          strategies.push('✓ HELOC → Equities Strategy')
        }
        if (inputs.taxStrategies?.costSegregation?.enabled) {
          strategies.push('✓ Cost Segregation Study (accelerated depreciation)')
        }
        if (inputs.taxStrategies?.qbi?.enabled) {
          strategies.push('✓ QBI Deduction (Section 199A)')
        }
        if (inputs.exitStrategy === 'hold') {
          strategies.push('✓ Hold Forever (buy-borrow-die)')
        } else if (inputs.exitStrategy === '1031') {
          strategies.push('✓ 1031 Exchange (defer taxes)')
        } else if (inputs.exitStrategy === 'remote') {
          strategies.push('✓ Remote Landlord (100% rental)')
        }
        
        strategies.forEach((strategy, i) => {
          setColor(strategy.startsWith('  ') ? colors.muted : colors.green)
          doc.text(strategy, margin, y + (i * 5))
        })
        
        y += strategies.length * 5 + 8
      }
      
      // ===== MAINTENANCE SHOCK MODEL =====
      if (inputs.maintenanceShock?.enabled && results.shockSummary) {
        checkPageBreak(60)
        drawLine(y)
        y += 8
        
        doc.setFontSize(14)
        doc.setFont('helvetica', 'bold')
        setColor(colors.primary)
        doc.text('Maintenance Shock Analysis', margin, y)
        y += 10
        
        doc.setFontSize(9)
        doc.setFont('helvetica', 'normal')
        setColor(colors.muted)
        doc.text(`Major repair probability (Yr 1-3): ${(results.shockSummary.probRepairYears1to3 * 100).toFixed(0)}%`, margin, y)
        y += 5
        doc.text(`Any major repair (${inputs.years}yr): ${(results.shockSummary.probAnyRepair * 100).toFixed(0)}%`, margin, y)
        y += 5
        doc.text(`Average total shock cost: $${Math.round(results.shockSummary.avgTotalShockCost).toLocaleString()}`, margin, y)
        y += 5
        doc.text(`Recommended emergency fund (P90): $${Math.round(results.shockSummary.emergencyFundRec).toLocaleString()}`, margin, y)
        y += 8
        
        doc.setFont('helvetica', 'bold')
        doc.text('Component Failure Rates:', margin, y)
        y += 5
        doc.setFont('helvetica', 'normal')
        results.shockSummary.componentFailureRates.forEach((comp) => {
          const rateStr = `${comp.name}: ${(comp.failureRate * 100).toFixed(0)}% (avg Yr ${comp.avgReplacementYear.toFixed(1)})`
          setColor(comp.failureRate > 0.8 ? colors.red : comp.failureRate > 0.4 ? [245, 158, 11] as [number, number, number] : colors.green)
          doc.text(rateStr, margin + 4, y)
          y += 5
        })
        
        if (results.shockSummary.cashCrunchYears.length > 0) {
          y += 3
          setColor(colors.red)
          doc.setFont('helvetica', 'bold')
          doc.text(`⚠ Cash crunch risk in years: ${results.shockSummary.cashCrunchYears.join(', ')}`, margin, y)
          y += 5
        }
        
        y += 5
        doc.setFontSize(8)
        setColor(colors.muted)
        doc.text(`Base maintenance: $${Math.round((inputs.maintenanceAnnual || 0) * 0.3).toLocaleString()}/yr (30% of smooth budget). Remaining 70% modeled as component failures.`, margin, y)
        y += 5
      }
      
      // ===== DISTRIBUTION STATS =====
      checkPageBreak(50)
      drawLine(y)
      y += 8
      
      doc.setFontSize(14)
      doc.setFont('helvetica', 'bold')
      setColor(colors.primary)
      doc.text('Distribution Statistics (Final Year)', margin, y)
      y += 10
      
      // Buy scenario
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      setColor(colors.green)
      doc.text('Buy Scenario', margin, y)
      y += 5
      
      doc.setFontSize(8)
      doc.setFont('helvetica', 'normal')
      const buyStats = [
        `Min: ${formatCurrency(results.finalStats.wealthBuy.min)}`,
        `P10: ${formatCurrency(results.finalStats.wealthBuy.p10)}`,
        `P25: ${formatCurrency(results.finalStats.wealthBuy.p25)}`,
        `P50: ${formatCurrency(results.finalStats.wealthBuy.p50)}`,
        `P75: ${formatCurrency(results.finalStats.wealthBuy.p75)}`,
        `P90: ${formatCurrency(results.finalStats.wealthBuy.p90)}`,
        `Max: ${formatCurrency(results.finalStats.wealthBuy.max)}`,
        `Mean: ${formatCurrency(results.finalStats.wealthBuy.mean)}`,
      ]
      setColor(colors.primary)
      doc.text(buyStats.join('  |  '), margin, y)
      y += 8
      
      // Rent scenario
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      setColor(colors.red)
      doc.text('Rent Scenario', margin, y)
      y += 5
      
      doc.setFontSize(8)
      doc.setFont('helvetica', 'normal')
      const rentStats = [
        `Min: ${formatCurrency(results.finalStats.wealthRent.min)}`,
        `P10: ${formatCurrency(results.finalStats.wealthRent.p10)}`,
        `P25: ${formatCurrency(results.finalStats.wealthRent.p25)}`,
        `P50: ${formatCurrency(results.finalStats.wealthRent.p50)}`,
        `P75: ${formatCurrency(results.finalStats.wealthRent.p75)}`,
        `P90: ${formatCurrency(results.finalStats.wealthRent.p90)}`,
        `Max: ${formatCurrency(results.finalStats.wealthRent.max)}`,
        `Mean: ${formatCurrency(results.finalStats.wealthRent.mean)}`,
      ]
      setColor(colors.primary)
      doc.text(rentStats.join('  |  '), margin, y)
      y += 15
      
      // ===== FOOTER / DISCLAIMER =====
      checkPageBreak(30)
      drawLine(y)
      y += 8
      
      doc.setFontSize(8)
      setColor(colors.muted)
      doc.setFont('helvetica', 'italic')
      const disclaimer = [
        'DISCLAIMER: This analysis is for informational purposes only and does not constitute financial advice.',
        'Monte Carlo simulations use normal distributions which may underestimate tail risks.',
        'Actual returns may vary significantly. Tax laws change. Consult a financial advisor.',
        '',
        'Generated by HouseSim (house-vs-rent.netlify.app)'
      ]
      
      disclaimer.forEach((line, i) => {
        doc.text(line, margin, y + (i * 4))
      })
      
      // Save the PDF
      const filename = `housesim-${formatCurrency(inputs.homePrice).replace(/[^0-9]/g, '')}k-${inputs.years}yr-${new Date().toISOString().split('T')[0]}.pdf`
      doc.save(filename)
      
    } catch (error) {
      console.error('Failed to generate PDF:', error)
    } finally {
      setIsGenerating(false)
    }
  }, [inputs, results])
  
  return (
    <button
      onClick={generatePDF}
      disabled={isGenerating}
      className="flex items-center gap-2 px-4 py-2.5 bg-error hover:bg-error/90
                 disabled:bg-gray-600 disabled:cursor-not-allowed
                 rounded-xl text-white font-medium text-sm shadow-lg shadow-error/30
                 transition-all duration-200 hover:shadow-error/50 hover:scale-[1.02] active:scale-[0.98]"
    >
      {isGenerating ? (
        <>
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span>Generating...</span>
        </>
      ) : (
        <>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span>Export PDF</span>
        </>
      )}
    </button>
  )
}

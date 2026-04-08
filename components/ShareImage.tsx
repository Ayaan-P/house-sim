'use client'

import { useRef, useState, useCallback } from 'react'
import { SimulationParams, SimulationSummary } from '@/lib/monte-carlo'

interface ShareImageProps {
  inputs: SimulationParams
  results: SimulationSummary
}

function formatCurrency(n: number): string {
  if (Math.abs(n) >= 1000000) {
    return `$${(n / 1000000).toFixed(1)}M`
  }
  if (Math.abs(n) >= 1000) {
    return `$${(n / 1000).toFixed(0)}k`
  }
  return `$${n.toFixed(0)}`
}

function formatCurrencyFull(n: number): string {
  return new Intl.NumberFormat('en-US', { 
    style: 'currency', 
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

function formatPercent(n: number): string {
  return `${(n * 100).toFixed(0)}%`
}

export function ShareImage({ inputs, results }: ShareImageProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [generatedImage, setGeneratedImage] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  
  const buyWins = results.finalStats.buyWinsProbability > 0.5
  const deltaP50 = results.finalStats.delta.p50
  
  // Generate shareable URL
  const getShareUrl = useCallback(() => {
    const params = new URLSearchParams()
    params.set('price', inputs.homePrice.toString())
    params.set('down', inputs.downPaymentPercent.toString())
    params.set('rate', (inputs.mortgageRate * 100).toString())
    params.set('rent', inputs.currentRent.toString())
    params.set('years', inputs.years.toString())
    if (inputs.units.length > 0) {
      params.set('type', `${inputs.units.length}-family`)
      const totalRent = inputs.units.filter(u => !u.ownerOccupied).reduce((sum, u) => sum + u.monthlyRent, 0)
      params.set('rental', totalRent.toString())
    } else if (inputs.houseHack && inputs.rentalIncome > 0) {
      params.set('househack', '1')
      params.set('rental', inputs.rentalIncome.toString())
    }
    return `${typeof window !== 'undefined' ? window.location.origin : 'https://house-vs-rent.netlify.app'}/?${params.toString()}`
  }, [inputs])

  // Generate image using html2canvas
  const generateImage = useCallback(async () => {
    if (!cardRef.current) return null
    
    setIsGenerating(true)
    
    try {
      // Dynamically import html2canvas
      const html2canvas = (await import('html2canvas')).default
      
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: '#0f172a',
        scale: 2, // Higher resolution
        logging: false,
        useCORS: true,
        allowTaint: true,
      })
      
      const dataUrl = canvas.toDataURL('image/png')
      setGeneratedImage(dataUrl)
      setShowModal(true)
      return dataUrl
    } catch (error) {
      console.error('Failed to generate image:', error)
      return null
    } finally {
      setIsGenerating(false)
    }
  }, [])
  
  // Download the image
  const downloadImage = useCallback(() => {
    if (!generatedImage) return
    
    const link = document.createElement('a')
    link.download = `housesim-${inputs.homePrice}k-${inputs.years}yr.png`
    link.href = generatedImage
    link.click()
  }, [generatedImage, inputs.homePrice, inputs.years])
  
  // Copy image to clipboard
  const copyToClipboard = useCallback(async () => {
    if (!generatedImage) return
    
    try {
      const response = await fetch(generatedImage)
      const blob = await response.blob()
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ])
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
      // Fallback: copy the URL
      navigator.clipboard.writeText(getShareUrl())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [generatedImage, getShareUrl])
  
  // Share via Web Share API (mobile)
  const shareNative = useCallback(async () => {
    if (typeof navigator.share === 'undefined') return
    
    const shareData: ShareData = {
      title: 'House vs Rent Simulation Results',
      text: `${buyWins ? 'Buying' : 'Renting'} wins ${formatPercent(buyWins ? results.finalStats.buyWinsProbability : 1 - results.finalStats.buyWinsProbability)} of the time for a ${formatCurrencyFull(inputs.homePrice)} home over ${inputs.years} years`,
      url: getShareUrl(),
    }
    
    // If we have a generated image and the browser supports file sharing
    if (generatedImage && navigator.canShare) {
      try {
        const response = await fetch(generatedImage)
        const blob = await response.blob()
        const file = new File([blob], 'housesim-results.png', { type: 'image/png' })
        
        if (navigator.canShare({ files: [file] })) {
          shareData.files = [file]
        }
      } catch (e) {
        console.log('Could not include image in share:', e)
      }
    }
    
    try {
      await navigator.share(shareData)
    } catch (error) {
      console.error('Share failed:', error)
    }
  }, [buyWins, results, inputs, generatedImage, getShareUrl])
  
  // Property type description
  const getPropertyType = () => {
    if (inputs.units.length >= 2) return `${inputs.units.length}-Family`
    if (inputs.houseHack) return 'House Hack'
    return 'Single-Family'
  }
  
  // Monthly rental income
  const getRentalIncome = () => {
    if (inputs.units.length > 0) {
      return inputs.units.filter(u => !u.ownerOccupied).reduce((sum, u) => sum + u.monthlyRent, 0)
    }
    return inputs.houseHack ? inputs.rentalIncome : 0
  }
  
  return (
    <>
      {/* Button to trigger generation */}
      <button
        onClick={() => generateImage()}
        disabled={isGenerating}
        className="flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary-hover
                   disabled:bg-gray-600 disabled:cursor-not-allowed
                   rounded-xl text-white font-medium text-sm shadow-lg shadow-primary/30
                   transition-all duration-200 hover:shadow-primary/50 hover:scale-[1.02] active:scale-[0.98]"
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
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span>Share as Image</span>
          </>
        )}
      </button>
      
      {/* Hidden card for rendering */}
      <div className="fixed -left-[9999px] top-0 pointer-events-none">
        <div
          ref={cardRef}
          className="w-[600px] p-6"
          style={{
            background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-bold text-lg">
                H
              </div>
              <div>
                <div className="text-white font-bold text-lg">HouseSim</div>
                <div className="text-white/50 text-xs">Monte Carlo Simulator</div>
              </div>
            </div>
            <div className="text-white/40 text-xs">
              {inputs.numSimulations.toLocaleString()} simulations
            </div>
          </div>
          
          {/* Main Result */}
          <div className={`p-5 rounded-2xl mb-5 ${
            buyWins 
              ? 'bg-gradient-to-r from-green-900/40 to-green-800/20 border border-green-500/30'
              : 'bg-gradient-to-r from-red-900/40 to-red-800/20 border border-red-500/30'
          }`}>
            <div className="text-center">
              <div className={`text-5xl font-black ${buyWins ? 'text-green-400' : 'text-red-400'}`}>
                {buyWins ? 'BUY' : 'RENT'} WINS
              </div>
              <div className={`text-3xl font-bold mt-2 ${buyWins ? 'text-green-300' : 'text-red-300'}`}>
                {formatPercent(buyWins ? results.finalStats.buyWinsProbability : 1 - results.finalStats.buyWinsProbability)}
              </div>
              <div className="text-white/50 text-sm mt-1">
                of {inputs.numSimulations.toLocaleString()} simulations over {inputs.years} years
              </div>
            </div>
          </div>
          
          {/* Key Stats Grid */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="bg-white/5 rounded-xl p-3 text-center border border-white/10">
              <div className="text-white/50 text-xs mb-1">Home Price</div>
              <div className="text-white font-bold text-lg">{formatCurrencyFull(inputs.homePrice)}</div>
              <div className="text-white/40 text-xs">{getPropertyType()}</div>
            </div>
            <div className="bg-white/5 rounded-xl p-3 text-center border border-white/10">
              <div className="text-white/50 text-xs mb-1">Down Payment</div>
              <div className="text-white font-bold text-lg">{inputs.downPaymentPercent}%</div>
              <div className="text-white/40 text-xs">{formatCurrency(inputs.homePrice * inputs.downPaymentPercent / 100)}</div>
            </div>
            <div className="bg-white/5 rounded-xl p-3 text-center border border-white/10">
              <div className="text-white/50 text-xs mb-1">Rate</div>
              <div className="text-white font-bold text-lg">{(inputs.mortgageRate * 100).toFixed(2)}%</div>
              <div className="text-white/40 text-xs">30-yr fixed</div>
            </div>
          </div>
          
          {/* Outcome Stats */}
          <div className="grid grid-cols-2 gap-3 mb-5">
            <div className="bg-blue-900/20 rounded-xl p-4 border border-blue-500/20">
              <div className="text-blue-300/70 text-xs mb-2">Median Delta (P50)</div>
              <div className={`text-2xl font-bold ${deltaP50 > 0 ? 'text-green-400' : 'text-red-400'}`}>
                {deltaP50 > 0 ? '+' : ''}{formatCurrencyFull(deltaP50)}
              </div>
              <div className="text-white/40 text-xs mt-1">
                {deltaP50 > 0 ? 'Buy beats rent' : 'Rent beats buy'}
              </div>
            </div>
            <div className="bg-purple-900/20 rounded-xl p-4 border border-purple-500/20">
              <div className="text-purple-300/70 text-xs mb-2">Outcome Range (P10-P90)</div>
              <div className="text-lg font-bold">
                <span className="text-red-400">{formatCurrency(results.finalStats.delta.p10)}</span>
                <span className="text-white/30 mx-1">→</span>
                <span className="text-green-400">{formatCurrency(results.finalStats.delta.p90)}</span>
              </div>
              <div className="text-white/40 text-xs mt-1">
                80% of outcomes fall in this range
              </div>
            </div>
          </div>
          
          {/* Comparison Row */}
          <div className="flex gap-3 mb-5">
            <div className="flex-1 bg-green-900/10 rounded-xl p-3 border border-green-500/20">
              <div className="text-green-300/70 text-xs mb-1">Buy Wealth (P50)</div>
              <div className="text-green-400 font-bold text-lg">{formatCurrencyFull(results.finalStats.wealthBuy.p50)}</div>
            </div>
            <div className="flex-1 bg-red-900/10 rounded-xl p-3 border border-red-500/20">
              <div className="text-red-300/70 text-xs mb-1">Rent Wealth (P50)</div>
              <div className="text-red-400 font-bold text-lg">{formatCurrencyFull(results.finalStats.wealthRent.p50)}</div>
            </div>
            {getRentalIncome() > 0 && (
              <div className="flex-1 bg-amber-900/10 rounded-xl p-3 border border-amber-500/20">
                <div className="text-amber-300/70 text-xs mb-1">Rental Income</div>
                <div className="text-amber-400 font-bold text-lg">${getRentalIncome().toLocaleString()}/mo</div>
              </div>
            )}
          </div>
          
          {/* Assumptions */}
          <div className="bg-white/5 rounded-xl p-3 border border-white/10 mb-4">
            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              <div>
                <div className="text-white/40">Appreciation</div>
                <div className="text-white/70 font-mono">{(inputs.appreciationMean * 100).toFixed(1)}%</div>
              </div>
              <div>
                <div className="text-white/40">{inputs.alternativeInvestmentPreset === 'sp500' ? 'S&P 500' : inputs.alternativeInvestmentPreset === 'balanced' ? '60/40' : inputs.alternativeInvestmentPreset === 'cash' ? 'Cash / T-Bills' : 'Alt Return'}</div>
                <div className="text-white/70 font-mono">{(inputs.stockReturnMean * 100).toFixed(1)}%</div>
              </div>
              <div>
                <div className="text-white/40">Current Rent</div>
                <div className="text-white/70 font-mono">${inputs.currentRent.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-white/40">Hold Period</div>
                <div className="text-white/70 font-mono">{inputs.years} years</div>
              </div>
            </div>
          </div>
          
          {/* Footer */}
          <div className="flex items-center justify-between text-xs">
            <div className="text-white/30">
              Generated {new Date().toLocaleDateString()}
            </div>
            <div className="text-white/40">
              house-vs-rent.netlify.app
            </div>
          </div>
        </div>
      </div>
      
      {/* Modal for sharing */}
      {showModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-surface rounded-2xl border border-border max-w-2xl w-full max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h3 className="text-content font-bold text-lg">Share Your Results</h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-content-subtle hover:text-content transition-colors p-1"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-4 overflow-y-auto max-h-[60vh]">
              {generatedImage && (
                <img
                  src={generatedImage}
                  alt="Simulation Results"
                  className="w-full rounded-xl border border-border"
                />
              )}
            </div>

            <div className="p-4 border-t border-border flex flex-wrap gap-3">
              <button
                onClick={downloadImage}
                className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-white font-medium text-sm transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download
              </button>
              
              <button
                onClick={copyToClipboard}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-colors ${
                  copied
                    ? 'bg-green-600 text-white'
                    : 'bg-surface-muted hover:bg-border text-content'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {copied ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                  )}
                </svg>
                {copied ? 'Copied!' : 'Copy'}
              </button>
              
              {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
                <button
                  onClick={shareNative}
                  className="flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary-hover rounded-xl text-white font-medium text-sm transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  Share
                </button>
              )}
              
              <button
                onClick={() => setShowModal(false)}
                className="ml-auto px-4 py-2.5 bg-surface-muted hover:bg-border rounded-xl text-content-muted font-medium text-sm transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

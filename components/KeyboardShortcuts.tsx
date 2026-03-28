'use client'

import { useEffect, useState, useCallback } from 'react'

interface KeyboardShortcutsProps {
  onRunSimulation: () => void
  onShare: () => void
  onExportMd?: () => void
  onExportCsv?: () => void
  isRunning: boolean
  hasResults: boolean
}

interface ShortcutModalProps {
  isOpen: boolean
  onClose: () => void
}

function ShortcutModal({ isOpen, onClose }: ShortcutModalProps) {
  if (!isOpen) return null
  
  const shortcuts = [
    { key: 'R', description: 'Run simulation', category: 'Actions' },
    { key: 'S', description: 'Share (copy link)', category: 'Actions' },
    { key: 'E', description: 'Export Markdown', category: 'Export' },
    { key: 'Shift+E', description: 'Export CSV', category: 'Export' },
    { key: '?', description: 'Show this help', category: 'Navigation' },
    { key: 'Esc', description: 'Close modal', category: 'Navigation' },
    { key: '1', description: 'Jump to inputs', category: 'Navigation' },
    { key: '2', description: 'Jump to results', category: 'Navigation' },
    { key: 'A', description: 'Toggle advanced settings', category: 'Panels' },
    { key: 'T', description: 'Toggle strategies', category: 'Panels' },
  ]
  
  const categories = Array.from(new Set(shortcuts.map(s => s.category)))
  
  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div 
        className="bg-[#0d0d0d] border border-white/[0.15] rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">Keyboard Shortcuts</h2>
          <button 
            onClick={onClose}
            className="text-white/40 hover:text-white/70 transition-colors text-xl"
          >
            ✕
          </button>
        </div>
        
        <div className="space-y-6">
          {categories.map(category => (
            <div key={category}>
              <h3 className="text-sm font-medium text-white/50 mb-3">{category}</h3>
              <div className="space-y-2">
                {shortcuts.filter(s => s.category === category).map(shortcut => (
                  <div 
                    key={shortcut.key}
                    className="flex items-center justify-between py-1.5"
                  >
                    <span className="text-white/80">{shortcut.description}</span>
                    <kbd className="px-2.5 py-1 bg-white/[0.08] border border-white/[0.15] rounded-lg text-sm font-mono text-white/90 min-w-[2.5rem] text-center">
                      {shortcut.key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        
        <div className="mt-6 pt-4 border-t border-white/[0.08] text-center text-white/40 text-sm">
          Press <kbd className="px-1.5 py-0.5 bg-white/[0.08] rounded text-xs">?</kbd> anytime to show this
        </div>
      </div>
    </div>
  )
}

export function KeyboardShortcuts({
  onRunSimulation,
  onShare,
  onExportMd,
  onExportCsv,
  isRunning,
  hasResults,
}: KeyboardShortcutsProps) {
  const [showHelp, setShowHelp] = useState(false)
  
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Ignore if typing in an input
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
      return
    }
    
    // Show help modal
    if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
      e.preventDefault()
      setShowHelp(true)
      return
    }
    
    // Close modal on Escape
    if (e.key === 'Escape' && showHelp) {
      e.preventDefault()
      setShowHelp(false)
      return
    }
    
    // Run simulation (r or R)
    if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !isRunning) {
      e.preventDefault()
      onRunSimulation()
      return
    }
    
    // Share (s or S)
    if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      onShare()
      return
    }
    
    // Export Markdown (e without shift)
    if ((e.key === 'e') && !e.shiftKey && !e.ctrlKey && !e.metaKey && onExportMd && hasResults) {
      e.preventDefault()
      onExportMd()
      return
    }
    
    // Export CSV (E with shift)
    if ((e.key === 'E' || (e.key === 'e' && e.shiftKey)) && !e.ctrlKey && !e.metaKey && onExportCsv && hasResults) {
      e.preventDefault()
      onExportCsv()
      return
    }
    
    // Toggle advanced settings (a or A)
    if ((e.key === 'a' || e.key === 'A') && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      const advancedButton = document.querySelector('[data-shortcut="advanced"]') as HTMLButtonElement
      if (advancedButton) advancedButton.click()
      return
    }
    
    // Toggle strategies (t or T)
    if ((e.key === 't' || e.key === 'T') && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      const strategiesButton = document.querySelector('[data-shortcut="strategies"]') as HTMLButtonElement
      if (strategiesButton) strategiesButton.click()
      return
    }
    
    // Jump to sections (1, 2)
    if (e.key === '1') {
      e.preventDefault()
      const heroSection = document.querySelector('[data-section="hero"]')
      if (heroSection) heroSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    
    if (e.key === '2') {
      e.preventDefault()
      const resultsSection = document.querySelector('[data-section="results"]')
      if (resultsSection) resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
  }, [onRunSimulation, onShare, onExportMd, onExportCsv, isRunning, hasResults, showHelp])
  
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
  
  return (
    <>
      <ShortcutModal isOpen={showHelp} onClose={() => setShowHelp(false)} />
      
      {/* Keyboard hint in corner */}
      <div className="fixed bottom-4 right-4 z-40 hidden md:block">
        <button
          onClick={() => setShowHelp(true)}
          className="px-3 py-1.5 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.1] rounded-lg 
                     text-white/40 hover:text-white/70 text-sm transition-all duration-200
                     flex items-center gap-2"
          title="Keyboard shortcuts"
        >
          <kbd className="text-xs font-mono">?</kbd>
          <span>Shortcuts</span>
        </button>
      </div>
    </>
  )
}

export function useKeyboardShortcutHint() {
  const [showHint, setShowHint] = useState(false)
  
  useEffect(() => {
    // Show hint after 5 seconds if user hasn't interacted
    const timer = setTimeout(() => setShowHint(true), 5000)
    
    // Hide hint after 10 seconds
    const hideTimer = setTimeout(() => setShowHint(false), 15000)
    
    return () => {
      clearTimeout(timer)
      clearTimeout(hideTimer)
    }
  }, [])
  
  return showHint
}

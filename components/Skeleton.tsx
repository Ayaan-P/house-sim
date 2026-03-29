'use client'

import { useEffect, useState } from 'react'

interface SkeletonProps {
  className?: string
  width?: string | number
  height?: string | number
  rounded?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  animate?: boolean
}

export function Skeleton({ 
  className = '', 
  width, 
  height, 
  rounded = 'lg',
  animate = true 
}: SkeletonProps) {
  const roundedClass = {
    sm: 'rounded-sm',
    md: 'rounded-md',
    lg: 'rounded-lg',
    xl: 'rounded-xl',
    full: 'rounded-full',
  }[rounded]
  
  return (
    <div
      className={`
        bg-white/[0.06] 
        ${animate ? 'animate-pulse' : ''} 
        ${roundedClass}
        ${className}
      `}
      style={{ 
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
      }}
    />
  )
}

// Skeleton for stat cards in results
export function StatSkeleton() {
  return (
    <div className="bg-white/[0.04]/60 rounded-lg p-3 md:p-4 border border-white/[0.08]/50 min-w-0 animate-pulse">
      <Skeleton className="h-3 w-20 mb-2" rounded="md" animate={false} />
      <Skeleton className="h-7 w-24 mb-1" rounded="md" animate={false} />
      <Skeleton className="h-2 w-12 mt-1" rounded="md" animate={false} />
    </div>
  )
}

// Skeleton for charts
export function ChartSkeleton({ height = 256 }: { height?: number }) {
  return (
    <div 
      className="animate-pulse bg-white/[0.02] rounded-xl border border-white/[0.06] flex items-end justify-center gap-2 p-4"
      style={{ height }}
    >
      {/* Animated bars to simulate chart */}
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={i}
          className="bg-white/[0.06] rounded-t flex-1 transition-all duration-500"
          style={{
            height: `${Math.random() * 60 + 20}%`,
            animationDelay: `${i * 50}ms`,
          }}
        />
      ))}
    </div>
  )
}

// Skeleton for histogram
export function HistogramSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* Chart area */}
      <div className="relative">
        <div className="ml-8 h-48 md:h-64 flex items-end gap-[1px] md:gap-0.5 p-4">
          {Array.from({ length: 25 }).map((_, i) => {
            const height = Math.sin((i / 24) * Math.PI) * 80 + 10
            return (
              <div
                key={i}
                className="flex-1 bg-white/[0.08] rounded-t transition-all duration-300"
                style={{ 
                  height: `${height}%`,
                  animationDelay: `${i * 20}ms`,
                }}
              />
            )
          })}
        </div>
        {/* X-axis */}
        <div className="ml-8 flex justify-between mt-2">
          <Skeleton className="h-3 w-16" rounded="md" animate={false} />
          <Skeleton className="h-3 w-32" rounded="md" animate={false} />
          <Skeleton className="h-3 w-16" rounded="md" animate={false} />
        </div>
      </div>
      
      {/* Legend */}
      <div className="flex items-center justify-center gap-4">
        <Skeleton className="h-3 w-24" rounded="md" animate={false} />
        <Skeleton className="h-3 w-24" rounded="md" animate={false} />
      </div>
    </div>
  )
}

// Skeleton for table rows
export function TableRowSkeleton({ columns = 10 }: { columns?: number }) {
  return (
    <tr className="border-b border-gray-800 animate-pulse">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="py-1.5">
          <Skeleton className="h-4 w-16" rounded="md" animate={false} />
        </td>
      ))}
    </tr>
  )
}

export function TableSkeleton({ rows = 10, columns = 10 }: { rows?: number; columns?: number }) {
  return (
    <table className="w-full text-sm animate-pulse">
      <thead>
        <tr className="text-white/60 border-b border-white/[0.08]">
          {Array.from({ length: columns }).map((_, i) => (
            <th key={i} className="text-left py-2">
              <Skeleton className="h-3 w-12" rounded="md" animate={false} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }).map((_, i) => (
          <TableRowSkeleton key={i} columns={columns} />
        ))}
      </tbody>
    </table>
  )
}

// Full results skeleton
export function ResultsSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <StatSkeleton key={i} />
        ))}
      </div>
      
      {/* Chart skeleton */}
      <div className="bg-white/[0.02] rounded-xl border border-white/[0.06] p-4">
        <Skeleton className="h-5 w-48 mb-4" rounded="md" animate={false} />
        <ChartSkeleton height={280} />
      </div>
      
      {/* Second chart */}
      <div className="bg-white/[0.02] rounded-xl border border-white/[0.06] p-4">
        <Skeleton className="h-5 w-64 mb-4" rounded="md" animate={false} />
        <ChartSkeleton height={240} />
      </div>
      
      {/* Histogram skeleton */}
      <div className="bg-white/[0.02] rounded-xl border border-white/[0.06] p-4">
        <Skeleton className="h-5 w-56 mb-4" rounded="md" animate={false} />
        <HistogramSkeleton />
      </div>
    </div>
  )
}

// Progress indicator during simulation
export function SimulationProgress({ 
  progress = 0, 
  total = 10000,
  isRunning = false 
}: { 
  progress?: number
  total?: number
  isRunning?: boolean 
}) {
  const [displayProgress, setDisplayProgress] = useState(0)
  
  useEffect(() => {
    if (!isRunning) {
      setDisplayProgress(0)
      return
    }
    
    // Simulate progress for better UX (actual simulation is synchronous)
    const interval = setInterval(() => {
      setDisplayProgress(prev => {
        // Ease out curve: fast at start, slow near end
        const remaining = 95 - prev
        const increment = remaining * 0.1
        return Math.min(prev + increment, 95)
      })
    }, 50)
    
    return () => clearInterval(interval)
  }, [isRunning])
  
  // Jump to 100% when done
  useEffect(() => {
    if (!isRunning && displayProgress > 0) {
      setDisplayProgress(100)
    }
  }, [isRunning, displayProgress])
  
  if (!isRunning && displayProgress === 0) return null
  
  return (
    <div className="fixed top-0 left-0 right-0 z-50">
      <div 
        className="h-1 bg-gradient-to-r from-blue-500 via-cyan-500 to-blue-500 transition-all duration-300 ease-out"
        style={{ 
          width: `${displayProgress}%`,
          opacity: displayProgress >= 100 ? 0 : 1,
        }}
      />
    </div>
  )
}

// Loading spinner with message
export function LoadingSpinner({ message = 'Running simulation...' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 animate-in fade-in duration-200">
      <div className="relative">
        {/* Outer ring */}
        <div className="w-16 h-16 border-4 border-white/10 rounded-full" />
        {/* Spinning arc */}
        <div className="absolute inset-0 w-16 h-16 border-4 border-transparent border-t-blue-500 rounded-full animate-spin" />
        {/* Inner pulse */}
        <div className="absolute inset-2 w-12 h-12 bg-blue-500/20 rounded-full animate-pulse" />
      </div>
      <p className="mt-4 text-white/60 text-sm animate-pulse">{message}</p>
    </div>
  )
}

// Transition wrapper for smooth enter/exit
export function FadeTransition({ 
  show, 
  children,
  duration = 300,
}: { 
  show: boolean
  children: React.ReactNode
  duration?: number
}) {
  const [shouldRender, setShouldRender] = useState(show)
  const [isVisible, setIsVisible] = useState(show)
  
  useEffect(() => {
    if (show) {
      setShouldRender(true)
      // Small delay to trigger animation
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsVisible(true)
        })
      })
    } else {
      setIsVisible(false)
      const timer = setTimeout(() => setShouldRender(false), duration)
      return () => clearTimeout(timer)
    }
  }, [show, duration])
  
  if (!shouldRender) return null
  
  return (
    <div
      className={`transition-all duration-${duration}`}
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(8px)',
        transitionDuration: `${duration}ms`,
      }}
    >
      {children}
    </div>
  )
}

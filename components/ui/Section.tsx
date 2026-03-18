'use client'

export function Section({ title, children, className = '' }: { 
  title?: string
  children: React.ReactNode
  className?: string 
}) {
  return (
    <div className={`bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 mb-4 ${className}`}>
      {title && <h3 className="text-white/80 font-semibold mb-3">{title}</h3>}
      {children}
    </div>
  )
}

export function Grid({ cols = 2, children, className = '' }: {
  cols?: 2 | 3 | 4 | 6
  children: React.ReactNode
  className?: string
}) {
  const colsClass = {
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-2 md:grid-cols-4',
    6: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6',
  }[cols]
  
  return (
    <div className={`grid ${colsClass} gap-3 ${className}`}>
      {children}
    </div>
  )
}

export function Stat({ label, value, sub, color = 'white' }: {
  label: string
  value: string
  sub?: string
  color?: 'white' | 'green' | 'red' | 'blue'
}) {
  const colorClass = {
    white: 'text-white',
    green: 'text-green-400',
    red: 'text-red-400',
    blue: 'text-blue-400',
  }[color]
  
  return (
    <div className="bg-white/[0.04] rounded-lg p-3 border border-white/[0.08]">
      <div className="text-white/60 text-xs mb-1 truncate">{label}</div>
      <div className={`text-lg md:text-xl font-bold font-mono ${colorClass}`}>{value}</div>
      {sub && <div className="text-white/40 text-xs mt-1">{sub}</div>}
    </div>
  )
}

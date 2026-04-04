'use client'

export function Section({ title, children, className = '' }: {
  title?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`bg-surface-muted border border-border rounded-xl p-4 mb-4 ${className}`}>
      {title && <h3 className="text-content-muted font-semibold mb-3">{title}</h3>}
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

export function Stat({ label, value, sub, color = 'default' }: {
  label: string
  value: string
  sub?: string
  color?: 'default' | 'success' | 'error' | 'info'
}) {
  const colorClass = {
    default: 'text-content',
    success: 'text-success',
    error: 'text-error',
    info: 'text-info',
  }[color]

  return (
    <div className="bg-surface border border-border rounded-lg p-3">
      <div className="text-content-muted text-xs mb-1 truncate">{label}</div>
      <div className={`text-lg md:text-xl font-bold font-mono ${colorClass}`}>{value}</div>
      {sub && <div className="text-content-subtle text-xs mt-1">{sub}</div>}
    </div>
  )
}

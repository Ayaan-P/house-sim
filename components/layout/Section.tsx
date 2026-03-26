import { cn } from '@/lib/utils'

interface SectionProps {
  children: React.ReactNode
  title?: string
  className?: string
}

// Generate stable ID from title for aria-labelledby
function titleToId(title: string): string {
  return `section-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`
}

export function Section({ children, title, className }: SectionProps) {
  const headingId = title ? titleToId(title) : undefined
  
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3 sm:p-5 mb-3 sm:mb-4',
        className
      )}
    >
      {title && (
        <h2 
          id={headingId}
          className="text-xs font-semibold text-[var(--content-subtle)] uppercase tracking-[0.05em] mb-3 sm:mb-4"
        >
          {title}
        </h2>
      )}
      {children}
    </section>
  )
}

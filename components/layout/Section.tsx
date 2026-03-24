import { cn } from '@/lib/utils'

interface SectionProps {
  children: React.ReactNode
  title?: string
  className?: string
}

export function Section({ children, title, className }: SectionProps) {
  return (
    <section
      className={cn(
        'bg-[#111] border border-[#1a1a1a] rounded-xl p-3 sm:p-5 mb-3 sm:mb-4',
        className
      )}
    >
      {title && (
        <h2 className="text-xs font-semibold text-[#666] uppercase tracking-[0.05em] mb-3 sm:mb-4">
          {title}
        </h2>
      )}
      {children}
    </section>
  )
}

import { cn } from '@/lib/utils'

interface PageWrapperProps {
  children: React.ReactNode
  className?: string
  maxWidth?: 'default' | 'wide' | 'narrow'
}

const maxWidthStyles = {
  default: 'max-w-[1000px]',
  wide: 'max-w-[1200px]',
  narrow: 'max-w-[800px]',
}

export function PageWrapper({ children, className, maxWidth = 'default' }: PageWrapperProps) {
  return (
    <main className={cn(
      'mx-auto px-3 sm:px-4 pb-16',
      'pt-[var(--safe-area-inset-top)]',
      maxWidthStyles[maxWidth],
      className
    )}>
      {children}
    </main>
  )
}

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
    <>
      {/* Skip to main content link for keyboard/screen reader users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-blue-600 focus:text-white focus:rounded-lg focus:outline-none focus:ring-2 focus:ring-white"
      >
        Skip to main content
      </a>
      <main 
        id="main-content"
        role="main"
        className={cn(
          'mx-auto px-3 sm:px-4 pb-16',
          'pt-[var(--safe-area-inset-top)]',
          maxWidthStyles[maxWidth],
          className
        )}
      >
        {children}
      </main>
    </>
  )
}

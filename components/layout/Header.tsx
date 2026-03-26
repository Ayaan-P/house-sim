'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import { AuthButton } from '@/components/AuthProvider'
import { UpgradeButton } from '@/components/UpgradeButton'
import { ThemeToggle } from '@/components/theme-toggle'

interface HeaderProps {
  title: string
  backLink?: { href: string; label: string }
  children?: React.ReactNode
  className?: string
  showAuth?: boolean
}

export function Header({ title, backLink, children, className, showAuth = true }: HeaderProps) {
  return (
    <header
      role="banner"
      aria-label={title}
      className={cn(
        'flex flex-col sm:flex-row sm:justify-between sm:items-center py-4 border-b border-[var(--border)] mb-6 gap-3',
        className
      )}
    >
      <div className="flex items-center gap-3 sm:gap-4">
        {backLink && (
          <Link href={backLink.href} className="text-[var(--content-subtle)] no-underline text-sm hover:text-[var(--accent)] transition-colors">
            ← {backLink.label}
          </Link>
        )}
        <h1 className="text-lg sm:text-xl font-semibold text-[var(--content)]">{title}</h1>
      </div>
      <div className="flex items-center gap-3 sm:gap-4 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        {children}
        <ThemeToggle />
        {showAuth && (
          <>
            <UpgradeButton />
            <AuthButton />
          </>
        )}
      </div>
    </header>
  )
}

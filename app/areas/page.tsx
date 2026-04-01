'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Header, PageWrapper, Section } from '@/components/layout'
import { SEARCH_AREAS_STORAGE_KEY, SearchArea, formatAreaLabel } from '@/lib/search-areas'

interface AreaFormState {
  cityOrZip: string
  state: string
  maxPrice: string
  minBeds: string
  minBaths: string
}

const initialForm: AreaFormState = {
  cityOrZip: '',
  state: '',
  maxPrice: '',
  minBeds: '',
  minBaths: '',
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

export default function AreasPage() {
  const [form, setForm] = useState<AreaFormState>(initialForm)
  const [areas, setAreas] = useState<SearchArea[]>([])
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SEARCH_AREAS_STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as SearchArea[]
        setAreas(parsed)
      }
    } catch {
      setAreas([])
    } finally {
      setIsLoaded(true)
    }
  }, [])

  useEffect(() => {
    if (!isLoaded) return
    localStorage.setItem(SEARCH_AREAS_STORAGE_KEY, JSON.stringify(areas))
  }, [areas, isLoaded])

  const hasAreas = areas.length > 0
  const sortedAreas = useMemo(
    () => [...areas].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [areas]
  )

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const maxPrice = Number(form.maxPrice)
    const minBeds = Number(form.minBeds)
    const minBaths = Number(form.minBaths)

    if (!form.cityOrZip.trim() || !form.state.trim() || maxPrice <= 0 || minBeds < 0 || minBaths < 0) {
      return
    }

    const nextArea: SearchArea = {
      id: crypto.randomUUID(),
      cityOrZip: form.cityOrZip.trim(),
      state: form.state.trim().toUpperCase(),
      maxPrice,
      minBeds,
      minBaths,
      createdAt: new Date().toISOString(),
    }

    setAreas(prev => [nextArea, ...prev])
    setForm(initialForm)
  }

  const removeArea = (id: string) => {
    setAreas(prev => prev.filter(area => area.id !== id))
  }

  return (
    <PageWrapper maxWidth="wide">
      <Header title="Search Areas" backLink={{ href: '/', label: 'Simulator' }} showAuth={false}>
        <Link href="/listings" className="text-[var(--accent)] hover:text-[var(--accent-hover)] text-sm transition-colors">
          Listings
        </Link>
      </Header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <Section title="Add Area" className="h-fit">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="cityOrZip" className="block text-sm text-[var(--content-muted)] mb-2">
                City or ZIP
              </label>
              <input
                id="cityOrZip"
                value={form.cityOrZip}
                onChange={event => setForm(prev => ({ ...prev, cityOrZip: event.target.value }))}
                placeholder="Austin or 78704"
                className="themed-input w-full rounded-lg border px-3 py-2.5 outline-none transition-colors"
                required
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="state" className="block text-sm text-[var(--content-muted)] mb-2">
                  State
                </label>
                <input
                  id="state"
                  value={form.state}
                  onChange={event => setForm(prev => ({ ...prev, state: event.target.value }))}
                  placeholder="TX"
                  maxLength={2}
                  className="themed-input w-full rounded-lg border px-3 py-2.5 outline-none transition-colors uppercase"
                  required
                />
              </div>

              <div>
                <label htmlFor="maxPrice" className="block text-sm text-[var(--content-muted)] mb-2">
                  Max price
                </label>
                <input
                  id="maxPrice"
                  type="number"
                  min="1"
                  step="1000"
                  value={form.maxPrice}
                  onChange={event => setForm(prev => ({ ...prev, maxPrice: event.target.value }))}
                  placeholder="750000"
                  className="themed-input w-full rounded-lg border px-3 py-2.5 outline-none transition-colors"
                  required
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="minBeds" className="block text-sm text-[var(--content-muted)] mb-2">
                  Min beds
                </label>
                <input
                  id="minBeds"
                  type="number"
                  min="0"
                  step="1"
                  value={form.minBeds}
                  onChange={event => setForm(prev => ({ ...prev, minBeds: event.target.value }))}
                  placeholder="3"
                  className="themed-input w-full rounded-lg border px-3 py-2.5 outline-none transition-colors"
                  required
                />
              </div>

              <div>
                <label htmlFor="minBaths" className="block text-sm text-[var(--content-muted)] mb-2">
                  Min baths
                </label>
                <input
                  id="minBaths"
                  type="number"
                  min="0"
                  step="0.5"
                  value={form.minBaths}
                  onChange={event => setForm(prev => ({ ...prev, minBaths: event.target.value }))}
                  placeholder="2"
                  className="themed-input w-full rounded-lg border px-3 py-2.5 outline-none transition-colors"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
            >
              Save Area
            </button>
          </form>
        </Section>

        <Section title="Saved Areas">
          {!isLoaded ? (
            <p className="text-sm text-[var(--content-subtle)]">Loading saved areas...</p>
          ) : !hasAreas ? (
            <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-muted)]/40 px-4 py-8 text-center">
              <p className="text-sm text-[var(--content-muted)]">No search areas saved yet.</p>
              <p className="mt-2 text-sm text-[var(--content-subtle)]">
                Add an area above, then use it to filter sample listings.
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {sortedAreas.map(area => (
                <article
                  key={area.id}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 transition-colors hover:bg-[var(--surface-muted)]/40"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-[var(--content)]">{formatAreaLabel(area)}</h2>
                      <p className="mt-1 text-sm text-[var(--content-muted)]">
                        Up to {formatCurrency(area.maxPrice)} • {area.minBeds}+ bd • {area.minBaths}+ ba
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <Link
                        href={`/listings?area=${encodeURIComponent(area.id)}`}
                        className="text-sm text-[var(--accent)] transition-colors hover:text-[var(--accent-hover)]"
                      >
                        View listings
                      </Link>
                      <button
                        type="button"
                        onClick={() => removeArea(area.id)}
                        className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--content-muted)] transition-colors hover:border-red-400/40 hover:text-red-400"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Section>
      </div>
    </PageWrapper>
  )
}

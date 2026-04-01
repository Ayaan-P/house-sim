'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { Header, PageWrapper, Section } from '@/components/layout'
import { SEARCH_AREAS_STORAGE_KEY, SearchArea, formatAreaLabel } from '@/lib/search-areas'

interface SampleListing {
  id: string
  address: string
  city: string
  state: string
  zip: string
  price: number
  beds: number
  baths: number
  score: number
  estimatedRent: number
}

const sampleListings: SampleListing[] = [
  { id: '78704-barton', address: '1702 Barton Hills Dr', city: 'Austin', state: 'TX', zip: '78704', price: 745000, beds: 3, baths: 2.5, score: 82, estimatedRent: 3650 },
  { id: '78704-south', address: '2411 Del Curto Rd', city: 'Austin', state: 'TX', zip: '78704', price: 698000, beds: 3, baths: 2, score: 77, estimatedRent: 3425 },
  { id: '98103-phinney', address: '7312 Linden Ave N', city: 'Seattle', state: 'WA', zip: '98103', price: 889000, beds: 4, baths: 2.5, score: 79, estimatedRent: 4100 },
  { id: '60618-avondale', address: '3124 N Albany Ave', city: 'Chicago', state: 'IL', zip: '60618', price: 615000, beds: 3, baths: 2, score: 84, estimatedRent: 3150 },
  { id: '80211-highlands', address: '4421 Wyandot St', city: 'Denver', state: 'CO', zip: '80211', price: 779000, beds: 4, baths: 3, score: 80, estimatedRent: 3500 },
  { id: '11215-park', address: '389 14th St', city: 'Brooklyn', state: 'NY', zip: '11215', price: 1295000, beds: 3, baths: 2, score: 74, estimatedRent: 5200 },
]

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

function ListingsContent() {
  const searchParams = useSearchParams()
  const [areas, setAreas] = useState<SearchArea[]>([])
  const [selectedAreaId, setSelectedAreaId] = useState('all')
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SEARCH_AREAS_STORAGE_KEY)
      if (stored) {
        setAreas(JSON.parse(stored) as SearchArea[])
      }
    } catch {
      setAreas([])
    } finally {
      setIsLoaded(true)
    }
  }, [])

  useEffect(() => {
    const requestedArea = searchParams.get('area')
    if (requestedArea) {
      setSelectedAreaId(requestedArea)
    }
  }, [searchParams])

  const areaOptions = useMemo(
    () => [
      { id: 'all', label: 'All sample listings' },
      ...areas.map(area => ({ id: area.id, label: formatAreaLabel(area) })),
    ],
    [areas]
  )

  const selectedArea = useMemo(
    () => areas.find(area => area.id === selectedAreaId) ?? null,
    [areas, selectedAreaId]
  )

  const filteredListings = useMemo(() => {
    if (!selectedArea) return sampleListings

    const areaQuery = selectedArea.cityOrZip.trim().toLowerCase()
    const stateQuery = selectedArea.state.trim().toLowerCase()

    return sampleListings.filter(listing => {
      const cityMatches = listing.city.toLowerCase() === areaQuery
      const zipMatches = listing.zip === selectedArea.cityOrZip.trim()
      const stateMatches = listing.state.toLowerCase() === stateQuery

      return (
        stateMatches &&
        (cityMatches || zipMatches) &&
        listing.price <= selectedArea.maxPrice &&
        listing.beds >= selectedArea.minBeds &&
        listing.baths >= selectedArea.minBaths
      )
    })
  }, [selectedArea])

  return (
    <PageWrapper maxWidth="wide">
      <Header title="Listings" backLink={{ href: '/', label: 'Simulator' }} showAuth={false}>
        <Link href="/areas" className="text-[var(--accent)] hover:text-[var(--accent-hover)] text-sm transition-colors">
          Areas
        </Link>
      </Header>

      <Section title="Scanner Results">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-[var(--content)]">Sample scanned listings</h2>
            <p className="mt-1 text-sm text-[var(--content-muted)]">
              Mock data for the future listing scanner. Filter against saved search areas when available.
            </p>
          </div>

          <div className="w-full sm:max-w-xs">
            <label htmlFor="areaFilter" className="mb-2 block text-sm text-[var(--content-muted)]">
              Filter by area
            </label>
            <select
              id="areaFilter"
              value={selectedAreaId}
              onChange={event => setSelectedAreaId(event.target.value)}
              className="themed-input w-full rounded-lg border px-3 py-2.5 outline-none transition-colors"
            >
              {areaOptions.map(option => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {!isLoaded ? (
          <p className="mt-6 text-sm text-[var(--content-subtle)]">Loading saved areas...</p>
        ) : filteredListings.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-muted)]/40 px-4 py-8 text-center">
            <p className="text-sm text-[var(--content-muted)]">No sample listings match this area yet.</p>
            <p className="mt-2 text-sm text-[var(--content-subtle)]">
              Adjust the saved area in <Link href="/areas" className="text-[var(--accent)] hover:text-[var(--accent-hover)]">Areas</Link> or clear the filter.
            </p>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {filteredListings.map(listing => {
              const simParams = new URLSearchParams({
                price: String(listing.price),
                rent: String(listing.estimatedRent),
                down: '20',
                years: '10',
              })

              return (
                <article
                  key={listing.id}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[var(--content-subtle)]/40"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--content-subtle)]">
                        {listing.city}, {listing.state} {listing.zip}
                      </p>
                      <h3 className="mt-2 text-lg font-semibold text-[var(--content)]">{listing.address}</h3>
                    </div>
                    <div className="rounded-full bg-[var(--surface-muted)] px-3 py-1 text-sm font-semibold text-[var(--content)]">
                      Score {listing.score}
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-3 text-sm text-[var(--content-muted)]">
                    <span className="rounded-lg bg-[var(--surface-muted)] px-3 py-2 font-medium text-[var(--content)]">
                      {formatCurrency(listing.price)}
                    </span>
                    <span>{listing.beds} bd</span>
                    <span>{listing.baths} ba</span>
                    <span>Rent est. {formatCurrency(listing.estimatedRent)}/mo</span>
                  </div>

                  <div className="mt-5 flex items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
                    <p className="text-sm text-[var(--content-subtle)]">
                      {selectedArea ? `Matched to ${formatAreaLabel(selectedArea)}.` : 'Showing the full sample feed.'}
                    </p>
                    <Link
                      href={`/?${simParams.toString()}`}
                      className="rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
                    >
                      Run simulation
                    </Link>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </Section>
    </PageWrapper>
  )
}

export default function ListingsPage() {
  return (
    <Suspense
      fallback={
        <PageWrapper maxWidth="wide">
          <Header title="Listings" backLink={{ href: '/', label: 'Simulator' }} showAuth={false} />
          <div className="py-12 text-center text-[var(--content-subtle)]">Loading listings...</div>
        </PageWrapper>
      }
    >
      <ListingsContent />
    </Suspense>
  )
}

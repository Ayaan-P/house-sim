export const SEARCH_AREAS_STORAGE_KEY = 'house-sim-search-areas'

export interface SearchArea {
  id: string
  cityOrZip: string
  state: string
  maxPrice: number
  minBeds: number
  minBaths: number
  createdAt: string
}

export function formatAreaLabel(area: Pick<SearchArea, 'cityOrZip' | 'state'>): string {
  return `${area.cityOrZip}, ${area.state.toUpperCase()}`
}

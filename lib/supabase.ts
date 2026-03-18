import { createClient, SupabaseClient, User, Session } from '@supabase/supabase-js'

// Supabase credentials - using Dytto's shared Supabase instance
const SUPABASE_URL = 'https://qbuhjokiwkfuphboihug.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFidWhqb2tpd2tmdXBoYm9paHVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzkzMTMxMDMsImV4cCI6MjA1NDg4OTEwM30.QKQtvxo6pI9ItJHSM4d2p5tGvVUeAMNXxlnwG_7k9kk'

// Create Supabase client singleton
let supabase: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  }
  return supabase
}

// Auth helpers
export async function signInWithGoogle(): Promise<void> {
  const supabase = getSupabase()
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
    },
  })
  if (error) throw error
}

export async function signOut(): Promise<void> {
  const supabase = getSupabase()
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function getUser(): Promise<User | null> {
  const supabase = getSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function getSession(): Promise<Session | null> {
  const supabase = getSupabase()
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

// Database types
export interface Subscription {
  id: string
  user_id: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  status: 'free' | 'active' | 'past_due' | 'canceled' | 'trialing'
  current_period_end: string | null
  created_at: string
  updated_at: string
}

export interface Area {
  id: string
  user_id: string
  name: string
  property_types: string[]
  price_min: number | null
  price_max: number | null
  zip_codes: string[] | null
  city: string | null
  state: string | null
  created_at: string
  updated_at: string
}

export interface Listing {
  id: string
  area_id: string | null
  address: string
  city: string
  state: string
  zip_code: string | null
  price: number
  property_type: string | null
  bedrooms: number | null
  bathrooms: number | null
  sqft: number | null
  year_built: number | null
  win_rate: number | null
  p10_delta: number | null
  p50_delta: number | null
  p90_delta: number | null
  expected_value: number | null
  sim_params: Record<string, any> | null
  sim_run_at: string | null
  listing_url: string | null
  mls_id: string | null
  created_at: string
  updated_at: string
}

export interface UserListing {
  id: string
  user_id: string
  listing_id: string
  status: 'watching' | 'interested' | 'applied' | 'rejected' | 'won' | 'lost'
  notes: string | null
  custom_sim_params: Record<string, any> | null
  created_at: string
  updated_at: string
}

export interface Scenario {
  id: string
  user_id: string
  name: string
  description: string | null
  params: Record<string, any>
  results: Record<string, any> | null
  listing_id: string | null
  created_at: string
  updated_at: string
}

// Database helpers
export async function getUserSubscription(userId: string): Promise<Subscription | null> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('house_sim_subscriptions')
    .select('*')
    .eq('user_id', userId)
    .single()
  
  if (error && error.code !== 'PGRST116') throw error // PGRST116 = no rows
  return data
}

export async function createOrUpdateSubscription(subscription: Partial<Subscription> & { user_id: string }): Promise<Subscription> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('house_sim_subscriptions')
    .upsert(subscription, { onConflict: 'user_id' })
    .select()
    .single()
  
  if (error) throw error
  return data
}

export async function getUserAreas(userId: string): Promise<Area[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('house_sim_areas')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  
  if (error) throw error
  return data || []
}

export async function createArea(area: Omit<Area, 'id' | 'created_at' | 'updated_at'>): Promise<Area> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('house_sim_areas')
    .insert(area)
    .select()
    .single()
  
  if (error) throw error
  return data
}

export async function getUserScenarios(userId: string): Promise<Scenario[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('house_sim_scenarios')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  
  if (error) throw error
  return data || []
}

export async function saveScenario(scenario: Omit<Scenario, 'id' | 'created_at' | 'updated_at'>): Promise<Scenario> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('house_sim_scenarios')
    .insert(scenario)
    .select()
    .single()
  
  if (error) throw error
  return data
}

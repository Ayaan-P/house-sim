'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { User, Session, AuthChangeEvent } from '@supabase/supabase-js'
import { getSupabase, signInWithGoogle, signOut as supabaseSignOut, Subscription, getUserSubscription, createOrUpdateSubscription } from '@/lib/supabase'

interface AuthContextType {
  user: User | null
  session: Session | null
  subscription: Subscription | null
  loading: boolean
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  isPro: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = getSupabase()

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        loadSubscription(session.user.id)
      }
      setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription: authSubscription } } = supabase.auth.onAuthStateChange(
      async (event: AuthChangeEvent, session: Session | null) => {
        setSession(session)
        setUser(session?.user ?? null)
        
        if (session?.user) {
          await loadSubscription(session.user.id)
        } else {
          setSubscription(null)
        }
        
        setLoading(false)
      }
    )

    return () => {
      authSubscription.unsubscribe()
    }
  }, [])

  const loadSubscription = async (userId: string) => {
    try {
      let sub = await getUserSubscription(userId)
      
      // Create default free subscription if none exists
      if (!sub) {
        sub = await createOrUpdateSubscription({
          user_id: userId,
          status: 'free',
        })
      }
      
      setSubscription(sub)
    } catch (error) {
      console.error('Error loading subscription:', error)
      // Set a default free subscription on error
      setSubscription({
        id: '',
        user_id: userId,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        status: 'free',
        current_period_end: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    }
  }

  const signIn = async () => {
    setLoading(true)
    try {
      await signInWithGoogle()
    } catch (error) {
      console.error('Sign in error:', error)
      setLoading(false)
    }
  }

  const signOut = async () => {
    setLoading(true)
    try {
      await supabaseSignOut()
      setSubscription(null)
    } catch (error) {
      console.error('Sign out error:', error)
    }
    setLoading(false)
  }

  const isPro = subscription?.status === 'active' || subscription?.status === 'trialing'

  return (
    <AuthContext.Provider value={{
      user,
      session,
      subscription,
      loading,
      signIn,
      signOut,
      isPro,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

// Simple auth button component
export function AuthButton() {
  const { user, loading, signIn, signOut } = useAuth()

  if (loading) {
    return (
      <button
        disabled
        className="px-4 py-2 text-sm font-medium text-gray-400 bg-gray-800 rounded-lg"
      >
        Loading...
      </button>
    )
  }

  if (user) {
    return (
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          {user.user_metadata?.avatar_url && (
            <img
              src={user.user_metadata.avatar_url}
              alt="Avatar"
              className="w-8 h-8 rounded-full"
            />
          )}
          <span className="text-sm text-gray-300">
            {user.user_metadata?.full_name || user.email}
          </span>
        </div>
        <button
          onClick={signOut}
          className="px-4 py-2 text-sm font-medium text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
        >
          Sign Out
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={signIn}
      className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
    >
      <svg className="w-5 h-5" viewBox="0 0 24 24">
        <path
          fill="currentColor"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        />
        <path
          fill="currentColor"
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        />
        <path
          fill="currentColor"
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        />
        <path
          fill="currentColor"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        />
      </svg>
      Sign in with Google
    </button>
  )
}

import { NextRequest, NextResponse } from 'next/server'
import { createBillingPortalSession } from '@/lib/stripe'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://qbuhjokiwkfuphboihug.supabase.co'
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY!

export async function POST(request: NextRequest) {
  try {
    // Get the user from the auth header
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const token = authHeader.substring(7)
    
    // Verify the user with Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false }
    })
    
    const { data: { user }, error: userError } = await supabase.auth.getUser(token)
    
    if (userError || !user) {
      return NextResponse.json(
        { error: 'Invalid session' },
        { status: 401 }
      )
    }

    // Get the user's subscription
    const { data: subscription } = await supabase
      .from('house_sim_subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .single()

    if (!subscription?.stripe_customer_id) {
      return NextResponse.json(
        { error: 'No active subscription found' },
        { status: 400 }
      )
    }

    // Get the origin for return URL
    const origin = request.headers.get('origin') || 'http://localhost:3000'
    
    // Create billing portal session
    const session = await createBillingPortalSession({
      customerId: subscription.stripe_customer_id,
      returnUrl: origin,
    })

    return NextResponse.json({
      url: session.url,
    })
  } catch (error) {
    console.error('Billing portal error:', error)
    return NextResponse.json(
      { error: 'Failed to create billing portal session' },
      { status: 500 }
    )
  }
}

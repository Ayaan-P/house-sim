import { NextRequest, NextResponse } from 'next/server'
import { stripe, getStripeWebhookSecret } from '@/lib/stripe'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://qbuhjokiwkfuphboihug.supabase.co'
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY!

// Type for subscription with the fields we need
interface StripeSubscription {
  id: string
  customer: string
  status: string
  current_period_end: number
  metadata?: { userId?: string }
}

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json(
      { error: 'Missing stripe-signature header' },
      { status: 400 }
    )
  }

  let event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      getStripeWebhookSecret()
    )
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 400 }
    )
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false }
  })

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as { 
          client_reference_id?: string
          metadata?: { userId?: string }
          subscription?: string
          customer?: string
        }
        const userId = session.client_reference_id || session.metadata?.userId
        
        if (!userId) {
          console.error('No user ID in checkout session')
          break
        }

        // Get the subscription details
        const subscriptionId = session.subscription as string
        const subscription = await stripe.subscriptions.retrieve(subscriptionId) as unknown as StripeSubscription

        // Update or create subscription record
        const { error } = await supabase
          .from('house_sim_subscriptions')
          .upsert({
            user_id: userId,
            stripe_customer_id: session.customer as string,
            stripe_subscription_id: subscriptionId,
            status: 'active',
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' })

        if (error) {
          console.error('Failed to update subscription:', error)
        } else {
          console.log(`Subscription activated for user ${userId}`)
        }
        break
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as unknown as StripeSubscription
        const userId = subscription.metadata?.userId

        // Map Stripe status to our status
        const mapStatus = (stripeStatus: string): 'active' | 'past_due' | 'canceled' | 'trialing' => {
          if (stripeStatus === 'past_due') return 'past_due'
          if (stripeStatus === 'canceled' || stripeStatus === 'unpaid') return 'canceled'
          if (stripeStatus === 'trialing') return 'trialing'
          return 'active'
        }

        const status = mapStatus(subscription.status)

        if (!userId) {
          // Try to find by customer ID
          const customerId = subscription.customer
          const { data: existingSub } = await supabase
            .from('house_sim_subscriptions')
            .select('user_id')
            .eq('stripe_customer_id', customerId)
            .single()

          if (!existingSub) {
            console.error('Could not find user for subscription update')
            break
          }

          const { error } = await supabase
            .from('house_sim_subscriptions')
            .update({
              status,
              current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('stripe_customer_id', customerId)

          if (error) {
            console.error('Failed to update subscription:', error)
          }
        } else {
          const { error } = await supabase
            .from('house_sim_subscriptions')
            .update({
              status,
              current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('user_id', userId)

          if (error) {
            console.error('Failed to update subscription:', error)
          }
        }
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as unknown as StripeSubscription
        const customerId = subscription.customer

        const { error } = await supabase
          .from('house_sim_subscriptions')
          .update({
            status: 'canceled',
            stripe_subscription_id: null,
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_customer_id', customerId)

        if (error) {
          console.error('Failed to mark subscription as canceled:', error)
        } else {
          console.log(`Subscription canceled for customer ${customerId}`)
        }
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as { customer?: string }
        const customerId = invoice.customer

        if (customerId) {
          const { error } = await supabase
            .from('house_sim_subscriptions')
            .update({
              status: 'past_due',
              updated_at: new Date().toISOString(),
            })
            .eq('stripe_customer_id', customerId)

          if (error) {
            console.error('Failed to mark subscription as past_due:', error)
          }
        }
        break
      }

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Webhook processing error:', error)
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    )
  }
}

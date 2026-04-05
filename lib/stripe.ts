import Stripe from 'stripe'

// HouseSim Pro pricing
export const HOUSESIM_PRO_PRICE_ID = process.env.STRIPE_PRICE_ID || 'price_housesim_pro' // Will be set after creating product

// Lazy-initialize Stripe to avoid build-time errors when env vars aren't available
let _stripe: Stripe | null = null

export function getStripe(): Stripe {
  if (!_stripe) {
    const secretKey = process.env.STRIPE_SECRET_KEY
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is not set')
    }
    _stripe = new Stripe(secretKey, {
      // @ts-expect-error - using latest API
      apiVersion: '2025-02-24.acacia',
    })
  }
  return _stripe
}

export function getStripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    throw new Error('STRIPE_WEBHOOK_SECRET environment variable is not set')
  }
  return secret
}

// Create a Stripe checkout session for HouseSim Pro subscription
export async function createCheckoutSession(params: {
  userId: string
  userEmail: string
  customerId?: string
  successUrl: string
  cancelUrl: string
}): Promise<Stripe.Checkout.Session> {
  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'HouseSim Pro',
            description: 'Unlimited simulations, saved scenarios, and premium features',
          },
          unit_amount: 1000, // $10.00
          recurring: {
            interval: 'month',
          },
        },
        quantity: 1,
      },
    ],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    client_reference_id: params.userId,
    customer_email: params.customerId ? undefined : params.userEmail,
    metadata: {
      userId: params.userId,
    },
    subscription_data: {
      metadata: {
        userId: params.userId,
      },
    },
  }

  // If customer already exists, use their ID
  if (params.customerId) {
    sessionParams.customer = params.customerId
  }

  return getStripe().checkout.sessions.create(sessionParams)
}

// Get or create a Stripe customer for a user
export async function getOrCreateCustomer(params: {
  email: string
  userId: string
  name?: string
}): Promise<Stripe.Customer> {
  // Check if customer already exists
  const customers = await getStripe().customers.list({
    email: params.email,
    limit: 1,
  })

  if (customers.data.length > 0) {
    return customers.data[0]
  }

  // Create new customer
  return getStripe().customers.create({
    email: params.email,
    name: params.name,
    metadata: {
      userId: params.userId,
    },
  })
}

// Retrieve a subscription by ID
export async function getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  return getStripe().subscriptions.retrieve(subscriptionId)
}

// Cancel a subscription
export async function cancelSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  return getStripe().subscriptions.cancel(subscriptionId)
}

// Create a billing portal session for managing subscription
export async function createBillingPortalSession(params: {
  customerId: string
  returnUrl: string
}): Promise<Stripe.BillingPortal.Session> {
  return getStripe().billingPortal.sessions.create({
    customer: params.customerId,
    return_url: params.returnUrl,
  })
}

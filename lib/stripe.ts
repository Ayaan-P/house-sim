import Stripe from 'stripe'

// Stripe configuration
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY!
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!

// HouseSim Pro pricing
export const HOUSESIM_PRO_PRICE_ID = process.env.STRIPE_PRICE_ID || 'price_housesim_pro' // Will be set after creating product

export const stripe = new Stripe(STRIPE_SECRET_KEY, {
  // @ts-expect-error - using latest API
  apiVersion: '2025-02-24.acacia',
})

export function getStripeWebhookSecret(): string {
  return STRIPE_WEBHOOK_SECRET
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

  return stripe.checkout.sessions.create(sessionParams)
}

// Get or create a Stripe customer for a user
export async function getOrCreateCustomer(params: {
  email: string
  userId: string
  name?: string
}): Promise<Stripe.Customer> {
  // Check if customer already exists
  const customers = await stripe.customers.list({
    email: params.email,
    limit: 1,
  })

  if (customers.data.length > 0) {
    return customers.data[0]
  }

  // Create new customer
  return stripe.customers.create({
    email: params.email,
    name: params.name,
    metadata: {
      userId: params.userId,
    },
  })
}

// Retrieve a subscription by ID
export async function getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  return stripe.subscriptions.retrieve(subscriptionId)
}

// Cancel a subscription
export async function cancelSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  return stripe.subscriptions.cancel(subscriptionId)
}

// Create a billing portal session for managing subscription
export async function createBillingPortalSession(params: {
  customerId: string
  returnUrl: string
}): Promise<Stripe.BillingPortal.Session> {
  return stripe.billingPortal.sessions.create({
    customer: params.customerId,
    return_url: params.returnUrl,
  })
}

-- HouseSim Database Schema Migration
-- Run via Supabase SQL Editor or CLI
-- Created: 2026-03-18

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- 1. house_sim_subscriptions
-- Tracks user subscription status via Stripe
-- ============================================
CREATE TABLE IF NOT EXISTS house_sim_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    status TEXT NOT NULL DEFAULT 'free' CHECK (status IN ('free', 'active', 'past_due', 'canceled', 'trialing')),
    current_period_end TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id)
);

-- Index for fast subscription lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON house_sim_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON house_sim_subscriptions(stripe_customer_id);

-- RLS for subscriptions
ALTER TABLE house_sim_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscription"
    ON house_sim_subscriptions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own subscription"
    ON house_sim_subscriptions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own subscription"
    ON house_sim_subscriptions FOR UPDATE
    USING (auth.uid() = user_id);

-- ============================================
-- 2. house_sim_areas
-- Saved search areas (zip codes, cities, regions)
-- ============================================
CREATE TABLE IF NOT EXISTS house_sim_areas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    property_types TEXT[] DEFAULT ARRAY['single_family', 'condo', 'townhouse'],
    price_min INTEGER,
    price_max INTEGER,
    zip_codes TEXT[],
    city TEXT,
    state TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_areas_user_id ON house_sim_areas(user_id);

ALTER TABLE house_sim_areas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own areas"
    ON house_sim_areas FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own areas"
    ON house_sim_areas FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own areas"
    ON house_sim_areas FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own areas"
    ON house_sim_areas FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================
-- 3. house_sim_listings
-- Individual property listings with sim data
-- ============================================
CREATE TABLE IF NOT EXISTS house_sim_listings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    area_id UUID REFERENCES house_sim_areas(id) ON DELETE SET NULL,
    address TEXT NOT NULL,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    zip_code TEXT,
    price INTEGER NOT NULL,
    property_type TEXT,
    bedrooms INTEGER,
    bathrooms NUMERIC(3,1),
    sqft INTEGER,
    year_built INTEGER,
    -- Monte Carlo simulation results
    win_rate NUMERIC(5,2),          -- % of simulations where buy wins
    p10_delta INTEGER,               -- 10th percentile outcome
    p50_delta INTEGER,               -- median outcome
    p90_delta INTEGER,               -- 90th percentile outcome
    expected_value INTEGER,          -- average outcome
    sim_params JSONB,                -- params used for simulation
    sim_run_at TIMESTAMPTZ,
    -- Listing metadata
    listing_url TEXT,
    mls_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listings_area_id ON house_sim_listings(area_id);
CREATE INDEX IF NOT EXISTS idx_listings_city_state ON house_sim_listings(city, state);
CREATE INDEX IF NOT EXISTS idx_listings_price ON house_sim_listings(price);

-- Listings are tied to areas which are user-owned, so RLS works through that
ALTER TABLE house_sim_listings ENABLE ROW LEVEL SECURITY;

-- Users can view listings in their areas
CREATE POLICY "Users can view listings in their areas"
    ON house_sim_listings FOR SELECT
    USING (
        area_id IN (SELECT id FROM house_sim_areas WHERE user_id = auth.uid())
        OR area_id IS NULL
    );

CREATE POLICY "Users can insert listings to their areas"
    ON house_sim_listings FOR INSERT
    WITH CHECK (
        area_id IN (SELECT id FROM house_sim_areas WHERE user_id = auth.uid())
    );

CREATE POLICY "Users can update listings in their areas"
    ON house_sim_listings FOR UPDATE
    USING (
        area_id IN (SELECT id FROM house_sim_areas WHERE user_id = auth.uid())
    );

CREATE POLICY "Users can delete listings in their areas"
    ON house_sim_listings FOR DELETE
    USING (
        area_id IN (SELECT id FROM house_sim_areas WHERE user_id = auth.uid())
    );

-- ============================================
-- 4. house_sim_user_listings
-- User's saved/tracked listings with personal notes
-- ============================================
CREATE TABLE IF NOT EXISTS house_sim_user_listings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    listing_id UUID NOT NULL REFERENCES house_sim_listings(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'watching' CHECK (status IN ('watching', 'interested', 'applied', 'rejected', 'won', 'lost')),
    notes TEXT,
    custom_sim_params JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, listing_id)
);

CREATE INDEX IF NOT EXISTS idx_user_listings_user_id ON house_sim_user_listings(user_id);
CREATE INDEX IF NOT EXISTS idx_user_listings_listing_id ON house_sim_user_listings(listing_id);
CREATE INDEX IF NOT EXISTS idx_user_listings_status ON house_sim_user_listings(status);

ALTER TABLE house_sim_user_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own user_listings"
    ON house_sim_user_listings FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own user_listings"
    ON house_sim_user_listings FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own user_listings"
    ON house_sim_user_listings FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own user_listings"
    ON house_sim_user_listings FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================
-- 5. house_sim_scenarios
-- Saved simulation scenarios/configurations
-- ============================================
CREATE TABLE IF NOT EXISTS house_sim_scenarios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    params JSONB NOT NULL,            -- full simulation parameters
    results JSONB,                     -- cached results
    listing_id UUID REFERENCES house_sim_listings(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scenarios_user_id ON house_sim_scenarios(user_id);
CREATE INDEX IF NOT EXISTS idx_scenarios_listing_id ON house_sim_scenarios(listing_id);

ALTER TABLE house_sim_scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own scenarios"
    ON house_sim_scenarios FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own scenarios"
    ON house_sim_scenarios FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own scenarios"
    ON house_sim_scenarios FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own scenarios"
    ON house_sim_scenarios FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================
-- Updated_at trigger function
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to all tables
CREATE TRIGGER update_subscriptions_updated_at
    BEFORE UPDATE ON house_sim_subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_areas_updated_at
    BEFORE UPDATE ON house_sim_areas
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_listings_updated_at
    BEFORE UPDATE ON house_sim_listings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_listings_updated_at
    BEFORE UPDATE ON house_sim_user_listings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_scenarios_updated_at
    BEFORE UPDATE ON house_sim_scenarios
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Grant permissions to authenticated users
-- ============================================
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON house_sim_subscriptions TO authenticated;
GRANT ALL ON house_sim_areas TO authenticated;
GRANT ALL ON house_sim_listings TO authenticated;
GRANT ALL ON house_sim_user_listings TO authenticated;
GRANT ALL ON house_sim_scenarios TO authenticated;

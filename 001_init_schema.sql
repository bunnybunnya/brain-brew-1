-- ============================================================
-- Meat Delivery Marketplace - Initial schema (PostgreSQL)
-- No seed/fake data. All business data is created via the app.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- for gen_random_uuid()

-- ---------- ENUM TYPES ----------
CREATE TYPE user_role AS ENUM ('customer', 'shop_owner', 'delivery_partner', 'admin');
CREATE TYPE account_status AS ENUM ('active', 'suspended', 'disabled');
CREATE TYPE shop_status AS ENUM ('pending', 'approved', 'rejected', 'suspended');
CREATE TYPE dp_status AS ENUM ('pending', 'approved', 'rejected', 'correction_requested', 'suspended', 'disabled');
CREATE TYPE doc_type AS ENUM ('selfie', 'driving_licence', 'rc');
CREATE TYPE order_status AS ENUM (
  'placed', 'accepted', 'rejected', 'cancelled',
  'preparing', 'ready_for_pickup', 'assigned',
  'picked_up', 'out_for_delivery', 'delivered'
);
CREATE TYPE delivery_status AS ENUM (
  'assigned', 'reached_pickup', 'picked_up', 'out_for_delivery', 'delivered', 'cancelled'
);
CREATE TYPE payment_method AS ENUM ('cod'); -- Cash on Delivery only (per platform config)
CREATE TYPE payment_status AS ENUM ('pending', 'collected');
CREATE TYPE otp_purpose AS ENUM ('signup', 'login', 'password_reset');

-- ---------- CORE AUTH TABLE ----------
-- One row per person regardless of role; role-specific detail lives in
-- customers / shop_owners / delivery_partners.
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role            user_role NOT NULL,
  name            VARCHAR(150) NOT NULL,
  mobile          VARCHAR(15) UNIQUE,
  email           VARCHAR(150) UNIQUE,
  password_hash   TEXT NOT NULL,
  mobile_verified BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  status          account_status NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mobile_or_email CHECK (mobile IS NOT NULL OR email IS NOT NULL)
);
CREATE INDEX idx_users_role ON users(role);

-- ---------- CUSTOMERS ----------
CREATE TABLE customers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE addresses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label         VARCHAR(50),            -- e.g. Home, Work
  address_line  TEXT NOT NULL,
  city          VARCHAR(100) NOT NULL DEFAULT 'Srikakulam',
  state         VARCHAR(100) NOT NULL DEFAULT 'Andhra Pradesh',
  pincode       VARCHAR(10),
  latitude      NUMERIC(9,6),
  longitude     NUMERIC(9,6),
  is_default    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_addresses_customer ON addresses(customer_id);

-- ---------- SHOP OWNERS & SHOPS ----------
CREATE TABLE shop_owners (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE shops (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES shop_owners(id) ON DELETE CASCADE,
  name          VARCHAR(150) NOT NULL,
  description   TEXT,
  logo_url      TEXT,
  phone         VARCHAR(15) NOT NULL,
  address_line  TEXT NOT NULL,
  city          VARCHAR(100) NOT NULL DEFAULT 'Srikakulam',
  state         VARCHAR(100) NOT NULL DEFAULT 'Andhra Pradesh',
  pincode       VARCHAR(10),
  latitude      NUMERIC(9,6),
  longitude     NUMERIC(9,6),
  status        shop_status NOT NULL DEFAULT 'pending', -- admin approval required
  is_open       BOOLEAN NOT NULL DEFAULT FALSE,          -- owner-controlled open/closed
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_shops_owner ON shops(owner_id);
CREATE INDEX idx_shops_status ON shops(status);
CREATE INDEX idx_shops_city ON shops(city);

-- ---------- PRODUCTS & VARIANTS ----------
-- Every price/quantity is entered by the shop owner. Nothing hard-coded.
CREATE TABLE products (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name          VARCHAR(150) NOT NULL,
  description   TEXT,
  image_url     TEXT,
  is_available  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_products_shop ON products(shop_id);

-- A product can have multiple cut/type options, each with its own
-- shop-owner-entered price and stock.
CREATE TABLE product_variants (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id         UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  cut_type           VARCHAR(100) NOT NULL,   -- e.g. "Curry Cut", "Boneless", entered by shop
  unit               VARCHAR(20) NOT NULL DEFAULT 'kg', -- kg, g, piece etc.
  price              NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  quantity_available NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (quantity_available >= 0),
  is_available       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_variants_product ON product_variants(product_id);

-- ---------- DELIVERY PARTNERS ----------
CREATE TABLE delivery_partners (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  dp_code             VARCHAR(20) UNIQUE,        -- e.g. DP-000001, assigned on approval
  date_of_birth       DATE,
  address_line        TEXT,
  selfie_url          TEXT,
  driving_licence_no  VARCHAR(50),
  rc_number           VARCHAR(50),
  vehicle_type        VARCHAR(50),               -- bike, scooter, auto, etc.
  vehicle_number      VARCHAR(20),
  bank_account_info   JSONB,                     -- encrypted at rest by DB/storage layer
  status              dp_status NOT NULL DEFAULT 'pending',
  is_online           BOOLEAN NOT NULL DEFAULT FALSE,
  status_reason       TEXT,                      -- rejection / correction / suspension reason
  approved_by         UUID REFERENCES users(id),
  approved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_dp_status ON delivery_partners(status);
CREATE INDEX idx_dp_online ON delivery_partners(is_online);

-- Uploaded verification documents (private storage - see upload middleware)
CREATE TABLE delivery_documents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_partner_id   UUID NOT NULL REFERENCES delivery_partners(id) ON DELETE CASCADE,
  doc_type              doc_type NOT NULL,
  file_key              TEXT NOT NULL,   -- private storage key/path, never a public URL
  verified              BOOLEAN NOT NULL DEFAULT FALSE,
  uploaded_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_dp_docs_partner ON delivery_documents(delivery_partner_id);

-- ---------- PLATFORM SETTINGS (admin-configurable, not hard-coded in app code) ----------
CREATE TABLE platform_settings (
  key         VARCHAR(100) PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Example keys the admin will set via the admin dashboard (no values seeded here):
--   'delivery_charge_flat'
--   'tax_percent'
--   'delivery_partner_earning_per_order'

-- ---------- ORDERS ----------
CREATE TABLE orders (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number         VARCHAR(20) UNIQUE NOT NULL,  -- human-readable, generated
  customer_id          UUID NOT NULL REFERENCES customers(id),
  shop_id              UUID NOT NULL REFERENCES shops(id),
  delivery_address_id  UUID NOT NULL REFERENCES addresses(id),
  delivery_partner_id  UUID REFERENCES delivery_partners(id),
  status               order_status NOT NULL DEFAULT 'placed',
  subtotal             NUMERIC(10,2) NOT NULL,
  delivery_charge      NUMERIC(10,2) NOT NULL DEFAULT 0,
  tax_amount           NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_amount         NUMERIC(10,2) NOT NULL,
  payment_method       payment_method NOT NULL DEFAULT 'cod',
  payment_status       payment_status NOT NULL DEFAULT 'pending',
  rejection_reason     TEXT,
  placed_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_shop ON orders(shop_id);
CREATE INDEX idx_orders_dp ON orders(delivery_partner_id);
CREATE INDEX idx_orders_status ON orders(status);

CREATE TABLE order_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   UUID NOT NULL REFERENCES products(id),
  variant_id   UUID NOT NULL REFERENCES product_variants(id),
  product_name VARCHAR(150) NOT NULL,   -- snapshot at order time
  cut_type     VARCHAR(100) NOT NULL,   -- snapshot at order time
  unit_price   NUMERIC(10,2) NOT NULL,  -- snapshot at order time
  quantity     NUMERIC(10,2) NOT NULL CHECK (quantity > 0),
  line_total   NUMERIC(10,2) NOT NULL
);
CREATE INDEX idx_order_items_order ON order_items(order_id);

-- ---------- DELIVERIES ----------
CREATE TABLE deliveries (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id             UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  delivery_partner_id  UUID NOT NULL REFERENCES delivery_partners(id),
  status               delivery_status NOT NULL DEFAULT 'assigned',
  earning_amount       NUMERIC(10,2),   -- calculated from platform_settings at completion
  assigned_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  reached_pickup_at    TIMESTAMPTZ,
  picked_up_at         TIMESTAMPTZ,
  out_for_delivery_at  TIMESTAMPTZ,
  delivered_at         TIMESTAMPTZ
);
CREATE INDEX idx_deliveries_dp ON deliveries(delivery_partner_id);

-- ---------- PAYMENTS (COD only for now, kept as its own table for auditability) ----------
CREATE TABLE payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  method        payment_method NOT NULL DEFAULT 'cod',
  amount        NUMERIC(10,2) NOT NULL,
  status        payment_status NOT NULL DEFAULT 'pending',
  collected_by  UUID REFERENCES delivery_partners(id),  -- who collected the cash
  collected_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- OTP ----------
-- OTPs are never stored in plaintext - only a hash, with expiry & attempt limits.
CREATE TABLE otp_verifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier        VARCHAR(150) NOT NULL,  -- mobile or email being verified
  purpose           otp_purpose NOT NULL,
  otp_hash          TEXT NOT NULL,
  attempts          INT NOT NULL DEFAULT 0,
  max_attempts      INT NOT NULL DEFAULT 5,
  expires_at        TIMESTAMPTZ NOT NULL,
  consumed          BOOLEAN NOT NULL DEFAULT FALSE,
  last_sent_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_otp_identifier ON otp_verifications(identifier, purpose);

-- ---------- NOTIFICATIONS (WhatsApp invoice / order updates log) ----------
CREATE TABLE notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES users(id),
  order_id     UUID REFERENCES orders(id),
  channel      VARCHAR(20) NOT NULL DEFAULT 'whatsapp',
  type         VARCHAR(50) NOT NULL,  -- e.g. 'order_invoice', 'order_status_update'
  payload      JSONB,
  status       VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, sent, failed
  provider_response JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_order ON notifications(order_id);

-- ---------- ADMIN & AUDIT ----------
-- Admin accounts reuse the users table with role='admin'; this table
-- holds optional admin-specific metadata/permissions.
CREATE TABLE admin_profiles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  permissions JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     UUID REFERENCES users(id),
  action       VARCHAR(100) NOT NULL,       -- e.g. 'shop.approve', 'dp.reject'
  target_type  VARCHAR(50),                 -- 'shop', 'delivery_partner', 'customer', 'order', ...
  target_id    UUID,
  details      JSONB,
  ip_address   VARCHAR(64),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_admin ON audit_logs(admin_id);
CREATE INDEX idx_audit_target ON audit_logs(target_type, target_id);

-- ---------- updated_at auto-touch trigger ----------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_shops_updated BEFORE UPDATE ON shops FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_variants_updated BEFORE UPDATE ON product_variants FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_dp_updated BEFORE UPDATE ON delivery_partners FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

# Meat Delivery Marketplace — Backend

Backend API + PostgreSQL schema for a local fresh-meat delivery marketplace
(initially for Srikakulam, Andhra Pradesh — architecture is city-agnostic).

Four roles: **customer**, **shop_owner**, **delivery_partner**, **admin**.
Payments: **Cash on Delivery only** (no payment gateway integrated).

No fake/seeded business data anywhere — shops, products, prices, and
delivery partners only exist once real users register them and an
admin approves them where required.

---

## 1. Requirements

- Node.js 18+
- PostgreSQL 14+

## 2. Install

```bash
cd meat-delivery-backend
npm install
```

## 3. Configure environment

```bash
cp .env.example .env
```

Then edit `.env`:

- `DATABASE_URL` — your Postgres connection string
- `JWT_SECRET` — generate a long random string, e.g. `openssl rand -hex 32`
- `OTP_PROVIDER_*` — **your own** SMS/Email OTP provider credentials
  (MSG91, Twilio Verify, 2Factor, AWS SNS, etc.)
- `WHATSAPP_*` — **your own** WhatsApp Business Cloud API credentials
  (Meta App, Phone Number ID, permanent access token, plus an
  approved message template)

### Wiring up your own OTP provider

`src/utils/otp.js` → `sendOtpViaProvider()` is intentionally a stub that
**throws** instead of pretending to succeed. Replace the body with an
HTTP call to your provider (there's an example `fetch` call commented
in the file). Everything else — OTP generation, hashing, expiry,
attempt limits, resend cooldown — is already implemented and provider-agnostic.

### Wiring up your own WhatsApp Business invoice sending

`src/utils/whatsapp.js` → `sendOrderInvoiceWhatsApp()` calls the
official WhatsApp Business Cloud API (`graph.facebook.com`). You need:

1. A Meta Business/WhatsApp Business account with a phone number
2. An **approved message template** (Cloud API requires templates for
   business-initiated messages) — update the `template.name` /
   `components` in the code to match your actual approved template
3. `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` in `.env`

Every attempt (success or failure) is logged to the `notifications`
table for auditability, so a misconfigured integration never silently
loses order data — you can always check `notifications` and resend manually.

## 4. Create the database and run migrations

```sql
-- in psql, as a superuser:
CREATE DATABASE meat_delivery;
```

```bash
npm run migrate
```

This applies `src/db/migrations/001_init_schema.sql` (idempotent — safe
to re-run; already-applied files are tracked in `schema_migrations`).

## 5. Create your first admin account

Admins are **never** created through a public signup endpoint. Run:

```bash
node src/db/createAdmin.js "Your Name" admin@example.com "A-Strong-Password-1!"
```

Admins then log in through the normal `/api/auth/login/*` endpoints
(password + OTP, same as every other role) — `requireRole('admin')`
gates every `/api/admin/*` route.

## 6. Run the server

```bash
npm run dev     # with nodemon, auto-restarts on changes
# or
npm start
```

Server starts on `http://localhost:4000` (or your configured `PORT`).
Check `GET /health`.

---

## API overview

All endpoints are under `/api`. Every protected route requires
`Authorization: Bearer <jwt>` obtained from the login/signup OTP flow.

| Area | Base path | Notes |
|---|---|---|
| Auth (all roles except admin signup) | `/api/auth` | signup OTP → verify, login OTP → verify |
| Customer | `/api/customers` | addresses, order history |
| Shops (public browse) | `/api/shops/public*` | only `status = approved` shops appear |
| Shops (owner) | `/api/shops/me*` | create/update own shop, open/closed, incoming orders |
| Products (public) | `/api/products/public/shop/:shopId` | |
| Products (owner) | `/api/products/me*` | products + variants (cut/type, price, stock) |
| Orders | `/api/orders` | customer checkout, order detail (role-scoped) |
| Delivery partner | `/api/delivery/*` | registration docs, online/offline, delivery workflow, earnings |
| Admin | `/api/admin/*` | approvals, verification doc download, settings, audit log |

### Order status flow

```
placed → accepted → preparing → ready_for_pickup → assigned
       → picked_up → out_for_delivery → delivered
placed → rejected  (shop declines; stock is restored)
```

### Delivery partner status flow

```
pending → approved      (admin assigns DP-000001-style ID automatically)
pending → rejected
pending → correction_requested
approved → suspended / disabled
```

Only `approved` + `is_online = true` partners can see/accept deliveries
(`GET /api/delivery/available-deliveries`).

## Security notes already implemented

- Passwords: bcrypt (`BCRYPT_SALT_ROUNDS`, default 12) — `password_hash`
  column only, never plaintext. Admin cannot read passwords, only reset/disable accounts.
- OTP: hashed at rest (bcrypt), expiring, attempt-limited, resend-cooldown.
- JWT auth + role check on **every** protected route (`authenticate` + `requireRole`) — not just hidden frontend buttons.
- Delivery-partner documents (selfie, licence, RC) are stored in a
  private folder never mounted as a static route; only reachable via
  the authenticated admin-only download endpoint, and every access is audit-logged.
- `helmet`, CORS (tighten `origin` for production), and rate limiting (`express-rate-limit`) are wired in `src/app.js`.
- All monetary values (prices, delivery charge, tax, earnings) are read
  from the database / `platform_settings` — nothing is hard-coded in the app.

## What you still need to do for production

- Implement your real OTP provider call (`src/utils/otp.js`)
- Get a WhatsApp message template approved and confirm the payload shape (`src/utils/whatsapp.js`)
- Swap `STORAGE_DRIVER=local` for real private object storage (S3/GCS) in `src/middleware/upload.js` and `adminController.downloadDocument`
- Put this behind HTTPS (e.g. via your hosting provider or a reverse proxy like Nginx/Caddy)
- Tighten CORS `origin` in `src/app.js` to your actual frontend domain(s)
- Set a strong random `JWT_SECRET` and rotate it if ever leaked

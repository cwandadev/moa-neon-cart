# Supabase setup for MOA Mart

Everything the shop needs on the backend lives in this folder. No secrets are stored in the repo.

## 1. Database
Open the Supabase SQL editor and run the files in `migrations/` in order, 000001 to 000011. Each runs once.

- 000001 to 000006: tables, security rules, catalog, storage, email sync, security fixes
- 000007: notifications
- 000008: online payments (PawaPay)
- 000009: saved delivery address, last-admin guard
- 000010: automatic order tracking, cancellation and refunds
- 000011: product options (sizes, colors) with their own stock, price and photo

## 2. Edge Functions (`functions/`)
For each folder, create a function with the same name (dashboard: Edge Functions, Deploy a new function, Via Editor), paste its `index.ts`, and deploy. Turn "Verify JWT with legacy secret" OFF for all of them: they check the login themselves, and `pawapay-callback` must be reachable by PawaPay.

- `create-checkout`: places an order (re-prices every line from the database, including the chosen size or color)
- `create-payment`: starts a mobile money payment
- `pawapay-callback`: receives PawaPay's deposit and refund callbacks and verifies them with PawaPay
- `payment-status`: tells the checkout screen what happened
- `cancel-order`: staff cancel an order, restock it, and refund paid orders through PawaPay
- `manage-users`: admin user management

## 3. Secrets (Edge Functions, Secrets)
- `PAWAPAY_API_TOKEN`: the PawaPay API token (sandbox now, production later). Payments only switch on when it exists.
- `PAWAPAY_BASE_URL`: optional. Defaults to `https://api.sandbox.pawapay.io`. Use `https://api.pawapay.io` for production.

## 4. Auth settings (Authentication)
- Allow anonymous sign-ins: ON
- Google provider: ON, with a Google OAuth client
- URL configuration: add the site address(es) with `/**` to Redirect URLs

## 5. PawaPay dashboard
Set the **Deposits** and the **Refunds** callback URLs to `https://<project-ref>.supabase.co/functions/v1/pawapay-callback`.

## 6. First admin
After that person has signed in once, run in the SQL editor:
`update public.profiles set role = 'admin' where email = 'their@email';`

## 7. Frontend
Copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Never put the PawaPay token or the service-role key in the frontend.

## How orders move
- A paid order is confirmed automatically. An order whose payment time runs out is cancelled automatically.
- Staff dispatch orders ("Out for delivery") and mark them delivered. The customer can also tap "I received my order", and an order that has been out for delivery for 3 days is marked delivered automatically.
- Staff can cancel an order with a reason. Cancelling a paid order (admins only) puts the items back in stock and refunds the full amount to the number that paid.
- Products can have up to two options (for example Size and Color). Each combination has its own stock, and optionally its own price and photo. A product with options shows the total of its combinations as its stock.

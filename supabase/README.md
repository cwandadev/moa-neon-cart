# Supabase setup for MOA Mart

Everything the shop needs on the backend lives in this folder. No secrets are stored in the repo.

## 1. Database
Open the Supabase SQL editor and run the files in `migrations/` in order, 000001 to 000009. Each runs once.

## 2. Edge Functions (`functions/`)
For each folder, create a function with the same name (dashboard: Edge Functions, Deploy a new function, Via Editor), paste its `index.ts`, and deploy. Turn "Verify JWT with legacy secret" OFF for all five: they check the login themselves, and `pawapay-callback` must be reachable by PawaPay.

- `create-checkout`: places an order
- `create-payment`: starts a mobile money payment
- `pawapay-callback`: receives PawaPay's callback and verifies it with PawaPay
- `payment-status`: tells the checkout screen what happened
- `manage-users`: admin user management

## 3. Secrets (Edge Functions, Secrets)
- `PAWAPAY_API_TOKEN`: the PawaPay API token (sandbox now, production later). Payments only switch on when it exists.
- `PAWAPAY_BASE_URL`: optional. Defaults to `https://api.sandbox.pawapay.io`. Use `https://api.pawapay.io` for production.

## 4. Auth settings (Authentication)
- Allow anonymous sign-ins: ON
- Google provider: ON, with a Google OAuth client
- URL configuration: add the site address(es) with `/**` to Redirect URLs

## 5. PawaPay dashboard
Set the Deposits callback URL to `https://<project-ref>.supabase.co/functions/v1/pawapay-callback`.

## 6. First admin
After that person has signed in once, run in the SQL editor:
`update public.profiles set role = 'admin' where email = 'their@email';`

## 7. Frontend
Copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Never put the PawaPay token or the service-role key in the frontend.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Petit Laço / Adriana Melo Acessórios — a small e-commerce site for handmade hair bows. Vanilla HTML/CSS/JS frontend (no framework, no bundler) served by a Node/Express backend that also handles payments (Mercado Pago), shipping quotes (Melhor Envio), accounts, and an admin panel. Everything is server-rendered-free static markup with `<script defer>` includes — there is no build step.

## Commands

```bash
cd server
npm install
npm start        # node server.js — runs on http://localhost:3333
npm run dev       # node --watch server.js — auto-restart on file change
```

The server serves **both** the API and the entire static site (`index.html`, `css/`, `js/`, etc.) from the same origin/port — always open `http://localhost:3333` directly, never open `index.html` via a separate static server or Live Server. Site and API must share an origin for the session cookie to work, and `/api/*` calls will 404 against a plain static server.

No test suite, linter, or build/minify step exists in this repo. There is no root `package.json`; all dependencies live in `server/package.json`.

Useful one-offs:
- Reset the local database: delete `server/data.db` (SQLite file, gitignored; recreated with fresh schema on next boot).
- Generate an admin email hash for `ADMIN_EMAIL_HASHES`: `node -e "console.log(require('crypto').createHash('sha256').update('email@exemplo.com').digest('hex'))"`.
- First-time setup: `cp server/.env.example server/.env` and fill it in (see README.md section 2 for every variable).

### Known state of `server/.env` in this environment

- `MP_ACCESS_TOKEN` / `MP_PUBLIC_KEY` are **production** Mercado Pago credentials (`APP_USR-...`), not sandbox. Never attempt a real checkout/test-card flow against them — Mercado Pago's test cards are rejected by production credentials anyway, and a live attempt risks real money. Use an isolated throwaway server with a fake token and a monkey-patched `mercadopago` SDK / stubbed `global.fetch` to exercise the payment flow instead (see "Testing methodology" below).
- `MELHOR_ENVIO_TOKEN` is still the placeholder from `.env.example` — real shipping quotes don't work until a real token is set.
- `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` are empty — the owner-notification email (`server/email.js`) can't actually send until these are filled in.

## Architecture

### Single source of truth patterns

The codebase repeatedly uses one canonical place for a rule and has every consumer read from it, specifically to prevent the frontend announcing a price/discount that the backend doesn't actually charge:

- **`js/pricing.js`** (`PAYMENT_RULES`): Pix discount %, installment count/interest. Written in UMD so it loads as `window.PLCPricing` in the browser (vitrine, cart) *and* via `require("../js/pricing.js")` in `server/server.js` (actual checkout math). Change the discount/installment rules in exactly this one object.
- **`PRODUCTS`** (`server/server.js`): base catalog (name, price, weight/dimensions for shipping, default category, default badges). Admin-panel edits are layered on top via the `product_overrides` DB table; `effectiveProduct(id, overridesMap)` is the *only* place that merges base + override, and every route (storefront catalog, checkout pricing, order emails, admin listing) calls it instead of reading `PRODUCTS[id]` directly. Weight/dimensions are never overridable — only name/price/photoUrl/category/badges are, because shipping math depends on them.
- **`js/main.js`**'s own `products` array (id/name/category/price/color/rating/desc) is the *frontend default* — it mirrors `PRODUCTS` but is intentionally static. `loadProductOverrides()` fetches `/api/products` on load and patches the live objects in place (name/price/photoUrl/category/badges) if the server disagrees, then re-renders — this is how an admin edit reaches the storefront without a page reload.

### Auth model

Session is an opaque random token in an httpOnly cookie (`server/auth.js`) — deliberately not a JWT, so nothing about the user (including admin status) is ever readable or forgeable client-side. Admin access is **not** a `role` column in the `users` table; it's computed on every request by hashing the logged-in user's email (SHA-256) and comparing (via `crypto.timingSafeEqual`) against the comma-separated list in `ADMIN_EMAIL_HASHES`. There is no "promote user to admin" UI — whoever controls the `.env` controls admin access.

### Payment flow

1. Client picks a payment method (Pix or card/boleto) in the cart; this choice is sent to the server and restricts which Mercado Pago payment methods are enabled in `create-preference` (`PAYMENT_METHODS` in `server.js`) — this is what prevents someone selecting "Pix" for the discount and then paying by card anyway.
2. `POST /api/create-preference` recomputes items, shipping, and coupon discount entirely server-side (never trusts client-sent prices) and creates the order row as `pendente` before creating the Mercado Pago preference.
3. The Mercado Pago redirect/back_url pages (`pagamento-sucesso/erro/pendente.html`) are UX-only — they never confirm payment.
4. `POST /api/webhook` is the only source of truth for payment status: it re-fetches the payment by ID from Mercado Pago's API (never trusts the webhook payload itself), and guards against duplicate processing via a `wasAlreadyApproved` check before firing side effects.
5. On first approval, `runApprovedOrderSideEffects()` fires WhatsApp (`server/whatsapp.js`) and email (`server/email.js`) notifications to the shop owner — both best-effort, wrapped so a failure never affects the already-confirmed order, both formatted via shared helpers in `server/orderFormatting.js`.

### Admin panel (`admin.html` / `js/admin.js`)

Single page, tab-switched client-side (Dashboard / Produtos / Cupons / Vendas e pedidos — `.admin-tab-btn` / `.admin-tab-panel`, no page reload between tabs). All tab data is fetched together in one `loadDashboard()` call. Product edits use a genuinely partial `PATCH /api/admin/products/:id` — `js/admin.js` diffs the form against the values captured when the modal opened and only sends changed keys; the server treats a missing key as "leave alone" (not "clear"), via `db.upsertProductOverride`'s merge-with-existing-row logic. Product photos go through `POST /api/admin/products/:id/photo` (multipart, `multer`, saved to `img/products/`, gitignored) rather than a pasted URL or base64-in-JSON, specifically to keep the public `/api/products` payload small (it's fetched by every storefront visitor).

### Database

`node:sqlite` (Node's native module, no ORM/driver dependency) — one file, `server/data.db`. Schema lives in `server/db.js` as a single `CREATE TABLE IF NOT EXISTS` block; columns added after initial release go through the `ensureColumn(table, column, definition)` helper (idempotent `ALTER TABLE`) further down the same file, so existing local databases pick up new columns without a migration tool.

### CSP is duplicated and must stay in sync

Every HTML page declares its Content-Security-Policy both as a `<meta http-equiv="Content-Security-Policy">` tag and, for `server.js`-served requests, via `helmet()`'s `contentSecurityPolicy.directives` in `server.js`. Adding a new external script/font/API host requires updating both.

### Testing methodology (no automated tests exist)

Verification has been done manually per change, via a throwaway server on an unused port with an isolated `DB_PATH` (e.g. `DB_PATH=/tmp/test.db PORT=356x node server.js`) and, when Mercado Pago/Melhor Envio/SMTP are involved, monkey-patched `global.fetch` and/or the `mercadopago` SDK's `Preference.prototype.create` / `Payment.prototype.get` so no real external API is called and no production credential is exercised. Never start a second process on port 3333 or point a test at `server/data.db` / `server/.env` — always use a separate port and `DB_PATH`.

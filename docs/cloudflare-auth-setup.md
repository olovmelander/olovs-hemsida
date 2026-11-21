# Banvy on Cloudflare Workers + D1 + Google Sign-In

Banvy uses **Cloudflare Workers (with Static Assets)**, **Cloudflare D1** (SQLite), and **Better Auth** (Google OAuth) for cross-device syncing of:

* Completed & edited IRL rounds (`rounds`)
* GPS-locked shots & club lengths (`shots`, `round_shot_sets`)
* Caddie bag & playing handicap (`player_profile`)

Device preferences (3D quality, frame cap, lighting, map display toggles, offline courses) stay strictly local per device. Players can still use Banvy offline or without an account; local rounds merge into their account on first sign-in.

---

## 1. Run & test locally right now

```powershell
# 1. Install Worker dependencies (first time)
npm --prefix apps/worker install

# 2. Apply SQLite migrations to local D1
npm run db:migrate:local

# 3. Start the Worker API on http://127.0.0.1:8787
npm run dev:worker

# 4. In a second terminal, start Vite on http://localhost:5173 (proxies /api to :8787)
npm run dev
```

Local secrets live in `apps/worker/.dev.vars` (gitignored — copy from `apps/worker/.dev.vars.example`).

While `GOOGLE_CLIENT_ID` is empty and `ALLOW_DEV_AUTH="true"` is set in `.dev.vars`, `localhost` shows a **"Testa lokalt konto (endast dev)"** button under **Inställningar → Konto** so you can test real Better Auth sessions and D1 syncing before setting up Google Cloud Console.

---

## 2. Create Google OAuth 2.0 credentials

1. Open [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials) (create a project such as `Banvy` if you don't have one).
2. Configure **OAuth consent screen** (Audience: **External**, add app name `Banvy`, your email as developer contact, and while in Testing mode add your own Google email under Test Users).
3. Click **Create Credentials → OAuth client ID → Web application**:
   * **Authorized JavaScript origins:**
     * `http://localhost:5173`
     * `http://127.0.0.1:8787`
     * `https://<your-banvy-domain>` (e.g. `https://banvy.<your-subdomain>.workers.dev` or your custom domain)
   * **Authorized redirect URIs:**
     * `http://localhost:5173/api/auth/callback/google`
     * `http://127.0.0.1:8787/api/auth/callback/google`
     * `https://<your-banvy-domain>/api/auth/callback/google`
4. Copy the **Client ID** and **Client Secret** into `apps/worker/.dev.vars` for local testing.

---

## 3. Create the Cloudflare D1 database & deploy

From `apps/worker`:

```powershell
# Log in to Cloudflare (if needed)
npx wrangler login

# 1. Create the production D1 database
npx wrangler d1 create banvy-db
```

Copy the returned `database_id` into `apps/worker/wrangler.jsonc` (replacing the `00000000-...` placeholder).

```powershell
# 2. Apply migrations to the remote D1 database
npx wrangler d1 migrations apply banvy-db --remote

# 3. Set production secrets in Cloudflare (never commit these!)
# Generate a random 32-byte secret:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put BETTER_AUTH_URL        # e.g. https://banvy.<subdomain>.workers.dev
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

Then build the frontend and deploy from the repo root:

```powershell
npm run deploy:cloudflare
```

*(Make sure `BETTER_AUTH_URL` matches the exact `https://...` domain you added to Google Cloud Console's authorized redirect URIs.)*

---

## 4. Note on static asset count as you add more courses

`apps/golf/dist` currently contains ~14,000 files (max file ~10.6 MB), which fits inside Cloudflare Workers Static Assets' **Free tier limit (20,000 files, 25 MiB per file)**. Once Banvy grows past ~20,000 files (~5–6 more measured courses), either:

* Upgrade to **Workers Paid (\$5/month)** → raises the limit to **100,000 static files**, or
* Serve immutable `/grounds/*` and `/courses/*` chunks from **Cloudflare R2** (zero egress fees, unlimited files).

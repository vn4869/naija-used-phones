# Deployment guide — TITAN marketplace

A beginner-friendly path from your `outputs/` folder to a live, customer-facing website. No local terminal required.

**What you're deploying**

| Layer       | Service        | Tier             | Why this one                                                                  |
| ----------- | -------------- | ---------------- | ----------------------------------------------------------------------------- |
| Database    | **Neon**       | Free (0.5 GB)    | Pure Postgres, instant resume from sleep, one-click connection string.        |
| Backend API | **Render**     | Free Web Service | Free Node hosting, GitHub auto-deploys. (Sleeps after 15 min idle on free.)   |
| Frontend    | **Vercel**     | Hobby (free)     | Best-in-class Vite/React deploys, generous bandwidth, edge nodes near Lagos.  |
| Payments    | **Paystack**   | Free test mode   | Already wired into the backend. Switch to live keys once tested end-to-end.   |

**Total cost to start: $0.** Plan to spend $7/mo on Render's "Starter" tier once you have real customers — that removes the 15-minute sleep.

**Estimated time the first time you do this: 45–60 minutes.**

---

## What you need before you start

1. A GitHub account — sign up at [github.com](https://github.com) (free).
2. A Paystack test account — sign up at [paystack.com](https://paystack.com). You'll need a Nigerian phone number for full activation, but the test keys work without it.
3. (Optional) Install [GitHub Desktop](https://desktop.github.com) — gives you a button-driven way to push code with no terminal. You can also use GitHub's web UI to upload files; the guide covers that path too.

---

## Step 1 — Get your code into GitHub (10 min)

**Option A: web upload (zero install).**

1. Go to [github.com/new](https://github.com/new).
2. Repository name: `titan-marketplace`. Keep it **Private**.
3. Click **Create repository**.
4. On the next page, click **uploading an existing file**.
5. From your computer, drag the entire `backend/` folder into the upload area, then commit. Repeat for the `frontend/` folder and `DEPLOYMENT.md`.

**Option B: GitHub Desktop (recommended once you start iterating).**

1. Install GitHub Desktop, sign in.
2. File → Clone repository → pick the empty repo you just created.
3. Copy `backend/`, `frontend/`, and `DEPLOYMENT.md` into the cloned folder.
4. In GitHub Desktop, write a commit message ("initial import") → Commit to main → Push origin.

Once pushed, your repo should have this shape:

```
titan-marketplace/
├── backend/
│   ├── prisma/schema.prisma
│   ├── src/
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   ├── package.json
│   ├── vite.config.js
│   └── .env.example
└── DEPLOYMENT.md
```

---

## Step 2 — Stand up the database on Neon (5 min)

1. Go to [neon.tech](https://neon.tech) → **Sign up with GitHub**.
2. Click **Create project**.
   - Project name: `titan-marketplace`
   - Postgres version: leave default (latest)
   - Region: **AWS · Europe (Frankfurt) · eu-central-1**. This is the lowest-latency free region for Nigerian users.
3. After it provisions, you'll see a **Connection string** panel. Toggle the dropdown to **Prisma** and copy the long `postgresql://…?sslmode=require` URL. Save it in a notes app — you'll paste it into Render in a moment.

That's it. We'll let Render create the tables for you automatically on first deploy (no need to run any commands yourself).

---

## Step 3 — Deploy the backend on Render (12 min)

1. Go to [render.com](https://render.com) → **Get Started** → sign in with GitHub.
2. Click **New +** → **Web Service** → **Build and deploy from a Git repository** → connect your GitHub account if prompted and pick `titan-marketplace`.
3. Configure the service:

   | Field             | Value                                                                 |
   | ----------------- | --------------------------------------------------------------------- |
   | Name              | `titan-api`                                                           |
   | Region            | **Frankfurt (EU Central)**                                            |
   | Branch            | `main`                                                                |
   | Root Directory    | `backend`                                                             |
   | Runtime           | Node                                                                  |
   | Build Command     | `npm install && npx prisma generate && npx prisma db push`            |
   | Start Command     | `node src/server.js`                                                  |
   | Instance Type     | **Free**                                                              |

   The `prisma db push` in the build step is what creates the database tables on Neon from your `schema.prisma`. For your first deploy this is the simplest path. (Later, when you have real customer data, switch to proper migrations with `prisma migrate deploy` and pre-generated migration files.)

4. Scroll down to **Environment Variables** → **Add Environment Variable**, one row at a time:

   | Key                   | Value                                                                                       |
   | --------------------- | ------------------------------------------------------------------------------------------- |
   | `DATABASE_URL`        | (paste the Neon connection string from step 2)                                              |
   | `PAYSTACK_SECRET_KEY` | (your Paystack **test** secret key from dashboard.paystack.com → Settings → API Keys)       |
   | `ADMIN_API_KEY`       | A 64-character random hex string. Generate one at [random.org/strings](https://www.random.org/strings/?num=1&len=64&loweralpha=on&digits=on&unique=on&format=html&rnd=new). Save a copy. |
   | `APP_URL`             | Leave empty for now — you'll fill this in step 5.                                           |
   | `RUN_WORKER_IN_PROCESS` | `true` — starts the reservation-release sweeper inside the API process (free-tier-friendly). |

5. Click **Create Web Service**. Render will start building. Watch the log — first build takes ~3 minutes.

6. When it goes green, your URL appears at the top, something like `https://titan-api.onrender.com`. Open it — you should see a 404 (that's correct; there's no route at `/`). Visit `https://titan-api.onrender.com/healthz` instead — it should return `{"ok":true}`.

**Save that URL.** You'll need it in the next two steps.

---

## Step 4 — Seed your first product (3 min)

Right now the database is empty so the admin form has nothing to select. Add one brand and a few iPhone models via Neon's SQL editor.

1. In Neon → your project → **SQL Editor** (left sidebar).
2. Paste this and click **Run**:

   ```sql
   INSERT INTO "Brand" (id, name, slug, "createdAt")
   VALUES ('brand_apple', 'Apple', 'apple', NOW());

   INSERT INTO "ProductModel" (id, "brandId", name, slug, "storageGb", colorway, "releaseYear", "heroImageRef", "createdAt", "updatedAt")
   VALUES
     ('pm_ip11_128_bk', 'brand_apple', 'iPhone 11', 'iphone-11-128gb-black',
      128, 'Black', 2019, 'img_iphone_11_black', NOW(), NOW()),
     ('pm_ip15p_256_nt', 'brand_apple', 'iPhone 15 Pro', 'iphone-15-pro-256gb-natural-titanium',
      256, 'Natural Titanium', 2023, 'img_iphone_pro_natural_titanium', NOW(), NOW()),
     ('pm_ip16p_512_bt', 'brand_apple', 'iPhone 16 Pro', 'iphone-16-pro-512gb-black-titanium',
      512, 'Black Titanium', 2024, 'img_iphone_pro_black_titanium', NOW(), NOW());
   ```

   You can add more later (or build a dedicated "add model" admin screen down the line). For each new iPhone variant you list, you'll add one `ProductModel` row, then add as many `DeviceUnit` rows as you have actual phones for it.

---

## Step 5 — Deploy the frontend on Vercel (10 min)

1. Go to [vercel.com](https://vercel.com) → **Sign up with GitHub**.
2. **Add New… → Project** → import `titan-marketplace`.
3. Configure:

   | Field             | Value                          |
   | ----------------- | ------------------------------ |
   | Framework Preset  | **Vite**                       |
   | Root Directory    | `frontend`                     |
   | Build Command     | `npm run build`                |
   | Output Directory  | `dist`                         |

4. Expand **Environment Variables**:

   | Key                    | Value                                                |
   | ---------------------- | ---------------------------------------------------- |
   | `VITE_API_BASE_URL`    | `https://titan-api.onrender.com` (your Render URL)   |
   | `VITE_ADMIN_API_KEY`   | (the same value you set as `ADMIN_API_KEY` on Render)|
   | `VITE_ADMIN_EMAIL`     | `ops@yourstore.ng` (or your real ops email)          |

5. Click **Deploy**. Wait ~2 minutes. You'll get a URL like `https://titan-marketplace.vercel.app`.

6. **Go back to Render** → your service → **Environment** → set `APP_URL` to your Vercel URL → **Save Changes**. Render will redeploy (~90 seconds). This is what enables CORS so your storefront can talk to your API.

---

## Step 6 — Point Paystack's webhook at your backend (2 min)

1. In your Paystack dashboard: **Settings → API Keys & Webhooks**.
2. **Test webhook URL** → enter: `https://titan-api.onrender.com/api/payment/webhook` (replace with your real Render URL).
3. **Save**.

Paystack will start sending `charge.success` and `charge.failed` events to your backend, signed with the same secret key you set as `PAYSTACK_SECRET_KEY`. Your code verifies the signature on every request.

---

## Step 7 — Test the full flow (5 min)

1. Open your Vercel URL. You should see the storefront — but with no products yet.
2. Navigate to `/admin` (e.g. `https://titan-marketplace.vercel.app/admin`).
3. Pick an iPhone model from the dropdown (the ones you seeded in step 4).
4. Fill the form:
   - IMEI: `356938035643809` (any 14–15 digit number)
   - Grade: A
   - Battery: 92
   - Price: 185000
   - Initial status: **Available now**
5. Click **Save device**. You should see "Added IPHONE-…" success message and the device appear in the table below.
6. Go back to `/` — your iPhone should now be on the homepage.
7. Click **Buy** on the card. You'll be prompted for email and name. Use your real email.
8. You'll be redirected to a Paystack page. Use a [test card](https://paystack.com/docs/payments/test-payments): card number `4084 0840 8408 4081`, any future expiry, any CVV, OTP `123456`.
9. After paying, Paystack redirects you to `/checkout/verify?ref=ord_…`. The verify page calls the backend, gets the order, and shows a success screen with the IMEI you just bought.
10. Back in `/admin`, the device's status should be **Sold**.

If you hit the flow end-to-end, **everything is wired correctly.**

---

## Things to know about the free tiers

**Render free spins down after 15 min idle.** The first request after a quiet period takes 30–60 seconds to wake up. Your homepage will feel slow if no one has visited recently. Two ways to handle it:

- Live with it during testing (cheapest).
- Upgrade to Render Starter ($7/mo) once you start telling real customers about the site. The instance stays warm 24/7.

**Neon free pauses after 5 min idle but resumes in ~500 ms.** Customers won't notice this — much faster than Render's wake-up.

**The reservation-release worker** runs inside your Render web service (via the `start()` call you can add to `src/server.js`, or simply on its own). On the free tier, when the web service sleeps, the worker sleeps too. That's fine — no reservations are happening while no one is visiting. When traffic returns, the worker wakes with the web service and sweeps any expired reservations on its first run.

**The admin API key ships in your client bundle** (`VITE_ADMIN_API_KEY`). That's acceptable for an internal-only admin URL, but the moment your site is indexed by Google, anyone visiting `/admin` and viewing the network tab can grab your key and add devices. Before you go fully public, swap the API-key admin auth for a proper login: a `/api/admin/login` route that issues a JWT, and a login screen on `/admin/login`. The route handlers don't need to change — `req.admin` keeps the same shape.

---

## Going live (when you're ready)

1. In Paystack dashboard, **activate** your business (BVN, NIN, business registration).
2. Switch from **test mode** to **live mode** in Paystack.
3. Replace `PAYSTACK_SECRET_KEY` on Render with the **live** secret key.
4. Update the webhook URL in Paystack's live-mode settings to the same backend URL.
5. Upgrade Render to Starter ($7/mo) so the API never sleeps.
6. Add a custom domain in Vercel (e.g. `titan.ng`) — Vercel provides free TLS.
7. Add the custom domain to Render too if you want `api.titan.ng` → backend.

---

## Troubleshooting

| Symptom                                                        | What's likely wrong                                                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Render build fails with "Cannot connect to database"           | `DATABASE_URL` is missing `?sslmode=require`, or the wrong region.                                           |
| Frontend works locally but `/api/*` returns 404 in production  | `VITE_API_BASE_URL` is empty in Vercel env vars. Set it to your Render URL and redeploy.                     |
| Browser shows "CORS error" in console                          | `APP_URL` on Render doesn't match your Vercel URL exactly. Include the protocol (`https://…`).               |
| Webhook hits the server but order stays PENDING                | `PAYSTACK_SECRET_KEY` on Render doesn't match the key Paystack signs with. Copy the **test** secret exactly. |
| Admin dashboard shows "Invalid admin key"                      | `VITE_ADMIN_API_KEY` (frontend) doesn't equal `ADMIN_API_KEY` (backend). Re-paste both, redeploy both.       |
| Render free service takes 60s for first request                | Normal — cold start. Upgrade to Starter ($7/mo) to eliminate.                                                |
| Paystack page says "Invalid amount"                            | Your model has `priceKobo = 0` in the DB. Set a real price when seeding or via the admin form.               |

---

## Where to go next

- **Real product photos.** Upload your iPhone images to a CDN (Cloudinary free tier is great), put the URLs into `DeviceUnit.galleryImageRefs`, and swap the placeholder icons in `Home.jsx` for `<img>` tags.
- **A proper checkout form** (replacing the `window.prompt` flow) — a modal that collects email/name/phone with validation.
- **Brand & model admin screens** so you don't have to seed in SQL.
- **Email receipts** via Paystack's transaction email + a transactional service (Resend, Postmark) for delivery updates.
- **Custom domain** — buy `.ng` from a registrar (Whogohost, Domainking), point DNS at Vercel for the storefront and at Render for the API.

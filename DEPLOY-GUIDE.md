# Mumbai Furnishings — Deploy & Admin Guide (v2)

Your site now has a **team admin panel** at `/admin/` where you and your team can:

- Upload real product photos
- Edit phone, email, address and social links — no code needed
- Add to the photo gallery (with categories)
- Add before/after repair pairs
- Manage testimonials (approve/hide)

The site fetches all of this content automatically. **You change something in `/admin/` → it appears on your live site within ~1 minute.**

---

## What's in this folder

| File / Folder | Purpose |
|---|---|
| `index.html` | The main website (now reads from `/data/*.json`) |
| `data/` | Content files — edited by `/admin/` |
| `admin/` | The Decap CMS admin panel itself |
| `uploads/` | (Created on first photo upload) — where team photos are stored |
| `netlify.toml` | Netlify configuration |
| `robots.txt`, `sitemap.xml` | SEO files |
| `DEPLOY-GUIDE.md` | This file |

---

# Setup — One Time, ~20 Minutes

The admin panel needs the site to live in a **GitHub repo** (instead of a drag-drop deploy). Since you already deployed v1 via drag-drop, follow these steps to upgrade.

## Step 1 — Put the site on GitHub

1. Go to **[github.com](https://github.com)** → sign up (free) if you haven't.
2. Click the **+** in the top-right → **New repository**.
3. Name it: `mumbai-furnishings-site`
4. Make it **Public** (required for free Netlify Identity) — only the code is public, not your form submissions.
5. Click **Create repository**.
6. On the next page, click **uploading an existing file**.
7. **Drag this entire folder's contents** (`index.html`, `data/`, `admin/`, etc.) into the GitHub upload zone.
8. Scroll down → write commit message "Initial v2 site" → **Commit changes**.

## Step 2 — Connect Netlify to the new repo

You can either replace your existing Netlify site or create a new one. Replacing is cleaner.

1. Open your existing site in **[Netlify](https://app.netlify.com)**.
2. **Site configuration → General → Danger zone → Delete this site** (only the site, not your account).
3. Click **Add new site → Import an existing project → Deploy with GitHub**.
4. Authorize Netlify to access GitHub when prompted.
5. Pick `mumbai-furnishings-site`.
6. Leave defaults (publish directory `.`) → **Deploy site**.
7. Within 30–60 seconds your site is live at a new `*.netlify.app` URL. Rename it under *Site configuration → Change site name*.

## Step 3 — Enable Netlify Identity (the login system)

1. In your new Netlify site, go to **Site configuration → Identity → Enable Identity**.
2. Under **Registration preferences**, choose **Invite only** (recommended — only people you invite can log in).
3. Under **Services → Git Gateway**, click **Enable Git Gateway**.

## Step 4 — Invite yourself + your team

1. Still in **Identity**, click **Invite users**.
2. Type your email + any team members' emails (comma-separated) → **Send**.
3. Check your inbox. Click the **"Confirm your email"** link in the Netlify email.
4. You'll land at `https://your-site.netlify.app/admin/#invite_token=…`. Set a password.
5. You're now logged into the admin panel.

> Each team member follows the same flow with their own invite email.

---

# First-time admin walkthrough

After login at **`yoursite.netlify.app/admin/`** you'll see a left sidebar with five sections:

### 1. Site Settings
Update phone, WhatsApp, email, address, social links. **Do this first** — these placeholders appear all over the site and will be replaced once you save.

### 2. Products
Edit / add / remove products. Each one has:
- Title + Category + Subtitle
- A photo (click → upload from your computer)
- Optional tag (Bestseller / New / Bespoke / Repair)
- "Show on homepage" toggle

### 3. Photo Gallery
Upload real photos of your work. Pick a category for each — the homepage gallery has filter buttons so customers find what they want.

### 4. Before & After
Upload paired before/after photos. Powerful for showing repair quality. Each pair has title + description.

### 5. Testimonials
Manage customer reviews. Toggle "approved" off to hide a review without deleting it.

**To save:** Click *Publish → Publish now*. Within 1–2 minutes it's live on your site.

---

# Customer review submissions

When a customer submits a review through the site (the "Submit a review" button under testimonials):

1. The submission shows up in **Netlify dashboard → Forms → review**.
2. You'll get an email if you set up a notification: *Forms → Settings → Form notifications → Add → Email*.
3. To add it to your testimonials, copy the text into Decap CMS → Testimonials → Add new → fill in fields → mark **Approved**. Hit Publish.

> **Why not auto-approve?** Spam protection + reputation control. The 30-second human check is worth it.

---

# Add your custom domain (e.g., `mumbaifurnishings.com`)

1. Buy from [Namecheap](https://namecheap.com), [GoDaddy](https://godaddy.com), or [Hostinger](https://hostinger.in) — about ₹800–₹1,200/year.
2. In Netlify: **Domain management → Add a domain → Add domain** → enter your domain.
3. Netlify shows DNS records. Copy them.
4. In your registrar's dashboard, go to DNS settings → paste the records.
5. Wait 10 minutes – 24 hours. Then your site is at `mumbaifurnishings.com` with free HTTPS.

---

# Get a real email like `hello@mumbaifurnishings.com`

After buying a domain, sign up for **[Zoho Mail Free](https://zoho.com/mail/zohomail-pricing.html)** — free for up to 5 users. Connect via DNS records (Zoho gives instructions).

Then update the email in the admin panel → Settings → Email.

---

# Troubleshooting

**"I see the admin page but can't log in"**
→ Step 3 wasn't completed. Make sure both **Identity** and **Git Gateway** are enabled in Netlify dashboard.

**"Photos I uploaded don't appear on the site"**
→ Wait 1–2 minutes for Netlify to rebuild. Check **Deploys** in your Netlify dashboard — it should show a recent successful build.

**"WhatsApp button on a product opens the wrong number"**
→ Update **Site Settings → WhatsApp number** in admin. Format: country code + number with NO `+`, NO spaces (e.g. `919876543210`).

**"Reviews aren't capturing"**
→ Go to Netlify → Forms → check that `contact` and `review` forms appear there. They auto-detect on first deploy from the hidden form fields in `index.html`. If they don't show up, trigger a redeploy (commit any tiny change to GitHub).

**"I want to test changes locally without deploying"**
→ Open Terminal, `cd` into this folder, run `python -m http.server 8000` (or `npx serve`). Visit `http://localhost:8000`. Note: the admin panel will not work locally — it needs Netlify Identity.

---

# What this gets you

- Real photos that build trust → conversions go up
- Per-product WhatsApp inquiry → low-friction lead capture
- Before/after repair section → unique trust angle vs. competitors
- Customer reviews + photos → social proof you control
- Self-serve content updates → no dependency on a developer
- Free hosting forever
- Cross-platform: works on every phone, tablet, laptop, smart TV with a browser

---

# Future ideas (when ready)

- Pricing calculator (size × fabric × extras → estimate)
- Live chat widget (Tawk.to is free)
- Google Reviews embed (auto-syncs with your real reviews)
- Booking calendar for home consultations (Calendly free tier)
- Multi-language toggle (Hindi / Marathi)
- Blog for SEO ("How to choose between memory foam and coir mattress…")
- PWA install (add to home screen, works offline)

Message me when you're ready for any of these.

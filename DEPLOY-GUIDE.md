# Mumbai Furnishings — site & content studio guide

This folder is the entire website. It is a **static site** (plain HTML/CSS/JS) with a
**custom admin panel** at `/admin/`. There is no build step and nothing to install.

- **Live site:** https://mumbai-furnishings.netlify.app
- **Admin studio:** https://mumbai-furnishings.netlify.app/admin/
- **Repository:** https://github.com/AsifAnsari360/mumbai-furnishings-site
- **Netlify site:** https://app.netlify.com/sites/mumbai-furnishings

---

## 1. Editing the website

All text, products, photos, reviews and FAQs live in JSON files inside `data/`.
You normally never touch them by hand — you use the studio.

### Open the studio
1. Go to `/admin/`.
2. Paste your GitHub access token (see section 2).
3. Edit any section in the left menu.
4. Press **Publish** when you are ready.

Changes are saved in your browser while you work. **Nothing goes public until you
press Publish.** Publishing creates one commit on the `main` branch, and Netlify
rebuilds the live site automatically — usually within a minute.

### What you can edit
| Studio section | Controls on the site |
| --- | --- |
| Business info | Name, tagline, phone, WhatsApp, email, address, map, Google listing, socials, trust numbers, analytics IDs |
| Page copy | Hero, “Why choose us”, Process steps, B2B section, service areas, footer note |
| Products | Product cards (image, title, subtitle, category, badge, visibility) |
| Photo gallery | Gallery photos, categories and captions |
| Repairs | Before / after pairs |
| Reviews | Customer reviews (name, location, rating, service, text, approval) |
| FAQs | Questions and answers |

### Uploading images
In any image field, press **Upload image** and choose a file. The studio:
- resizes it to a maximum of 1800px,
- compresses it to WebP (JPEG fallback),
- saves it to the `/uploads/` folder when you publish.

Uploaded files get unique names, so they cache well and never clash.

---

## 2. Getting a GitHub token (one-time, ~2 minutes)

The studio talks to GitHub directly from your browser using a **fine-grained
personal access token**. It is stored only on the device you sign in from.

1. Open https://github.com/settings/personal-access-tokens/new
2. **Token name:** `Mumbai Furnishings Admin`
3. **Expiration:** 90 days or 1 year (you will create a new one when it expires).
4. **Repository access:** *Only select repositories* → `AsifAnsari360/mumbai-furnishings-site`
5. **Repository permissions:** set **Contents** to **Read and write**. Leave the rest as-is.
6. Click **Generate token**, copy it, and paste it into `/admin/`.

**Security**
- Treat the token like a password. Anyone with it can edit the site.
- Use the studio on your own device; press **Sign out** on shared computers.
- Revoke it any time at https://github.com/settings/tokens?type=beta

If the token expires or is revoked, publishing fails with a clear error — create
a new token and sign in again.

---

## 3. Netlify Forms

The site has three forms, detected automatically by Netlify:

| Form | Where it appears |
| --- | --- |
| `quote` | Full “Get a quote” section |
| `quickquote` | Quick quote modal |
| `review` | “Leave a review” modal |

**Set up notifications once, after the first deploy:**
1. Netlify dashboard → your site → **Forms**.
2. Open **Form notifications** → **Add notification** → **Email notification**.
3. Enter the inbox that should receive enquiries and save.

Test by submitting the form on the live site; the submission appears under
**Forms → Verified submissions** (first submissions may show as spam until
Netlify learns the form is real).

---

## 4. Publishing from the command line (optional)

Git push also triggers a deploy:

```bash
git add -A
git commit -m "Update site content"
git push origin main
```

## 5. Rolling back a bad change

Netlify keeps every deploy:
1. Netlify dashboard → **Deploys**.
2. Find the last good deploy → **Publish deploy**.

Or revert the commit on GitHub.

---

## 6. Before you go live — checklist

Open the studio → **Dashboard** for a live checklist. The important items:

- [ ] **Real phone and WhatsApp number** in Business info. The current values are placeholders.
- [ ] **Real email address** in Business info.
- [ ] **Google Business listing URL** (already set) — confirm it opens your listing.
- [ ] **Replace stock photos** with real photos of your work (Products, Gallery, Hero, Repairs).
- [ ] **Reviews are live** — eight verified customer reviews from the feedback survey are published. Add more or replace them as new feedback arrives.
- [ ] **Confirm the trust numbers** (years, happy homes, artisans, rating) — only publish figures you can stand behind. The 4.9 rating and 19-response count currently come from the customer feedback survey.
- [ ] **Google Analytics ID** (optional) in Business info.

---

## 7. File map

```
index.html            The whole public website (HTML + CSS + JS inline)
admin/index.html      The content studio (token login, editors, publish)
data/settings.json    Business info, contact, socials, analytics
data/content.json     Page copy (hero, about, process, B2B, areas, footer)
data/products.json    Product cards
data/gallery.json     Gallery photos
data/repairs.json     Before / after pairs
data/testimonials.json Reviews
data/faqs.json        FAQs
uploads/              Images uploaded from the studio
netlify.toml          Headers, caching and the /admin redirect
robots.txt            Allows the site, blocks /admin/
sitemap.xml           Single-page sitemap
```

## 8. Local preview

From the project root:

```bash
python3 -m http.server 8123
```

Then open http://localhost:8123/ (site) or http://localhost:8123/admin/ (studio).

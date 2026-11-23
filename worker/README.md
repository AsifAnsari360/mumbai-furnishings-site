# Otla Studio — photo pipeline

Post a photo from your phone, it appears on the website in seconds, and the same
photo comes back cropped for your WhatsApp Status. No laptop, no Netlify deploy.

```
 Phone ──photo──▶ Telegram bot
                     │ webhook
                     ▼
            Cloudflare Worker  (always on)
              ├─ uploads the original to Cloudinary
              ├─ records caption / category / status
              └─ replies with category buttons
                     │ publish
                     ▼
        otlastudio.com  ◀── /gallery feed (no rebuild)
        WhatsApp Status ◀── 9:16 image sent back, one tap to share
```

Why this shape: Cloudinary holds the image **and** the metadata (caption,
category, published/draft). The Worker has no database to maintain, and the
website reads a small JSON feed instead of being rebuilt. Publishing a photo
therefore costs **zero Netlify credits**.

---

## What you need (all free)

| Account | Used for | Free tier |
|---|---|---|
| **Cloudinary** | image storage + resizing | 25 credits/month (~25 GB) |
| **Telegram** | the bot you send photos to | free |
| **Cloudflare** | runs the Worker 24/7 | 100k requests/day |

Budget about 20 minutes, once.

---

## 1 · Cloudinary

1. Sign up at <https://cloudinary.com> (free plan).
2. Open **Dashboard**. Copy three values:
   - **Cloud name** → goes in `wrangler.toml`
   - **API Key**
   - **API Secret**

Keep the key and secret off GitHub. They are set as Worker secrets in step 4.

---

## 2 · Telegram bot

1. In Telegram, message **@BotFather** → `/newbot` → choose a name and a
   username ending in `bot`. BotFather replies with a **token** that looks like
   `1234567890:AAE...`. That is `TELEGRAM_BOT_TOKEN`.
2. Send your new bot a message: `/start`. Nothing will work yet — that is normal.

---

## 3 · Deploy the Worker

From this `worker/` folder:

```bash
npx wrangler login          # opens a browser once
```

Edit `wrangler.toml` and replace `your-cloud-name` with your Cloudinary cloud
name, then:

```bash
npx wrangler deploy
```

It prints a URL such as
`https://otla-gallery.<your-subdomain>.workers.dev`.
That URL is the gallery feed: open `<that-url>/gallery` and you should get
`{"items":[]}`. `<that-url>/health` returns `{"ok":true}`.

---

## 4 · Secrets

```bash
npx wrangler secret put CLOUDINARY_API_KEY
npx wrangler secret put CLOUDINARY_API_SECRET
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

For `TELEGRAM_WEBHOOK_SECRET` paste any long random string (letters, numbers,
`_` and `-` only). It stops strangers from posting to your bot. Make one with:

```bash
openssl rand -hex 24
```

Redeploy so the secrets are picked up:

```bash
npx wrangler deploy
```

---

## 5 · Point Telegram at the Worker

Replace both placeholders and run it once:

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "content-type: application/json" \
  -d '{"url":"https://otla-gallery.<your-subdomain>.workers.dev/telegram","secret_token":"<the same random string>"}'
```

Check it:

```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

`"last_error_message"` should be absent.

---

## 6 · Lock the bot to your phone

1. In Telegram, message your bot `/id`. It replies with your chat ID.
2. Save it as the last secret:

```bash
npx wrangler secret put OWNER_CHAT_ID
npx wrangler deploy
```

Only that chat can now use the bot. Anyone else gets "This bot is private."

---

## 7 · Switch the website on

In `index.html` (site root) find:

```html
<meta name="gallery-api" content="not-configured" />
```

and set it to your Worker's `/gallery` URL:

```html
<meta name="gallery-api" content="https://otla-gallery.<your-subdomain>.workers.dev/gallery" />
```

Commit and deploy the site **once**. From then on, photos appear without any
further deploy. Until you do this, the site keeps showing the bundled photos —
nothing breaks if the Worker is down.

---

## Daily use

1. Open Telegram, send the bot a photo.
2. Add a caption if you want one (it becomes the website caption).
3. Tap a category → **it is live instantly**.
4. Tap **📲 Send to WhatsApp** → the bot returns a 9:16 image with the caption.
   Long-press → Share → WhatsApp → My status. That last tap is the only manual
   step; WhatsApp has no official Status API.
5. Wrong photo? Tap **🗑 Unpublish**. It stays saved as a draft.

Commands: `/list` (what is live) · `/id` (chat ID) · `/start` (help).

---

## Notes

- **Originals are kept.** Cloudinary stores the full-size upload; the site asks
  for a 1400px version and WhatsApp gets a 1080×1920 crop. Nothing is
  downscaled at rest.
- **The `/admin/` gallery tab is no longer the source of truth.** Photos posted
  through the bot come from Cloudinary. The admin tab still edits
  `data/gallery.json`, which is only used as the fallback.
- **Limits.** The gallery lists the 200 most recent uploads and shows the 60
  newest. Cloudinary's Admin API is rate limited, so the feed is cached at the
  edge for 60 seconds — a new photo is live within a minute at worst.
- **One photo at a time.** Sending an album creates one draft per photo, each
  asking for a category.
- **Security.** The Worker holds the Cloudinary secret and the bot token.
  Never put them in `index.html` or the admin panel.

---

## Local test

No accounts needed — it stubs Cloudinary and Telegram:

```bash
cd worker
node test/local-test.mjs
```

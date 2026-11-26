// Otla Studio — photo pipeline
//
//   GET  /gallery    the site reads this; published photos only
//   POST /ingest     phone upload (MacroDroid / curl); publishes immediately
//   GET  /admin      private page: recategorise, unpublish, delete
//   GET  /status/:id 302 to a 9:16 version that keeps every pixel
//   GET  /health     liveness check
//   POST /telegram   Telegram webhook (still works, no longer required)
//
// Behaviour lives in `processUpdate` / `handleIngest`; nothing here holds state
// between requests, because Cloudinary itself stores the caption, category and
// publish status of every photo.

import {
  ASSET_PREFIX,
  cleanValue,
  contextString,
  deliveryUrl,
  destroyImage,
  getContext,
  listAll,
  listPublished,
  setContext,
  uploadImage,
} from "./cloudinary.js";
import {
  answerCallback,
  downloadFile,
  editMessage,
  rows,
  sendMessage,
  sendPhoto,
  tg,
} from "./telegram.js";

const CATEGORIES = [
  "Sofas",
  "Curtains",
  "Blinds",
  "Mattresses",
  "Wooden",
  "Cushions",
  "New arrivals",
];

// Photos that arrive from the phone have no category yet. They go live under
// this one and can be moved later from /admin.
const DEFAULT_CATEGORY = "New arrivals";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const CACHE_KEY = "https://otla-gallery.internal/gallery";

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
      ...extra,
    },
  });

/* ---------------------------------------------------------------- gallery */

async function handleGallery(env, ctx) {
  let cache = null;
  try {
    cache = caches.default;
  } catch {
    /* caches is unavailable outside the Workers runtime (local tests) */
  }

  const request = new Request(CACHE_KEY);
  if (cache) {
    const hit = await cache.match(request);
    if (hit) return hit;
  }

  let items;
  try {
    items = await listPublished(env);
  } catch (err) {
    console.error("gallery unavailable:", err);
    // The site falls back to its bundled photos.json on anything but 200.
    return json({ error: "gallery unavailable" }, 502);
  }

  const res = json({ items, updated: new Date().toISOString() }, 200, {
    "cache-control": "public, max-age=60",
  });
  if (cache) ctx.waitUntil(cache.put(request, res.clone()));
  return res;
}

async function purgeGallery() {
  try {
    await caches.default.delete(new Request(CACHE_KEY));
  } catch {
    /* ignore */
  }
}

/* --------------------------------------------------------------- telegram */

async function processUpdate(env, update) {
  if (update.callback_query) return handleCallback(env, update.callback_query);
  if (update.message) return handleMessage(env, update.message);
  if (update.channel_post) return handleMessage(env, update.channel_post);
  return null;
}

async function handleMessage(env, msg) {
  const chatId = msg.chat && msg.chat.id;
  if (!chatId) return;

  if (env.OWNER_CHAT_ID && String(chatId) !== String(env.OWNER_CHAT_ID)) {
    return sendMessage(env, chatId, "This bot is private.");
  }

  if (msg.text && msg.text.startsWith("/")) return handleCommand(env, chatId, msg.text);

  const photo = pickImage(msg);
  if (!photo) {
    return sendMessage(
      env,
      chatId,
      "Send me a photo and I'll put it on the site.\n\n" +
        "Tip: add a caption with the photo — it becomes the caption on the website."
    );
  }

  const caption = cleanValue(msg.caption || "", 180);
  const publicId =
    ASSET_PREFIX + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const bytes = await downloadFile(env, photo.file_id);
  const contentType = (msg.document && msg.document.mime_type) || "image/jpeg";

  await uploadImage(env, {
    bytes,
    contentType,
    publicId,
    // Uploaded as a draft: invisible on the site until a category is tapped.
    context: contextString({ caption, category: "Uncategorised", status: "draft" }),
  });

  await sendMessage(
    env,
    chatId,
    (caption ? "📷 Saved: <i>" + caption + "</i>\n\n" : "📷 Saved.\n\n") +
      "Which category? Tapping one publishes it to the site.",
    {
      reply_markup: {
        inline_keyboard: rows(
          CATEGORIES.map((c, i) => ({ text: c, callback_data: "c|" + publicId + "|" + i }))
        ),
      },
    }
  );
}

async function handleCommand(env, chatId, text) {
  const cmd = text.split(/\s+/)[0].toLowerCase();

  if (cmd === "/id") {
    return sendMessage(env, chatId, "Chat ID: <code>" + chatId + "</code>");
  }

  if (cmd === "/list") {
    const items = await listPublished(env, 8);
    if (!items.length) return sendMessage(env, chatId, "Nothing published yet.");
    return sendMessage(
      env,
      chatId,
      "<b>Published</b>\n\n" +
        items
          .map((it, i) => i + 1 + ". " + (it.caption || "(no caption)") + " — " + it.category)
          .join("\n")
    );
  }

  return sendMessage(
    env,
    chatId,
    "<b>Otla Studio photo bot</b>\n\n" +
      "• Send a photo → it uploads as a draft, then pick a category.\n" +
      "• Tapping a category publishes it on otlastudio.com instantly.\n" +
      "• After publishing you can send it straight to your WhatsApp Status.\n\n" +
      "/list — what is live\n" +
      "/id — this chat's ID"
  );
}

async function handleCallback(env, query) {
  const chatId = query.message && query.message.chat && query.message.chat.id;
  const messageId = query.message && query.message.message_id;
  const data = String(query.data || "");
  const [action, publicId, arg] = data.split("|");

  if (!chatId || !publicId) return answerCallback(env, query.id, "Nothing to do.");

  if (action === "c") {
    const idx = Number(arg);
    const category = CATEGORIES[idx];
    if (!category) return answerCallback(env, query.id, "Unknown category.");

    const current = await getContext(env, publicId);
    await setContext(env, publicId, {
      caption: current.caption || "",
      category,
      status: "published",
    });
    await purgeGallery();
    await answerCallback(env, query.id, "Published · " + category);

    if (messageId) {
      await editMessage(
        env,
        chatId,
        messageId,
        "✅ Published as <b>" + category + "</b>."
      ).catch(() => {});
    }

    return sendPhoto(
      env,
      chatId,
      deliveryUrl(env, publicId, "w_1200,c_limit,f_auto,q_auto"),
      "✅ <b>Live on the site.</b>\n\n" +
        (current.caption ? current.caption + "\n\n" : "") +
        "Category: " + category,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "📲 Send to WhatsApp", callback_data: "s|" + publicId },
              { text: "🗑 Unpublish", callback_data: "u|" + publicId },
            ],
            [{ text: "🔁 Change category", callback_data: "k|" + publicId }],
          ],
        },
      }
    );
  }

  if (action === "k") {
    await answerCallback(env, query.id, "Pick a category");
    return sendMessage(env, chatId, "Which category?", {
      reply_markup: {
        inline_keyboard: rows(
          CATEGORIES.map((c, i) => ({ text: c, callback_data: "c|" + publicId + "|" + i }))
        ),
      },
    });
  }

  if (action === "s") {
    const current = await getContext(env, publicId);
    await answerCallback(env, query.id, "Sent — save and share");
    return sendPhoto(
      env,
      chatId,
      // 9:16 canvas, but padded — the whole photo is kept, never trimmed.
      deliveryUrl(env, publicId, "w_1080,h_1920,c_pad,b_rgb:201a15,f_auto,q_auto"),
      "📲 <b>Ready for your WhatsApp Status.</b>\n\n" +
        (current.caption ? current.caption + "\n\n" : "") +
        "Long-press this photo → Share → WhatsApp → My status.",
      {
        reply_markup: {
          inline_keyboard: [[{ text: "🗑 Unpublish", callback_data: "u|" + publicId }]],
        },
      }
    );
  }

  if (action === "u") {
    const current = await getContext(env, publicId);
    await setContext(env, publicId, {
      caption: current.caption || "",
      category: current.category || "Sofas",
      status: "draft",
    });
    await purgeGallery();
    await answerCallback(env, query.id, "Unpublished");

    return sendMessage(env, chatId, "🗑 Removed from the site. It is kept as a draft.", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "✅ Publish again", callback_data: "k|" + publicId }],
        ],
      },
    });
  }

  return answerCallback(env, query.id, "Unknown action.");
}

function pickImage(msg) {
  if (Array.isArray(msg.photo) && msg.photo.length) {
    return msg.photo[msg.photo.length - 1];
  }
  if (msg.document && String(msg.document.mime_type || "").startsWith("image/")) {
    return msg.document;
  }
  return null;
}

/* ------------------------------------------------------- phone / ingest */

// Constant-time-ish comparison; both values are short shared secrets.
function sameSecret(a, b) {
  const x = new TextEncoder().encode(String(a == null ? "" : a));
  const y = new TextEncoder().encode(String(b == null ? "" : b));
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function ingestSecret(request, url) {
  const auth = request.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const cookie = request.headers.get("cookie") || "";
  const match = cookie.match(/(?:^|;\s*)otla_admin=([^;]+)/);
  if (match) return decodeURIComponent(match[1]);
  return request.headers.get("x-ingest-token") || url.searchParams.get("token") || "";
}

function base64ToBytes(value) {
  const clean = String(value || "").replace(/^data:[^,]*,/, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Read an uploaded image from any of the shapes a phone might send:
 *   • multipart/form-data with a `photo` file (browser upload)
 *   • raw binary body with an image content-type (MacroDroid, curl)
 *   • JSON { data: "<base64>" } (other automation apps)
 */
async function readImage(request) {
  const type = String(request.headers.get("content-type") || "").toLowerCase();

  if (type.startsWith("multipart/form-data")) {
    const form = await request.formData();
    for (const value of form.values()) {
      if (value && typeof value === "object" && typeof value.arrayBuffer === "function") {
        return { bytes: await value.arrayBuffer(), contentType: value.type || "image/jpeg" };
      }
    }
    throw new Error("no image field in form");
  }

  if (type.startsWith("application/json")) {
    const body = await request.json();
    const bytes = base64ToBytes(body.data || body.image || "");
    if (!bytes.length) throw new Error("no image data");
    return { bytes: bytes.buffer, contentType: body.contentType || "image/jpeg" };
  }

  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) throw new Error("empty body");
  return {
    bytes,
    contentType: type.startsWith("image/") ? type.split(";")[0] : "image/jpeg",
  };
}

async function handleIngest(request, env, url) {
  if (!env.INGEST_TOKEN) return json({ error: "ingest is not configured" }, 503);
  if (!sameSecret(ingestSecret(request, url), env.INGEST_TOKEN)) {
    return json({ error: "forbidden" }, 403);
  }

  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_UPLOAD_BYTES) return json({ error: "photo too large" }, 413);

  let image;
  try {
    image = await readImage(request);
  } catch (err) {
    return json({ error: String(err.message || err) }, 400);
  }
  if (image.bytes.byteLength > MAX_UPLOAD_BYTES) {
    return json({ error: "photo too large" }, 413);
  }

  const caption = cleanValue(
    url.searchParams.get("caption") || request.headers.get("x-caption") || "",
    180
  );
  const asked = cleanValue(url.searchParams.get("category") || "", 40);
  const category = CATEGORIES.includes(asked) ? asked : DEFAULT_CATEGORY;
  const status = url.searchParams.get("draft") === "1" ? "draft" : "published";

  const publicId =
    ASSET_PREFIX + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  let uploaded;
  try {
    uploaded = await uploadImage(env, {
      bytes: image.bytes,
      contentType: image.contentType,
      publicId,
      context: contextString({ caption, category, status }),
    });
  } catch (err) {
    console.error("ingest upload failed:", err);
    return json({ error: "upload failed" }, 502);
  }

  await purgeGallery();

  return json({
    ok: true,
    id: publicId,
    category,
    status,
    caption,
    width: uploaded.width,
    height: uploaded.height,
    image: deliveryUrl(env, publicId, "w_1400,c_limit,f_auto,q_auto"),
    // Full-bleed 9:16 version with the whole photo kept (padded, never cropped).
    story: deliveryUrl(env, publicId, "w_1080,h_1920,c_pad,b_rgb:201a15,f_auto,q_auto"),
  });
}

async function handleStatus(env, id) {
  if (!/^otla-gallery-[a-z0-9]+$/i.test(id)) return json({ error: "not found" }, 404);
  return Response.redirect(
    deliveryUrl(env, id, "w_1080,h_1920,c_pad,b_rgb:201a15,f_auto,q_auto"),
    302
  );
}

/* ------------------------------------------------------------- admin page */

const html = (body, status = 200, extra = {}) =>
  new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      "referrer-policy": "no-referrer",
      ...extra,
    },
  });

const esc = (value) =>
  String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function adminLogin(error) {
  return html(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
     <title>Otla Studio — photos</title>
     <style>body{margin:0;font-family:system-ui,sans-serif;background:#f6efe3;color:#201a15;
     display:grid;place-items:center;min-height:100vh}form{background:#fff;padding:28px;
     border-radius:16px;box-shadow:0 20px 50px rgba(32,26,21,.12);width:min(92vw,340px)}
     h1{font-size:1rem;margin:0 0 6px}p{font-size:.82rem;color:#6b5f55;margin:0 0 18px}
     input{width:100%;padding:11px;border:1px solid #d8cbb8;border-radius:9px;font-size:.9rem;
     box-sizing:border-box}button{margin-top:12px;width:100%;padding:11px;border:0;
     border-radius:9px;background:#201a15;color:#f6efe3;font-weight:700;font-size:.9rem}
     .err{color:#a33;font-size:.8rem;margin-top:10px}</style>
     <form method="get" action="/admin"><h1>Otla Studio photos</h1>
     <p>Paste your key to manage the gallery.</p>
     <input name="token" type="password" autofocus autocomplete="current-password">
     <button>Open</button>${error ? '<div class="err">Wrong key.</div>' : ""}</form>`
  );
}

function renderAdmin(items, env) {
  const live = items.filter((i) => i.status === "published").length;
  const card = (it) => {
    const thumb = deliveryUrl(env, it.id, "w_420,c_limit,f_auto,q_auto");
    return `<article class="card">
      <img src="${esc(thumb)}" alt="" loading="lazy">
      <span class="badge ${it.status}">${it.status === "published" ? "Live" : "Draft"}</span>
      <form method="post" action="/admin">
        <input type="hidden" name="id" value="${esc(it.id)}">
        <input name="caption" value="${esc(it.caption)}" placeholder="Caption" maxlength="180">
        <select name="category">${CATEGORIES.map(
          (c) => `<option${c === it.category ? " selected" : ""}>${esc(c)}</option>`
        ).join("")}</select>
        <div class="row">
          <button name="action" value="save">${it.status === "published" ? "Save" : "Publish"}</button>
          <button name="action" value="${it.status === "published" ? "unpublish" : "delete"}"
            class="quiet">${it.status === "published" ? "Unpublish" : "Delete"}</button>
        </div>
      </form>
    </article>`;
  };

  return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Otla Studio — photos</title>
  <style>
    :root{--ink:#201a15;--paper:#f6efe3;--line:#e0d3c0}
    body{margin:0;padding:22px;font-family:system-ui,-apple-system,sans-serif;
      background:var(--paper);color:var(--ink)}
    header{max-width:1100px;margin:0 auto 18px;display:flex;justify-content:space-between;
      align-items:baseline;gap:12px;flex-wrap:wrap}
    h1{font-size:1.05rem;margin:0;letter-spacing:.02em}
    .meta{font-size:.78rem;color:#6b5f55}
    .grid{max-width:1100px;margin:0 auto;display:grid;gap:14px;
      grid-template-columns:repeat(auto-fill,minmax(230px,1fr))}
    .card{position:relative;background:#fff;border:1px solid var(--line);border-radius:14px;
      overflow:hidden;display:flex;flex-direction:column}
    .card img{width:100%;height:auto;display:block;background:#eee}
    .badge{position:absolute;top:8px;left:8px;font-size:.65rem;font-weight:700;
      padding:4px 8px;border-radius:999px;background:#201a15;color:#f6efe3}
    .badge.draft{background:#b98a3a}
    form{padding:10px;display:flex;flex-direction:column;gap:7px}
    input,select{width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;
      font-size:.8rem;box-sizing:border-box;background:#fffdf9}
    .row{display:flex;gap:7px}
    button{flex:1;padding:9px;border:0;border-radius:8px;background:#201a15;color:#f6efe3;
      font-weight:700;font-size:.78rem;cursor:pointer}
    button.quiet{background:#efe6d8;color:#5a4d42}
    .empty{max-width:1100px;margin:40px auto;text-align:center;color:#6b5f55;font-size:.9rem}
  </style>
  <header>
    <h1>Otla Studio photos</h1>
    <div class="meta">${items.length} photo${items.length === 1 ? "" : "s"} · ${live} live</div>
  </header>
  ${
    items.length
      ? `<div class="grid">${items.map(card).join("")}</div>`
      : `<p class="empty">No photos yet. Take one with your phone and it lands here.</p>`
  }`;
}

async function handleAdmin(request, env, url) {
  if (!env.INGEST_TOKEN) return html("Not configured.", 503);

  if (request.method === "GET") {
    const token = ingestSecret(request, url);
    if (!sameSecret(token, env.INGEST_TOKEN)) return adminLogin(false);

    // Move the key out of the address bar into an HttpOnly cookie once.
    if (url.searchParams.get("token")) {
      return new Response(null, {
        status: 303,
        headers: {
          location: "/admin",
          "set-cookie":
            "otla_admin=" +
            encodeURIComponent(token) +
            "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000",
        },
      });
    }

    return html(renderAdmin(await listAll(env), env));
  }

  if (request.method !== "POST") return html("Method not allowed", 405);

  let form;
  try {
    form = await request.formData();
  } catch {
    return html("Bad request", 400);
  }

  const token = String(form.get("token") || "") || ingestSecret(request, url);
  if (!sameSecret(token, env.INGEST_TOKEN)) return adminLogin(true);

  const id = String(form.get("id") || "");
  if (!id.startsWith(ASSET_PREFIX)) return html("Unknown photo", 400);

  const action = String(form.get("action") || "save");
  const current = await getContext(env, id);

  if (action === "delete") {
    await destroyImage(env, id);
  } else if (action === "unpublish") {
    await setContext(env, id, {
      caption: current.caption || "",
      category: current.category || DEFAULT_CATEGORY,
      status: "draft",
    });
  } else {
    const asked = cleanValue(form.get("category"), 40);
    await setContext(env, id, {
      caption: cleanValue(form.get("caption"), 180) || current.caption || "",
      category: CATEGORIES.includes(asked) ? asked : DEFAULT_CATEGORY,
      status: "published",
    });
  }

  await purgeGallery();
  return new Response(null, { status: 303, headers: { location: "/admin" } });
}

/* ----------------------------------------------------------------- worker */

const BOT = "https://api.telegram.org/bot";

async function webhookInfo(env) {
  const res = await fetch(BOT + env.TELEGRAM_BOT_TOKEN + "/getWebhookInfo");
  return await res.json();
}

// Idempotent: safe to call from the cron, from the setup endpoint, or twice.
async function ensureWebhook(env) {
  const expected = String(env.PUBLIC_ORIGIN || "").replace(/\/+$/, "") + "/telegram";
  const info = await webhookInfo(env);
  if (!info.ok) return info; // throttled — the cron will try again
  if (info.result && info.result.url === expected) {
    return { ok: true, already: true, url: expected };
  }
  const res = await fetch(BOT + env.TELEGRAM_BOT_TOKEN + "/setWebhook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: expected,
      secret_token: env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: true,
    }),
  });
  return await res.json();
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && /^\/gallery\/?$/.test(url.pathname)) {
      return handleGallery(env, ctx);
    }

    if (request.method === "POST" && url.pathname === "/ingest") {
      return handleIngest(request, env, url);
    }

    if (url.pathname === "/admin") {
      return handleAdmin(request, env, url);
    }

    if (request.method === "GET" && url.pathname.startsWith("/status/")) {
      return handleStatus(env, url.pathname.slice("/status/".length));
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "otla-gallery" });
    }

    // Repair hook: lets the Worker register its own Telegram webhook from
    // Cloudflare's network (useful when the local IP is rate limited).
    if (
      (request.method === "POST" && url.pathname === "/setup/webhook") ||
      (request.method === "GET" && url.pathname === "/setup/info")
    ) {
      const auth = request.headers.get("authorization") || "";
      if (!env.TELEGRAM_WEBHOOK_SECRET || auth !== "Bearer " + env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }
      if (url.pathname.endsWith("info")) return json(await webhookInfo(env));
      return json(await ensureWebhook(env));
    }

    if (request.method === "POST" && url.pathname === "/telegram") {
      const secret = request.headers.get("x-telegram-bot-api-secret-token");
      if (env.TELEGRAM_WEBHOOK_SECRET && secret !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }

      let update;
      try {
        update = await request.json();
      } catch {
        return new Response("bad request", { status: 400 });
      }

      // Answer Telegram immediately; do the slow work in the background.
      ctx.waitUntil(
        processUpdate(env, update).catch(async (err) => {
          console.error("update failed:", err);
          const chatId =
            (update.message && update.message.chat && update.message.chat.id) ||
            (update.callback_query &&
              update.callback_query.message &&
              update.callback_query.message.chat.id);
          if (chatId) {
            await sendMessage(env, chatId, "⚠️ " + String(err.message || err)).catch(() => {});
          }
        })
      );
      return new Response("ok");
    }

    return json({ error: "not found" }, 404);
  },

  // Cron: keep the Telegram webhook pointed at this Worker. Telegram throttles
  // freshly created bots, so this is how it eventually gets registered without
  // anyone watching.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      ensureWebhook(env)
        .then((r) => console.log("webhook tick:", JSON.stringify(r)))
        .catch((err) => console.error("webhook tick failed:", err))
    );
  },
};

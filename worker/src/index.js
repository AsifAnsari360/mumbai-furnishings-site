// Otla Studio — photo pipeline
//
//   GET  /gallery    the site reads this; published photos only
//   GET  /health     liveness check
//   POST /telegram   Telegram webhook (photo in, publish buttons out)
//
// Behaviour lives in `processUpdate`; nothing here holds state between
// requests, because Cloudinary itself stores the caption, category and
// publish status of every photo.

import {
  ASSET_PREFIX,
  cleanValue,
  contextString,
  deliveryUrl,
  getContext,
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

const CATEGORIES = ["Sofas", "Curtains", "Blinds", "Mattresses", "Wooden", "Cushions"];

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
      deliveryUrl(env, publicId, "w_1080,h_1920,c_fill,g_auto,f_auto,q_auto"),
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

/* ----------------------------------------------------------------- worker */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && /^\/gallery\/?$/.test(url.pathname)) {
      return handleGallery(env, ctx);
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "otla-gallery" });
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
};

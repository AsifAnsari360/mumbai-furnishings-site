// Offline test for the worker. No network, no Cloudinary account, no Telegram.
//
//   node test/local-test.mjs
//
// It stubs `fetch` with a fake Cloudinary + Telegram, then drives the real
// request handler exactly as the webhook would.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const env = {
  CLOUDINARY_CLOUD_NAME: "otla-demo",
  CLOUDINARY_API_KEY: "1234567890",
  CLOUDINARY_API_SECRET: "super-secret",
  TELEGRAM_BOT_TOKEN: "123:ABC",
  TELEGRAM_WEBHOOK_SECRET: "hook-secret",
  OWNER_CHAT_ID: "",
  INGEST_TOKEN: "phone-key-123",
};

const sha1 = (s) => createHash("sha1").update(s).digest("hex");
const jsonRes = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// ---- fake backend --------------------------------------------------------

const sent = []; // every Telegram call
const requestLog = []; // every outbound HTTP call
let uploaded = null; // parsed upload form
const contexts = new Map(); // public_id -> { caption, category, status }

const seed = [
  {
    public_id: "otla-gallery-aaa",
    created_at: "2026-11-20T10:00:00Z",
    context: { custom: { caption: "Older sofa", category: "Sofas", status: "published" } },
  },
  {
    public_id: "otla-gallery-bbb",
    created_at: "2026-11-22T10:00:00Z",
    context: { custom: { caption: "Newest sofa", category: "Sofas", status: "published" } },
  },
  {
    public_id: "otla-gallery-ccc",
    created_at: "2026-11-21T10:00:00Z",
    context: { custom: { caption: "Hidden draft", category: "Curtains", status: "draft" } },
  },
];
seed.forEach((r) => contexts.set(r.public_id, r.context.custom));

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  const u = new URL(url);
  requestLog.push({ url, method: init.method || "GET" });

  // Cloudinary upload
  if (
    u.host === "api.cloudinary.com" &&
    u.pathname === `/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/upload`
  ) {
    assert.equal(init.method, "POST");
    const form = init.body;
    uploaded = {
      api_key: form.get("api_key"),
      timestamp: form.get("timestamp"),
      public_id: form.get("public_id"),
      context: form.get("context"),
      signature: form.get("signature"),
      fileType: form.get("file").type,
    };
    contexts.set(
      uploaded.public_id,
      Object.fromEntries(uploaded.context.split("|").map((p) => p.split("=")))
    );
    return jsonRes({ public_id: uploaded.public_id, secure_url: "https://x/y.jpg", width: 1280, height: 960 });
  }

  // Cloudinary list
  if (
    u.host === "api.cloudinary.com" &&
    u.pathname === `/v1_1/${env.CLOUDINARY_CLOUD_NAME}/resources/image/upload` &&
    u.searchParams.has("prefix")
  ) {
    const resources = [...contexts.entries()].map(([public_id, c]) => ({
      public_id,
      created_at:
        (seed.find((s) => s.public_id === public_id) || {}).created_at ||
        new Date().toISOString(),
      context: { custom: { ...c } },
    }));
    return jsonRes({ resources });
  }

  // Cloudinary single resource (GET) or update (POST)
  if (u.host === "api.cloudinary.com" && u.pathname.includes("/resources/image/upload/")) {
    const id = decodeURIComponent(u.pathname.split("/").pop());
    if (init.method === "POST") {
      const params = new URLSearchParams(init.body);
      const pairs = Object.fromEntries(
        params
          .get("context")
          .split("|")
          .map((p) => p.split("="))
      );
      contexts.set(id, pairs);
      return jsonRes({ public_id: id });
    }
    return jsonRes({ context: { custom: { ...contexts.get(id) } } });
  }

  // Telegram
  if (u.host === "api.telegram.org") {
    if (u.pathname.endsWith("/getFile")) {
      return jsonRes({ ok: true, result: { file_path: "photos/file_1.jpg" } });
    }
    if (u.pathname.includes("/file/bot")) {
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    }
    const method = u.pathname.split("/").pop();
    const payload = init.body ? JSON.parse(init.body) : {};
    sent.push({ method, payload });
    return jsonRes({ ok: true, result: {} });
  }

  throw new Error("Unexpected fetch: " + url);
};

// `caches` does not exist in Node — the worker guards for that.
const pending = [];
const ctx = { waitUntil: (p) => pending.push(p) };

const { default: worker } = await import("../src/index.js");

const call = async (path, init = {}) => {
  const res = await worker.fetch(new Request("https://worker.test" + path, init), env, ctx);
  await Promise.all(pending.splice(0));
  return res;
};

const postTelegram = (update) =>
  call("/telegram", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": env.TELEGRAM_WEBHOOK_SECRET,
    },
    body: JSON.stringify(update),
  });

// ---- 1. gallery ----------------------------------------------------------

{
  const res = await call("/gallery");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.items.length, 2, "drafts must be hidden");
  assert.equal(body.items[0].caption, "Newest sofa", "newest first");
  assert.equal(body.items[1].caption, "Older sofa");
  assert.ok(body.items[0].image.includes("f_auto,q_auto"), "transformed delivery URL");
  assert.ok(body.items[0].image.includes("otla-gallery-bbb"));
  console.log("✓ gallery returns published items, newest first");
}

// ---- 2. photo in, keyboard out ------------------------------------------

const photoUpdate = {
  update_id: 1,
  message: {
    message_id: 10,
    chat: { id: 777 },
    caption: "L-shape in Kharadi",
    photo: [
      { file_id: "small", width: 90, height: 90 },
      { file_id: "large", width: 1280, height: 960 },
    ],
  },
};

let publicId = "";

{
  const res = await postTelegram(photoUpdate);
  assert.equal(res.status, 200);

  assert.ok(uploaded, "photo was uploaded");
  assert.equal(uploaded.api_key, env.CLOUDINARY_API_KEY);
  assert.equal(uploaded.fileType, "image/jpeg");
  assert.equal(uploaded.context, "caption=L-shape in Kharadi|category=Uncategorised|status=draft");

  // Recompute the signature independently.
  const expected = sha1(
    ["context", "public_id", "timestamp"]
      .sort()
      .map((k) => k + "=" + uploaded[k])
      .join("&") + env.CLOUDINARY_API_SECRET
  );
  assert.equal(uploaded.signature, expected, "upload signature must match Cloudinary's rule");
  publicId = uploaded.public_id;
  assert.match(publicId, /^otla-gallery-/);

  const kb = sent.at(-1);
  assert.equal(kb.method, "sendMessage");
  const buttons = kb.payload.reply_markup.inline_keyboard.flat();
  assert.equal(buttons.length, 7);
  assert.equal(buttons[0].text, "Sofas");
  assert.ok(buttons[0].callback_data.length < 64, "callback_data must fit in 64 bytes");
  console.log("✓ photo uploads as a draft with a valid signature and a category keyboard");
}

// ---- 3. category tap publishes ------------------------------------------

{
  await postTelegram({
    update_id: 2,
    callback_query: {
      id: "cb1",
      data: "c|" + publicId + "|0",
      message: { message_id: 11, chat: { id: 777 } },
    },
  });

  const saved = contexts.get(publicId);
  assert.equal(saved.status, "published");
  assert.equal(saved.category, "Sofas");
  assert.equal(saved.caption, "L-shape in Kharadi", "caption survives the update");

  const preview = sent.filter((s) => s.method === "sendPhoto").at(-1);
  assert.ok(preview.payload.photo.includes("w_1200"), "preview uses the 1200px transform");
  const kb = preview.payload.reply_markup.inline_keyboard.flat().map((b) => b.text);
  assert.deepEqual(kb, ["📲 Send to WhatsApp", "🗑 Unpublish", "🔁 Change category"]);

  // Gallery must now include it (cache is skipped in Node).
  const body = await (await call("/gallery")).json();
  assert.equal(body.items.length, 3);
  console.log("✓ tapping a category publishes and shows the WhatsApp button");
}

// ---- 4. status handoff ---------------------------------------------------

{
  await postTelegram({
    update_id: 3,
    callback_query: {
      id: "cb2",
      data: "s|" + publicId,
      message: { message_id: 12, chat: { id: 777 } },
    },
  });

  const status = sent.filter((s) => s.method === "sendPhoto").at(-1);
  assert.ok(status.payload.photo.includes("w_1080,h_1920"), "9:16 crop for status");
  assert.ok(status.payload.caption.includes("My status"), "tells the owner the last tap");
  assert.ok(status.payload.caption.includes("L-shape in Kharadi"), "caption travels with it");
  console.log("✓ status image is 9:16 and padded, never cropped");
}

// ---- 5. unpublish --------------------------------------------------------

{
  await postTelegram({
    update_id: 4,
    callback_query: {
      id: "cb3",
      data: "u|" + publicId,
      message: { message_id: 13, chat: { id: 777 } },
    },
  });

  assert.equal(contexts.get(publicId).status, "draft");
  const body = await (await call("/gallery")).json();
  assert.equal(body.items.length, 2, "unpublished photo disappears");
  console.log("✓ unpublish removes it from the gallery and keeps the draft");
}

// ---- 6. webhook auth -----------------------------------------------------

{
  const res = await call("/telegram", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(photoUpdate),
  });
  assert.equal(res.status, 403, "wrong secret must be rejected");
  console.log("✓ webhook rejects requests without the secret");
}

// ---- 7. wrong chat -------------------------------------------------------

{
  const before = sent.length;
  await postTelegram({
    update_id: 5,
    message: {
      message_id: 20,
      chat: { id: 999 },
      text: "/start",
    },
  });
  // OWNER_CHAT_ID is empty here, so /start is answered normally.
  assert.equal(sent.length, before + 1);
  console.log("✓ commands answer in the chat");
}

// ---- 8. owner lock -------------------------------------------------------

{
  env.OWNER_CHAT_ID = "777";
  const before = sent.length;

  await postTelegram({
    update_id: 6,
    message: { message_id: 30, chat: { id: 999 }, text: "/start" },
  });
  assert.equal(sent.at(-1).payload.text, "This bot is private.");
  assert.equal(sent.length, before + 1);

  await postTelegram({
    update_id: 7,
    message: { message_id: 31, chat: { id: 777 }, text: "/start" },
  });
  assert.ok(sent.at(-1).payload.text.includes("photo bot"), "owner still gets the help");
  assert.equal(sent.length, before + 2);

  env.OWNER_CHAT_ID = "";
  console.log("✓ owner lock blocks other chats and lets the owner through");
}

// ---- 9. phone ingest -----------------------------------------------------

let ingestedId = "";

{
  const noKey = await call("/ingest", {
    method: "POST",
    headers: { "content-type": "image/jpeg" },
    body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
  });
  assert.equal(noKey.status, 403, "ingest rejects a missing key");

  const res = await call("/ingest", {
    method: "POST",
    headers: {
      "content-type": "image/jpeg",
      "x-ingest-token": env.INGEST_TOKEN,
      "x-caption": "Teal tufted headboard",
    },
    body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
  });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.category, "New arrivals", "uncategorised photos get a default");
  assert.equal(out.status, "published", "phone photos go live immediately");
  assert.ok(out.story.includes("w_1080,h_1920,c_pad"), "status version is padded, not cropped");
  assert.ok(out.image.includes("w_1400,c_limit"), "site version never upscales");
  assert.equal(contexts.get(out.id).status, "published");
  assert.equal(contexts.get(out.id).caption, "Teal tufted headboard");
  ingestedId = out.id;

  const body = await (await call("/gallery")).json();
  assert.equal(body.items.length, 3, "ingested photo shows in the feed");
  assert.equal(body.items[0].category, "New arrivals");
  console.log("✓ a phone upload with the key goes live with no Telegram and no taps");
}

// ---- 10. status image without cropping ----------------------------------

{
  const res = await call("/status/" + ingestedId);
  assert.equal(res.status, 302);
  const location = res.headers.get("location");
  assert.ok(location.includes("c_pad"), "pads instead of trimming");
  assert.ok(location.includes("w_1080,h_1920"));
  assert.equal((await call("/status/nope")).status, 404);
  console.log("✓ the status image keeps every pixel");
}

// ---- 11. admin page ------------------------------------------------------

{
  const denied = await call("/admin");
  assert.equal(denied.status, 200);
  assert.ok((await denied.text()).includes("Paste your key"));

  const login = await call("/admin?token=" + env.INGEST_TOKEN);
  assert.equal(login.status, 303, "key moves into a cookie");
  assert.ok(login.headers.get("set-cookie").includes("HttpOnly"));

  const cookie = "otla_admin=" + encodeURIComponent(env.INGEST_TOKEN);
  const page = await call("/admin", { headers: { cookie } });
  const text = await page.text();
  assert.ok(text.includes(ingestedId), "the photo is listed");
  assert.ok(text.includes("Teal tufted headboard"), "caption is editable");

  const form = new FormData();
  form.append("id", ingestedId);
  form.append("action", "unpublish");
  const posted = await call("/admin", { method: "POST", headers: { cookie }, body: form });
  assert.equal(posted.status, 303);
  assert.equal(contexts.get(ingestedId).status, "draft", "admin can pull a photo");

  const after = await (await call("/gallery")).json();
  assert.equal(after.items.length, 2);
  console.log("✓ admin page is key-protected and can unpublish");
}

console.log("\nAll checks passed.");

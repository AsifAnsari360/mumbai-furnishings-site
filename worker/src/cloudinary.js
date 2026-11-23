// Cloudinary helpers.
//
// Two different auth modes are used by Cloudinary:
//   • Upload API      -> signed parameters (api_key + signature)
//   • Admin API       -> HTTP Basic auth (api_key:api_secret)
// Both are used here, and nothing in this file is ever sent to a browser.

const API_ROOT = (cloud) => "https://api.cloudinary.com/v1_1/" + cloud;

// Public IDs are flat (no slashes) so they can be dropped straight into an
// Admin API path without any encoding surprises. All gallery assets share the
// prefix below, which is how the gallery is listed.
export const ASSET_PREFIX = "otla-gallery-";

const hex = (buffer) =>
  Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");

const sha1 = async (value) =>
  hex(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(value)));

const basicAuth = (env) =>
  "Basic " + btoa(env.CLOUDINARY_API_KEY + ":" + env.CLOUDINARY_API_SECRET);

// Cloudinary signs the alphabetically sorted, *unencoded* parameter string.
export async function sign(params, secret) {
  const toSign = Object.keys(params)
    .sort()
    .map((k) => k + "=" + params[k])
    .join("&");
  return sha1(toSign + secret);
}

// Context is transmitted as `key=value|key=value`, so the separators are
// stripped from user text and whitespace is collapsed.
export function cleanValue(value, max = 180) {
  return String(value == null ? "" : value)
    .replace(/[|=]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function contextString({ caption, category, status }) {
  return [
    "caption=" + cleanValue(caption),
    "category=" + cleanValue(category, 40),
    "status=" + cleanValue(status, 20),
  ].join("|");
}

// Delivery URL with a transformation applied on the fly. The original 4K file
// is never touched; Cloudinary derives the size the page asks for.
export function deliveryUrl(env, publicId, transform) {
  return (
    "https://res.cloudinary.com/" +
    env.CLOUDINARY_CLOUD_NAME +
    "/image/upload/" +
    transform +
    "/" +
    publicId
  );
}

async function ensureOk(res, what) {
  if (res.ok) return res;
  const body = await res.text().catch(() => "");
  throw new Error(what + " failed: HTTP " + res.status + " " + body.slice(0, 300));
}

/**
 * Upload a photo. `context` is part of the signature, so it must be passed in
 * exactly as it will be sent.
 */
export async function uploadImage(env, { bytes, contentType, publicId, context }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { context, public_id: publicId, timestamp };
  const signature = await sign(params, env.CLOUDINARY_API_SECRET);

  const ext = contentType === "image/png" ? "png" : "jpg";
  const form = new FormData();
  form.append(
    "file",
    new Blob([bytes], { type: contentType || "image/jpeg" }),
    publicId + "." + ext
  );
  form.append("api_key", env.CLOUDINARY_API_KEY);
  form.append("timestamp", String(timestamp));
  form.append("public_id", publicId);
  form.append("context", context);
  form.append("signature", signature);

  const res = await ensureOk(
    await fetch(API_ROOT(env.CLOUDINARY_CLOUD_NAME) + "/image/upload", {
      method: "POST",
      body: form,
    }),
    "upload"
  );
  return await res.json();
}

/** Read the contextual metadata currently attached to one asset. */
export async function getContext(env, publicId) {
  const url =
    API_ROOT(env.CLOUDINARY_CLOUD_NAME) +
    "/resources/image/upload/" +
    encodeURIComponent(publicId) +
    "?context=true";
  const res = await ensureOk(
    await fetch(url, { headers: { Authorization: basicAuth(env) } }),
    "getContext"
  );
  const data = await res.json();
  return (data.context && data.context.custom) || {};
}

/** Overwrite caption/category/status in one call (Cloudinary merges per key). */
export async function setContext(env, publicId, context) {
  const url =
    API_ROOT(env.CLOUDINARY_CLOUD_NAME) +
    "/resources/image/upload/" +
    encodeURIComponent(publicId);
  const res = await ensureOk(
    await fetch(url, {
      method: "POST",
      headers: {
        Authorization: basicAuth(env),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ context: contextString(context) }).toString(),
    }),
    "setContext"
  );
  return await res.json();
}

/**
 * Every published photo, newest first, in the shape the site already expects:
 * { image, category, caption }.
 */
export async function listPublished(env, limit = 60) {
  const url = new URL(API_ROOT(env.CLOUDINARY_CLOUD_NAME) + "/resources/image/upload");
  url.searchParams.set("prefix", ASSET_PREFIX);
  url.searchParams.set("max_results", "200");
  url.searchParams.set("context", "true");

  const res = await ensureOk(
    await fetch(url.toString(), { headers: { Authorization: basicAuth(env) } }),
    "list"
  );
  const { resources = [] } = await res.json();

  return resources
    .map((r) => ({ r, ctx: (r.context && r.context.custom) || {} }))
    .filter(({ ctx }) => ctx.status === "published")
    .sort((a, b) => String(b.r.created_at).localeCompare(String(a.r.created_at)))
    .slice(0, limit)
    .map(({ r, ctx }) => ({
      image: deliveryUrl(env, r.public_id, "w_1400,c_limit,f_auto,q_auto"),
      category: ctx.category || "Sofas",
      caption: ctx.caption || "",
    }));
}

// Thin wrapper around the Telegram Bot API. No state, no dependencies.

const api = (env, method) =>
  "https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/" + method;

export async function tg(env, method, payload) {
  const res = await fetch(api(env, method), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  const data = await res.json().catch(() => ({ ok: false }));
  if (!data.ok && method !== "answerCallbackQuery") {
    throw new Error("Telegram " + method + ": " + (data.description || res.status));
  }
  return data;
}

export const sendMessage = (env, chatId, text, extra = {}) =>
  tg(env, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra,
  });

// Sends by URL — Telegram fetches the image itself, so nothing is re-uploaded.
export const sendPhoto = (env, chatId, url, caption, extra = {}) =>
  tg(env, "sendPhoto", {
    chat_id: chatId,
    photo: url,
    caption,
    parse_mode: "HTML",
    ...extra,
  });

export const editMessage = (env, chatId, messageId, text, extra = {}) =>
  tg(env, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra,
  });

export const answerCallback = (env, id, text) =>
  tg(env, "answerCallbackQuery", { callback_query_id: id, text: text || "" });

export async function downloadFile(env, fileId) {
  const meta = await tg(env, "getFile", { file_id: fileId });
  const path = meta.result && meta.result.file_path;
  if (!path) throw new Error("Telegram getFile returned no file_path");
  const res = await fetch(
    "https://api.telegram.org/file/bot" + env.TELEGRAM_BOT_TOKEN + "/" + path
  );
  if (!res.ok) throw new Error("Could not download the photo: HTTP " + res.status);
  return await res.arrayBuffer();
}

/** Split a list into rows for an inline keyboard. */
export function rows(list, perRow = 3) {
  const out = [];
  for (let i = 0; i < list.length; i += perRow) out.push(list.slice(i, i + perRow));
  return out;
}

// /api/invoice-attach.js
// 1) /k/v1/file.json に multipart(UTF-8, filename*=) でアップ → fileKey
// 2) /k/v1/record.json で添付フィールドを更新（追記 or 置換）
import Busboy from "busboy";

export const config = { api: { bodyParser: false, externalResolver: true } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method Not Allowed" });

  const baseUrl   = process.env.KINTONE_BASE_URL;                 // 例: https://xxxxx.cybozu.com
  const appId     = process.env.KINTONE_INBOUND_APP_ID;           // 添付先アプリID
  const token     = process.env.KINTONE_INBOUND_API_TOKEN;        // 書き込み権限付きトークン
  const fileField = process.env.KINTONE_FILE_FIELD || "invoiceFile";
  const appendMode = (process.env.KINTONE_FILE_APPEND || "true").toLowerCase() === "true";

  if (!baseUrl || !appId || !token) {
    return res.status(500).json({ message: "Kintone env vars not set" });
  }

  try {
    const { fields, file } = await parseMultipart(req);
    const recordId = fields?.recordId?.trim();
    if (!recordId) return res.status(400).json({ message: "recordId is required" });
    if (!file)     return res.status(400).json({ message: "file is required" });

    // (1) file.json → fileKey（UTF-8 ファイル名対応）
    const fileKey = await uploadToKintoneFileAPI_UTF8({
      baseUrl,
      token,
      filename: file.filename || "upload",
      mimetype: file.mimetype || "application/octet-stream",
      buffer: file.buffer,
    });

    // (2) 追記モードなら既存ファイルも維持
    let filesForUpdate = [{ fileKey }];
    if (appendMode) {
      const existing = await fetchRecordFiles({ baseUrl, appId, token, recordId, fileField });
      const keep = (existing || []).map(f => f.fileKey ? { fileKey: f.fileKey } : null).filter(Boolean);
      filesForUpdate = [...keep, { fileKey }];
    }

    // (3) record.json で更新
    await updateKintoneRecord({ baseUrl, appId, token, recordId, fileField, files: filesForUpdate });

    return res.status(200).json({ ok: true, recordId, fileField, mode: appendMode ? "append" : "replace" });
  } catch (err) {
    console.error("[invoice-attach] error:", err);
    return res.status(500).json({ message: err?.message || "attach failed" });
  }
}

/* ========== helpers ========== */

// Busboy（v1 の新API/旧API 両対応）— 受け取ったファイル名は必ず文字列化して保持
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers });
    const fields = {};
    let file = null;

    bb.on("file", (fieldname, stream, a, b, c) => {
      const info = (a && typeof a === "object" && ("filename" in a || "mimeType" in a)) ? a : null;
      const rawName = info ? info.filename : (typeof a === "string" ? a : "upload");
      const filename = sanitizeFilename(rawName);
      const mimeType = info
        ? (info.mimeType || info.mime || "application/octet-stream")
        : (typeof c === "string" ? c : "application/octet-stream");

      const chunks = [];
      stream.on("data", d => chunks.push(d));
      stream.on("end", () => {
        file = { fieldname, filename, mimetype: mimeType, buffer: Buffer.concat(chunks) };
      });
      stream.on("error", reject);
    });

    bb.on("field", (name, val) => { fields[name] = val; });
    bb.on("error", reject);
    bb.on("finish", () => resolve({ fields, file }));

    req.pipe(bb);
  });
}

// Windows 禁止文字を避けつつ拡張子は維持
function sanitizeFilename(name) {
  return String(name || "upload").replace(/[\\\/:*?"<>|]+/g, "_").slice(0, 255) || "upload";
}

// RFC 5987/8187 形式で UTF-8 をパーセントエンコード
function encodeRFC5987ValueChars(str) {
  return encodeURIComponent(str)
    .replace(/['()]/g, escape)
    .replace(/\*/g, '%2A')
    .replace(/%(7C|60|5E)/g, (m, p1) => '%' + p1.toLowerCase());
}

// ★UTF-8 ファイル名で multipart を自前生成して kintone に送る
async function uploadToKintoneFileAPI_UTF8({ baseUrl, token, filename, mimetype, buffer }) {
  const boundary = "----kitoneFormData" + Math.random().toString(16).slice(2);
  const CRLF = "\r\n";
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, "_");          // ASCII以外は _ に
  const filenameStar = `UTF-8''${encodeRFC5987ValueChars(filename)}`;    // filename*=UTF-8''...

  const partHeaders =
    `Content-Disposition: form-data; name="file"; filename="${asciiFallback}"; filename*=${filenameStar}` + CRLF +
    `Content-Type: ${mimetype}` + CRLF + CRLF;

  const preamble = `--${boundary}` + CRLF + partHeaders;
  const closing  = CRLF + `--${boundary}--` + CRLF;

  const body = Buffer.concat([
    Buffer.from(preamble, "utf8"),
    buffer,
    Buffer.from(closing, "utf8"),
  ]);

  const url = new URL("/k/v1/file.json", baseUrl).toString();
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "X-Cybozu-API-Token": token,
      "Content-Type": `multipart/form-data; charset=utf-8; boundary=${boundary}`,
    },
    body,
  });

  const out = await r.json().catch(() => ({}));
  if (!r.ok || !out.fileKey) {
    throw new Error("kintone file upload failed: " + JSON.stringify(out));
  }
  return out.fileKey;
}

async function fetchRecordFiles({ baseUrl, appId, token, recordId, fileField }) {
  const url = new URL("/k/v1/record.json", baseUrl);
  url.search = new URLSearchParams({ app: String(appId), id: String(recordId) }).toString();
  const r = await fetch(url.toString(), { headers: { "X-Cybozu-API-Token": token, "Accept": "application/json" } });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.warn("[kintone fetch record files] not ok:", r.status, out);
    return [];
  }
  return out.record?.[fileField]?.value || [];
}

async function updateKintoneRecord({ baseUrl, appId, token, recordId, fileField, files }) {
  const url = new URL("/k/v1/record.json", baseUrl).toString();
  const body = { app: String(appId), id: String(recordId), record: { [fileField]: { value: files } } };
  const r = await fetch(url, {
    method: "PUT",
    headers: { "X-Cybozu-API-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = await r.text();
    console.error("[kintone update error]", r.status, txt);
    throw new Error(`kintone record update failed: ${txt}`);
  }
  return true;
}

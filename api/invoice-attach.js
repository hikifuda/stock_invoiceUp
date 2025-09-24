// /api/invoice-attach.js
import Busboy from "busboy";

export const config = { api: { bodyParser: false, externalResolver: true } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method Not Allowed" });

  const baseUrl   = process.env.KINTONE_BASE_URL;
  const appId     = process.env.KINTONE_INBOUND_APP_ID;
  const token     = process.env.KINTONE_INBOUND_API_TOKEN;
  const fileField = process.env.KINTONE_FILE_FIELD || "invoiceFile";
  const flagField = process.env.KINTONE_UPLOADED_FIELD || "uploadFlag"; // ← フィールドコード
  const flagValue = process.env.KINTONE_UPLOADED_VALUE || "済";        // ← 記録する値
  const appendMode = (process.env.KINTONE_FILE_APPEND || "true").toLowerCase() === "true";

  try {
    const { fields, file } = await parseMultipart(req);
    const recordId = fields?.recordId?.trim();
    if (!recordId) return res.status(400).json({ message: "recordId is required" });
    if (!file)     return res.status(400).json({ message: "file is required" });

    // 1) kintone ファイルアップロード
    const fileKey = await uploadToKintoneFileAPI_UTF8({
      baseUrl, token,
      filename: file.filename || "upload",
      mimetype: file.mimetype,
      buffer: file.buffer
    });

    // 2) 追記 or 置換
    let filesForUpdate = [{ fileKey }];
    if (appendMode) {
      const existing = await fetchRecordFiles({ baseUrl, appId, token, recordId, fileField });
      const keep = (existing || []).map(f => f.fileKey ? { fileKey: f.fileKey } : null).filter(Boolean);
      filesForUpdate = [...keep, { fileKey }];
    }

    // 3) レコード更新（添付 + uploadFlag）
    await updateKintoneRecord({
      baseUrl, appId, token, recordId,
      updates: {
        [fileField]: { value: filesForUpdate },
        [flagField]: { value: flagValue }   // ← 済をセット
      }
    });

    return res.status(200).json({ ok: true, recordId, fileField, flagField, flagValue });
  } catch (err) {
    console.error("[invoice-attach] error:", err);
    return res.status(500).json({ message: err?.message || "attach failed" });
  }
}

/* ========== helpers (ファイル名UTF-8対応などは前回と同じ) ========== */

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers });
    const fields = {};
    let file = null;

    bb.on("file", (fieldname, stream, a, b, c) => {
      const info = (a && typeof a === "object" && ("filename" in a || "mimeType" in a)) ? a : null;
      const rawName = info ? info.filename : (typeof a === "string" ? a : "upload");
      const filename = sanitizeFilename(rawName);
      const mimeType = info ? (info.mimeType || info.mime) : (typeof c === "string" ? c : "application/octet-stream");

      const chunks = [];
      stream.on("data", d => chunks.push(d));
      stream.on("end", () => { file = { filename, mimetype: mimeType, buffer: Buffer.concat(chunks) }; });
      stream.on("error", reject);
    });

    bb.on("field", (name, val) => { fields[name] = val; });
    bb.on("error", reject);
    bb.on("finish", () => resolve({ fields, file }));
    req.pipe(bb);
  });
}

function sanitizeFilename(name) {
  return String(name || "upload").replace(/[\\\/:*?"<>|]+/g, "_").slice(0, 255) || "upload";
}

function encodeRFC5987ValueChars(str) {
  return encodeURIComponent(str)
    .replace(/['()]/g, escape)
    .replace(/\*/g, '%2A')
    .replace(/%(7C|60|5E)/g, (m, p1) => '%' + p1.toLowerCase());
}

async function uploadToKintoneFileAPI_UTF8({ baseUrl, token, filename, mimetype, buffer }) {
  const boundary = "----kitoneFormData" + Math.random().toString(16).slice(2);
  const CRLF = "\r\n";
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, "_");
  const filenameStar = `UTF-8''${encodeRFC5987ValueChars(filename)}`;

  const partHeaders =
    `Content-Disposition: form-data; name="file"; filename="${asciiFallback}"; filename*=${filenameStar}` + CRLF +
    `Content-Type: ${mimetype}` + CRLF + CRLF;

  const preamble = `--${boundary}` + CRLF + partHeaders;
  const closing  = CRLF + `--${boundary}--` + CRLF;

  const body = Buffer.concat([ Buffer.from(preamble, "utf8"), buffer, Buffer.from(closing, "utf8") ]);

  const url = new URL("/k/v1/file.json", baseUrl).toString();
  const r = await fetch(url, { method: "POST",
    headers: { "X-Cybozu-API-Token": token, "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body });
  const out = await r.json().catch(() => ({}));
  if (!r.ok || !out.fileKey) throw new Error("kintone file upload failed: " + JSON.stringify(out));
  return out.fileKey;
}

async function fetchRecordFiles({ baseUrl, appId, token, recordId, fileField }) {
  const url = new URL("/k/v1/record.json", baseUrl);
  url.search = new URLSearchParams({ app: String(appId), id: String(recordId) }).toString();
  const r = await fetch(url, { headers: { "X-Cybozu-API-Token": token } });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) return [];
  return out.record?.[fileField]?.value || [];
}

async function updateKintoneRecord({ baseUrl, appId, token, recordId, updates }) {
  const url = new URL("/k/v1/record.json", baseUrl).toString();
  const body = { app: String(appId), id: String(recordId), record: updates };
  const r = await fetch(url, {
    method: "PUT",
    headers: { "X-Cybozu-API-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`kintone record update failed: ${txt}`);
  }
  return true;
}

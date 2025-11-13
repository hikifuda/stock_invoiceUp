// /api/invoice-attach.js
import Busboy from "busboy";

export const config = { api: { bodyParser: false, externalResolver: true } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method Not Allowed" });

  const baseUrl   = process.env.KINTONE_BASE_URL;
  const appId     = process.env.KINTONE_INBOUND_APP_ID;
  const token     = process.env.KINTONE_INBOUND_API_TOKEN;
  const fileField = process.env.KINTONE_FILE_FIELD || "invoiceFile";
  const flagField = process.env.KINTONE_UPLOADED_FIELD || "uploadFlag"; // 文字列(1行)
  const flagValue = process.env.KINTONE_UPLOADED_VALUE || "済";
  const appendMode = false;   // ← 常に上書き

  try {
    const { fields, file } = await parseMultipart(req);
    const recordId = fields?.recordId?.trim();
    if (!recordId) return res.status(400).json({ message: "recordId is required" });
    if (!file)     return res.status(400).json({ message: "file is required" });

    // ★ スマホ対策：フロントから送った origName を最優先で使用（Unicode 正常）
    const origName = (fields?.origName || file.filename || "upload").toString().normalize("NFC");

    // 1) kintone ファイルアップロード（UTF-8 filename* 対応）
    const fileKey = await uploadToKintoneFileAPI_UTF8({
      baseUrl, token,
      filename: origName,                       // ← ここを origName に
      mimetype: file.mimetype || "application/octet-stream",
      buffer: file.buffer
    });

    // 2) 置換
    const filesForUpdate = [{ fileKey }];

    // 3) レコード更新（添付 + uploadFlag）
    await updateKintoneRecord({
      baseUrl, appId, token, recordId,
      updates: {
        [fileField]: { value: filesForUpdate },
        [flagField]: { value: flagValue }
      }
    });

    return res.status(200).json({ ok: true, recordId, fileField, flagField, flagValue });
  } catch (err) {
    console.error("[invoice-attach] error:", err);
    return res.status(500).json({ message: err?.message || "attach failed" });
  }
}

/* ========== helpers ========== */

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers });
    const fields = {};
    let file = null;

    // Busboy v1 新旧両API対応
    bb.on("file", (fieldname, stream, a, b, c) => {
      const info = (a && typeof a === "object" && ("filename" in a || "mimeType" in a)) ? a : null;
      const rawName = info ? info.filename : (typeof a === "string" ? a : "upload");
      const filename = sanitizeFilename(rawName);
      const mimeType = info ? (info.mimeType || info.mime || "application/octet-stream")
                            : (typeof c === "string" ? c : "application/octet-stream");

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

// RFC5987 エンコード
function encodeRFC5987ValueChars(str) {
  return encodeURIComponent(str)
    .replace(/['()]/g, escape)
    .replace(/\*/g, '%2A')
    .replace(/%(7C|60|5E)/g, (m, p1) => '%' + p1.toLowerCase());
}

// kintone へ UTF-8 ファイル名で multipart 送信（filename* + ASCII fallback）
async function uploadToKintoneFileAPI_UTF8({ baseUrl, token, filename, mimetype, buffer }) {
  const boundary = "----kintoneFormData" + Math.random().toString(16).slice(2);
  const CRLF = "\r\n";
  const safeName = (filename || "upload").toString();
  const asciiFallback = safeName.replace(/[^\x20-\x7E]/g, "_");            // 非ASCIIは _
  const filenameStar = `UTF-8''${encodeRFC5987ValueChars(safeName)}`;      // RFC5987

  // 両方送る：対応環境は filename*、非対応でも文字化けでなく ASCII 表示に落ちる
  const partHeaders =
    `Content-Disposition: form-data; name="file"; filename="${asciiFallback}"; filename*=${filenameStar}` + CRLF +
    `Content-Type: ${mimetype || "application/octet-stream"}` + CRLF +
    `Content-Transfer-Encoding: binary` + CRLF + CRLF;

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
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });
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

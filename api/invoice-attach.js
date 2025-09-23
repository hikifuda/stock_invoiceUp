// /api/invoice-attach.js
// 1) /k/v1/file.json にファイルをアップ → fileKey を取得
// 2) /k/v1/record.json で既存レコードの添付フィールドへ反映（追記 or 置換）
import Busboy from "busboy";

export const config = { api: { bodyParser: false, externalResolver: true } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method Not Allowed" });

  // ---- 環境変数 ----
  const baseUrl = process.env.KINTONE_BASE_URL;                 // https://xxx.cybozu.com
  const appId   = process.env.KINTONE_INBOUND_APP_ID;           // CL入荷アプリID
  const token   = process.env.KINTONE_INBOUND_API_TOKEN;        // CL入荷アプリの「書き込み可」APIトークン
  const fileField = process.env.KINTONE_FILE_FIELD || "invoiceFile"; // 添付ファイルのフィールドコード
  const appendMode = (process.env.KINTONE_FILE_APPEND || "true").toLowerCase() === "true"; // 追記/置換

  if (!baseUrl || !appId || !token) {
    return res.status(500).json({ message: "Kintone env vars not set" });
  }

  try {
    // ---- multipart 受信 ----
    const { fields, file } = await parseMultipart(req);
    const recordId = fields?.recordId;
    if (!recordId) return res.status(400).json({ message: "recordId is required" });
    if (!file)     return res.status(400).json({ message: "file is required" });

    // ---- (1) kintoneへファイル一時アップ → fileKey ----
    const fileKey = await uploadToKintoneFileAPI({
      baseUrl, token, filename: file.filename || "upload", mimetype: file.mimetype, buffer: file.buffer,
    });

    // ---- (2) 既存ファイルを保持するか（appendMode=true の場合）----
    let filesForUpdate = [{ fileKey }];

    if (appendMode) {
      const existing = await fetchRecordFiles({ baseUrl, appId, token, recordId, fileField });
      // 既存の fileKey を残して新しい fileKey を追加
      const keep = existing.map(f => ({ fileKey: f.fileKey })).filter(f => f.fileKey);
      filesForUpdate = [...keep, { fileKey }];
    }

    // ---- (3) レコード更新 ----
    const ok = await updateKintoneRecord({
      baseUrl, appId, token, recordId, fileField, files: filesForUpdate,
    });

    if (!ok) throw new Error("kintone record update failed");

    return res.status(200).json({
      ok: true,
      recordId,
      fileField,
      mode: appendMode ? "append" : "replace",
    });
  } catch (err) {
    console.error("[invoice-attach] error:", err);
    return res.status(500).json({ message: err?.message || "attach failed" });
  }
}

/* ---------- helpers ---------- */

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers });
    const fields = {};
    let file = null;

    bb.on("file", (fieldname, stream, filename, encoding, mimetype) => {
      const chunks = [];
      stream.on("data", d => chunks.push(d));
      stream.on("end", () => { file = { fieldname, filename, mimetype, buffer: Buffer.concat(chunks) }; });
      stream.on("error", reject);
    });

    bb.on("field", (name, val) => { fields[name] = val; });
    bb.on("error", reject);
    bb.on("finish", () => resolve({ fields, file }));

    req.pipe(bb);
  });
}

async function uploadToKintoneFileAPI({ baseUrl, token, filename, mimetype, buffer }) {
  const url = new URL("/k/v1/file.json", baseUrl).toString();

  const fd = new FormData();
  const blob = new Blob([buffer], { type: mimetype || "application/octet-stream" });
  fd.set("file", blob, filename);

  const r = await fetch(url, {
    method: "POST",
    headers: { "X-Cybozu-API-Token": token },
    body: fd,
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

  const r = await fetch(url.toString(), {
    headers: { "X-Cybozu-API-Token": token, "Accept": "application/json" },
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) return [];
  const files = out.record?.[fileField]?.value || [];
  // 既存ファイルの fileKey/name 等が入っている
  return files;
}

async function updateKintoneRecord({ baseUrl, appId, token, recordId, fileField, files }) {
  const url = new URL("/k/v1/record.json", baseUrl).toString();
  const body = {
    app: String(appId),
    id: String(recordId),
    record: {
      [fileField]: { value: files }, // [{ fileKey }, ...]
    },
  };
  const r = await fetch(url, {
    method: "PUT",
    headers: {
      "X-Cybozu-API-Token": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = await r.text();
    console.error("[kintone update error]", r.status, txt);
  }
  return r.ok;
}

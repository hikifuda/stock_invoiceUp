// /api/invoice-attach.js
import Busboy from "busboy";

// Next.js API Routes 互換の設定（multipart扱いのため bodyParser を無効化）
export const config = { api: { bodyParser: false, externalResolver: true } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method Not Allowed" });

  const yoomUrl = process.env.YOOM_INVOICE_ATTACH_URL;
  if (!yoomUrl) return res.status(500).json({ message: "YOOM_INVOICE_ATTACH_URL is not set" });

  try {
    const { fields, file } = await parseMultipart(req);

    const recordId = fields?.recordId;
    if (!recordId) return res.status(400).json({ message: "recordId is required" });
    if (!file)     return res.status(400).json({ message: "file is required" });

    const fd = new FormData();
    fd.set("recordId", recordId);
    const blob = new Blob([file.buffer], { type: file.mimetype || "application/octet-stream" });
    fd.set("file", blob, file.filename || "upload");

    const r = await fetch(yoomUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.YOOM_TOKEN || ""}` },
      body: fd,
    });

    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }

    if (!r.ok) {
      return res.status(r.status).json({ message: "Yoom returned non-200", status: r.status, body: json });
    }
    return res.status(200).json({ ok: true, recordId, yoom: json });
  } catch (err) {
    console.error("[invoice-attach] full error:", err);
    return res.status(500).json({ message: err?.message || "attach failed" });
  }
}

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

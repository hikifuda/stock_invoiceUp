// /api/invoice-attach.js
// 安定版: Busboy で multipart をパースして、そのまま Yoom へmultipart転送
import Busboy from "busboy";

// Next.js API Routes で生のmultipartを扱うため
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method Not Allowed" });
  const yoomUrl = process.env.YOOM_INVOICE_ATTACH_URL;
  if (!yoomUrl) return res.status(500).json({ message: "YOOM_INVOICE_ATTACH_URL is not set" });

  try {
    const { fields, file } = await parseMultipart(req);

    const recordId = fields.recordId;
    if (!recordId) return res.status(400).json({ message: "recordId is required" });
    if (!file)     return res.status(400).json({ message: "file is required" });

    // Node18+ はグローバルに FormData/Blob がある（undici）
    const fd = new FormData();
    fd.set("recordId", recordId);
    // contentType を付与すると受け側が喜ぶ
    const blob = new Blob([file.buffer], { type: file.mimetype || "application/octet-stream" });
    fd.set("file", blob, file.filename || "upload");

    const r = await fetch(yoomUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.YOOM_TOKEN || ""}` },
      body: fd,
    });

    // Yoom 側が非JSONを返す場合もあるので両対応
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }

    if (!r.ok) {
      return res.status(r.status).json({
        message: "Yoom returned non-200",
        status: r.status,
        body: json,
      });
    }
    return res.status(200).json({ ok: true, recordId, yoom: json });
  } catch (err) {
    console.error("[invoice-attach] error:", err);
    return res.status(500).json({ message: err?.message || "attach failed" });
  }
}

/**
 * Busboyで multipart/form-data をパースして
 * - fields: { [name]: value }
 * - file: { buffer, filename, mimetype, fieldname }
 * を返す（単一ファイル想定）
 */
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    try {
      const bb = Busboy({ headers: req.headers });
      const fields = {};
      let file = null;

      bb.on("file", (fieldname, stream, filename, encoding, mimetype) => {
        const chunks = [];
        stream.on("data", (d) => chunks.push(d));
        stream.on("limit", () => console.warn("[busboy] file size limit reached"));
        stream.on("end", () => {
          file = {
            fieldname,
            filename,
            mimetype,
            buffer: Buffer.concat(chunks),
          };
        });
        stream.on("error", reject);
      });

      bb.on("field", (name, val) => { fields[name] = val; });
      bb.on("error", reject);
      bb.on("finish", () => resolve({ fields, file }));

      req.pipe(bb);
    } catch (e) {
      reject(e);
    }
  });
}

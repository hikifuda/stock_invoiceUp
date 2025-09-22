export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method Not Allowed" });
  try {
    const { fields, filePart } = await readMultipart(req);
    const recordId = fields["recordId"];
    if (!recordId) return res.status(400).json({ message: "recordId is required" });
    if (!filePart) return res.status(400).json({ message: "file is required" });

    const url = process.env.YOOM_INVOICE_ATTACH_URL; // Yoom flow endpoint
    if (!url) throw new Error("YOOM_INVOICE_ATTACH_URL is not set");

    const fd = new FormData();
    fd.set("recordId", recordId);
    fd.set("file", new Blob([filePart.buffer]), filePart.filename);

    const r = await fetch(url, {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.YOOM_TOKEN || ""}` },
      body: fd
    });
    const out = await r.json().catch(()=>({}));
    if (!r.ok) return res.status(r.status).json(out);
    return res.status(200).json(out);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message || "attach failed" });
  }
}

async function readMultipart(req){
  const contentType = req.headers["content-type"] || "";
  const m = contentType.match(/boundary=(.*)$/i);
  if (!m) throw new Error("Invalid multipart/form-data");
  const boundary = "--" + m[1];

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const buf = Buffer.concat(chunks);
  const parts = buf.toString("binary").split(boundary).slice(1,-1);

  const fields = {};
  let filePart = null;

  for (const part of parts) {
    const [rawHeaders, rawBody] = part.split("\r\n\r\n");
    if (!rawBody) continue;
    const headers = rawHeaders.split("\r\n").filter(Boolean).map(l=>l.trim());
    const dispLine = headers.find(h=>/^Content-Disposition/i.test(h)) || "";
    const nameMatch = dispLine.match(/name="([^"]+)"/);
    const filenameMatch = dispLine.match(/filename="([^"]+)"/);
    const name = nameMatch ? nameMatch[1] : "";
    const bodyBinary = rawBody.slice(0, -2);
    if (filenameMatch) {
      const filename = filenameMatch[1];
      const start = buf.indexOf(rawBody, "binary");
      const end = start + Buffer.byteLength(bodyBinary, "binary");
      const slice = buf.subarray(start, end);
      filePart = { filename, buffer: slice };
    } else {
      fields[name] = Buffer.from(bodyBinary, "binary").toString("utf-8");
    }
  }
  return { fields, filePart };
}
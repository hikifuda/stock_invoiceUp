export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ message: "Method Not Allowed" });
  const uid = (req.query.uid || "").toString();
  if (!uid) return res.status(400).json({ message: "uid is required" });

  try {
    const url = process.env.YOOM_SEARCH_URL; // e.g., https://hooks.yoom.app/.../search
    if (!url) throw new Error("YOOM_SEARCH_URL is not set");

    const r = await fetch(url + "?uid=" + encodeURIComponent(uid), {
      headers: {
        "Authorization": `Bearer ${process.env.YOOM_TOKEN || ""}`,
        "Accept": "application/json"
      }
    });
    const data = await r.json().catch(()=>({ records: [] }));
    return res.status(200).json({ records: data.records || [] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message || "search failed" });
  }
}
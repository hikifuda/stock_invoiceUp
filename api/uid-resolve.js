export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end("Method Not Allowed");

  const { uid } = req.query;
  if (!uid) return res.status(400).json({ error: "uid required" });

  const {
    KINTONE_BASE_URL,
    KINTONE_APP_ID_UID_MASTER,
    KINTONE_API_TOKEN_UID_MASTER
  } = process.env;

  try {
    const query = `uid = "${uid}"`;
    const url = `${KINTONE_BASE_URL}/k/v1/records.json?app=${KINTONE_APP_ID_UID_MASTER}&query=${encodeURIComponent(query)}`;
    const resp = await fetch(url, {
      headers: { "X-Cybozu-API-Token": KINTONE_API_TOKEN_UID_MASTER }
    });

    if (!resp.ok) throw new Error("kintone error");
    const data = await resp.json();
    if (!data.records?.length) return res.status(404).json({ error: "not found" });

    const companyId = data.records[0].companyId.value;
    res.status(200).json({ companyId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

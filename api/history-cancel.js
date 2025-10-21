export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const { recordId, uid } = req.body || {};
  if (!recordId || !uid) return res.status(400).json({ error: "recordId & uid required" });

  const {
    KINTONE_BASE_URL,
    KINTONE_APP_ID_UID_MASTER,
    KINTONE_API_TOKEN_UID_MASTER,
    KINTONE_APP_ID_NYUKA,
    KINTONE_API_TOKEN_NYUKA,
    LINE_CHANNEL_ACCESS_TOKEN,
    LINE_TARGET_ID
  } = process.env;

  try {
    // 1️⃣ UID → companyId 解決
    const query = `uid = "${uid}"`;
    const r1 = await fetch(`${KINTONE_BASE_URL}/k/v1/records.json?app=${KINTONE_APP_ID_UID_MASTER}&query=${encodeURIComponent(query)}`, {
      headers: { "X-Cybozu-API-Token": KINTONE_API_TOKEN_UID_MASTER }
    });
    const d1 = await r1.json();
    if (!d1.records?.length) throw new Error("UID not found");
    const companyId = d1.records[0].companyId.value;

    // 2️⃣ 取消処理
    const updateBody = {
      app: KINTONE_APP_ID_NYUKA,
      id: recordId,
      record: { 取消: { value: ["0"] } }
    };
    const r2 = await fetch(`${KINTONE_BASE_URL}/k/v1/record.json`, {
      method: "PUT",
      headers: {
        "X-Cybozu-API-Token": KINTONE_API_TOKEN_NYUKA,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(updateBody)
    });
    if (!r2.ok) throw new Error("update failed");

    // 3️⃣ LINE通知
    if (LINE_CHANNEL_ACCESS_TOKEN && LINE_TARGET_ID) {
      const msg = {
        to: LINE_TARGET_ID,
        messages: [{
          type: "text",
          text: `【取消依頼】\ncompanyId: ${companyId}\nrecordId: ${recordId}\n実行UID: ${uid}`
        }]
      };
      await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
        },
        body: JSON.stringify(msg)
      });
    }

    res.status(200).json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end("Method Not Allowed");

  const { companyId } = req.query;
  if (!companyId) return res.status(400).json({ error: "companyId required" });

  const {
    KINTONE_BASE_URL,
    KINTONE_APP_ID_NYUKA,
    KINTONE_API_TOKEN_NYUKA
  } = process.env;

  const FIELD = {
    COMPANY: "companyId",
    CREATED: "作成日時",
    PLANNED: "入荷予定日",
    SLIP: "伝票番号",
    STATUS: "ステータス",
    ITEMCNT: "品目数",
    QTYSUM: "数量合計",
    CANCEL: "取消"
  };

  const query = `${FIELD.COMPANY} = "${companyId}" order by ${FIELD.CREATED} desc limit 100`;

  try {
    const url = `${KINTONE_BASE_URL}/k/v1/records.json?app=${KINTONE_APP_ID_NYUKA}&query=${encodeURIComponent(query)}`;
    const resp = await fetch(url, {
      headers: { "X-Cybozu-API-Token": KINTONE_API_TOKEN_NYUKA }
    });

    if (!resp.ok) throw new Error("kintone error");
    const data = await resp.json();

    const items = (data.records || []).map(rec => ({
      recordId: rec.$id.value,
      createdAt: rec[FIELD.CREATED]?.value || "",
      plannedDate: rec[FIELD.PLANNED]?.value || "",
      slipNo: rec[FIELD.SLIP]?.value || "",
      status: rec[FIELD.STATUS]?.value || "",
      qtySum: Number(rec[FIELD.QTYSUM]?.value ?? 0),
      isCanceled: !!(rec[FIELD.CANCEL]?.value?.length)
    }));

    res.status(200).json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

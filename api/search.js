// /api/search.js
// companyId一致、uploadFlag が「済」or 空、unitPriceFlag（チェックボックス）が「済」を含まないレコードを取得
// uploadFlag と invoiceFile を返却 → フロントでステータス表示に使用

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ message: "Method Not Allowed" });

  const uid = (req.query.uid || "").toString();
  if (!uid) return res.status(400).json({ message: "uid is required" });

  const baseUrl = process.env.KINTONE_BASE_URL;

  // UIDマスタ
  const uidAppId   = process.env.KINTONE_UID_APP_ID;
  const uidToken   = process.env.KINTONE_UID_API_TOKEN;
  const uidField   = process.env.KINTONE_UID_FIELD || "uId";
  const companyIdField = process.env.KINTONE_COMPANYID_FIELD || "companyId";

  // CL入荷アプリ
  const inboundAppId = process.env.KINTONE_INBOUND_APP_ID;
  const inboundToken = process.env.KINTONE_INBOUND_API_TOKEN;
  const inboundCompanyIdField = process.env.KINTONE_INBOUND_COMPANYID_FIELD || "companyId";

  const uploadedField = process.env.KINTONE_UPLOADED_FIELD || "uploadFlag";
  const unitPriceFlagField = "unitPriceFlag"; // ← チェックボックス確定
  const doneValue = "済";                     // チェックボックス値

  if (!baseUrl || !uidAppId || !uidToken || !inboundAppId || !inboundToken) {
    return res.status(500).json({ message: "env vars not set" });
  }

  try {
    // === Step1: UIDマスタから companyId を取得 ===
    const uidQuery = `${uidField} = "${escapeDoubleQuotes(uid)}" limit 1`;
    const uidUrl = new URL("/k/v1/records.json", baseUrl);
    uidUrl.search = new URLSearchParams({ app: String(uidAppId), query: uidQuery }).toString();

    const uidRes = await fetch(uidUrl.toString(), {
      headers: { "X-Cybozu-API-Token": uidToken, Accept: "application/json" },
    });
    const uidData = await uidRes.json();
    if (!uidRes.ok) return res.status(uidRes.status).json(uidData);

    if (!uidData.records?.length)
      return res.status(404).json({ message: "UID not found in master" });

    const companyId = uidData.records[0][companyIdField]?.value;
    if (!companyId)
      return res.status(404).json({ message: "companyId not found for this uid" });

    // === Step2: CL入荷アプリの検索条件を組み立て ===
    let where = `${inboundCompanyIdField} = "${escapeDoubleQuotes(companyId)}"`;

    // uploadFlag = "済" または "" のものを表示
    where += ` and ( ${uploadedField} = "${doneValue}" or ${uploadedField} = "" )`;

    // unitPriceFlag（チェックボックス）に「済」が含まれるレコードを除外
    where += ` and not ${unitPriceFlagField} in ("${doneValue}")`;

    const inboundQuery = `${where} order by レコード番号 desc limit 50`;

    const inboundUrl = new URL("/k/v1/records.json", baseUrl);
    inboundUrl.search = new URLSearchParams({
      app: String(inboundAppId),
      query: inboundQuery,
    }).toString();

    const inRes = await fetch(inboundUrl.toString(), {
      headers: { "X-Cybozu-API-Token": inboundToken, Accept: "application/json" },
    });
    const inData = await inRes.json();
    if (!inRes.ok) return res.status(inRes.status).json(inData);

    // === Step3: 整形（uploadFlag / invoiceFile も返す） ===
    const records = (inData.records || []).map(rec => {
      const recordId = rec.$id?.value;
      const baseDate = rec.baseDate?.value;

      const uploadFlag = rec[uploadedField]?.value || "";
      const invoiceFile = Array.isArray(rec.invoiceFile?.value)
        ? rec.invoiceFile.value
        : [];

      const tableRows = rec.itemTable?.value || [];
      const itemTable = tableRows.map(row => {
        const c = row.value || {};
        return {
          itemName: c.itemName?.value || "",
          qty: Number(c.qty?.value) || 0,
          designLot: Array.isArray(c.designLot?.value)
            ? c.designLot.value
            : c.designLot?.value
            ? [c.designLot.value]
            : [],
        };
      });

      return { recordId, baseDate, itemTable, uploadFlag, invoiceFile };
    });

    return res.status(200).json({ records, companyId });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message || "search failed" });
  }
}

function escapeDoubleQuotes(s) {
  return String(s).replace(/"/g, '\\"');
}

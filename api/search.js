// /api/search.js
// UID → companyId を引き、CL入荷から条件一致レコードを返す（最小差分対応版）

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

  // CL入荷
  const inboundAppId = process.env.KINTONE_INBOUND_APP_ID;
  const inboundToken = process.env.KINTONE_INBOUND_API_TOKEN;
  const inboundCompanyIdField = process.env.KINTONE_INBOUND_COMPANYID_FIELD || "companyId";

  // フラグ系
  const uploadedField = process.env.KINTONE_UPLOADED_FIELD || "uploadFlag";   // uploadFlag
  const uploadedValue = process.env.KINTONE_UPLOADED_VALUE || "済";          // "済"
  const unitPriceFlagField = "unitPriceFlag";                                // チェックボックス

  if (!baseUrl || !uidAppId || !uidToken || !inboundAppId || !inboundToken) {
    return res.status(500).json({ message: "env vars not set" });
  }

  try {
    // === Step1: UIDマスタ検索 ===
    const uidQuery = `${uidField} = "${escapeDoubleQuotes(uid)}" limit 1`;
    const uidUrl = new URL("/k/v1/records.json", baseUrl);
    uidUrl.search = new URLSearchParams({ app: String(uidAppId), query: uidQuery }).toString();

    const uidRes = await fetch(uidUrl.toString(), {
      headers: { "X-Cybozu-API-Token": uidToken, Accept: "application/json" },
    });
    const uidData = await uidRes.json();
    if (!uidRes.ok) return res.status(uidRes.status).json(uidData);

    if (!uidData.records?.length) {
      return res.status(404).json({ message: "UID not found in master" });
    }

    const companyId = uidData.records[0][companyIdField]?.value;
    if (!companyId) {
      return res.status(404).json({ message: "companyId not found for this uid" });
    }

    // === Step2: CL入荷アプリ検索（最小差分で条件のみ修正） ===
    // ✔ companyId が一致
    // ✔ uploadFlag = "済" OR is empty
    // ✔ unitPriceFlag（チェックボックス）が "済" を含むものを除外
    let where = `${inboundCompanyIdField} = "${escapeDoubleQuotes(companyId)}"`;

    // uploadFlag が「済」or 空欄を表示
    where += ` and ( ${uploadedField} = "${escapeDoubleQuotes(uploadedValue)}" or ${uploadedField} = "" )`;

    // unitPriceFlag が "済" を含むものを除外（チェックボックス）
    where += ` and  ${unitPriceFlagField} not in ("${escapeDoubleQuotes(uploadedValue)}")`;

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

    // === Step3: 整形（あなたのJSを完全維持） ===
    const records = (inData.records || []).map(rec => {
      const recordId = rec.$id?.value;
      const baseDate = rec.baseDate?.value;

      const tableRows = rec.itemTable?.value || [];
      const itemTable = tableRows.map(row => {
        const c = row.value || {};
        return {
          itemName: c.itemName?.value || "",
          qty: Number(c.qty?.value) || 0,
          designLot: Array.isArray(c.designLot?.value)
            ? c.designLot.value
            : (c.designLot?.value ? [c.designLot?.value] : []),
        };
      });

      return { recordId, baseDate, itemTable };
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

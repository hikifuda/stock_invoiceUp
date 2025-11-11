// /api/invoice-notify.js
import { sendSlack } from "../lib/slackNotify.js";

export default async function handler(req, res) {
  try {
    const { recordId, fileName, userName } = req.body;
    if (!recordId || !fileName) {
      return res.status(400).json({ error: "recordId and fileName are required" });
    }

    const baseUrl = process.env.KINTONE_BASE_URL;
    const appId = process.env.KINTONE_INBOUND_APP_ID;
    const apiToken = process.env.KINTONE_INBOUND_API_TOKEN;

    if (!baseUrl || !appId || !apiToken) throw new Error("環境変数が未設定です。");

    // === レコード情報を取得 ===
    const resp = await fetch(`${baseUrl}/k/v1/record.json?app=${appId}&id=${recordId}`, {
      headers: { "X-Cybozu-API-Token": apiToken },
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(text);
    const record = JSON.parse(text).record;

    const companyName = record.companyName?.value || "不明";
    const planDate = record.baseDate?.value || "-";
    const recordUrl = `${baseUrl}/k/${appId}/show#record=${recordId}`;

    // === Slack通知 ===
    const textMsg = "📎【請求書アップロード】ファイルが送信されました";
    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `📎 *請求書アップロード*\n` +
            `*送信者*: ${userName || "不明ユーザー"}\n` +
            `*会社名*: ${companyName}\n` +
            `*入荷予定日*: ${planDate}\n` +
            `*ファイル名*: ${fileName}`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "🔗 レコードを開く" },
            url: recordUrl,
          },
        ],
      },
    ];

    await sendSlack(textMsg, blocks);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("❌ invoice-notify error:", err);
    res.status(500).json({ error: err.message });
  }
}

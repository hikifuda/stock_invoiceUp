// /lib/slackNotify.js
export async function sendSlack(text, blocks = null) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) throw new Error("SLACK_WEBHOOK_URL 未設定");

  const body = blocks ? { text, blocks } : { text };

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

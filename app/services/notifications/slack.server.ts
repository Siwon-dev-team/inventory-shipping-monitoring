export async function sendSlackMessage(webhookUrl: string, text: string) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook failed with status ${response.status}`);
  }
}

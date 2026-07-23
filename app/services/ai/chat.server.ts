import { buildReorderList } from "../inventory/reorder-list.server";
import { generateInventoryInsights } from "./insights.server";

type ChatContext = {
  summary: string;
  topSkus: string[];
  insights: string[];
};

async function buildChatContext(merchantId: number): Promise<ChatContext> {
  const [{ rows, summary }, insights] = await Promise.all([
    buildReorderList({ merchantId, needsReorderOnly: true }),
    generateInventoryInsights(merchantId),
  ]);

  return {
    summary: `Stock health ${summary.stockHealthScore}%, ${summary.needsReorder} SKUs need reorder, ${summary.deadStockCount} dead stock SKUs.`,
    topSkus: rows.slice(0, 10).map(
      (row) =>
        `${row.productTitle} (${row.sku || "no SKU"}): qty ${row.inventoryQuantity}, reorder ${row.reorderSuggestionQty}, urgency ${row.urgencyScore}`,
    ),
    insights: insights.slice(0, 8).map((insight) => `${insight.title} — ${insight.message}`),
  };
}

function answerWithRules(question: string, context: ChatContext): string {
  const normalized = question.toLowerCase();

  if (normalized.includes("dead stock") || normalized.includes("dead")) {
    const deadInsight = context.insights.find((item) =>
      item.toLowerCase().includes("dead stock"),
    );
    return (
      deadInsight ??
      "No dead stock patterns detected right now. Check the Reorder list with the dead stock filter."
    );
  }

  if (
    normalized.includes("reorder") ||
    normalized.includes("order") ||
    normalized.includes("restock")
  ) {
    if (context.topSkus.length === 0) {
      return "No urgent reorder SKUs right now based on current velocity and thresholds.";
    }
    return `Top reorder priorities:\n${context.topSkus.slice(0, 5).join("\n")}`;
  }

  if (normalized.includes("health") || normalized.includes("summary")) {
    return `${context.summary}\n\nKey insights:\n${context.insights.slice(0, 3).join("\n")}`;
  }

  if (normalized.includes("stockout") || normalized.includes("run out")) {
    const stockoutInsight = context.insights.find((item) =>
      item.toLowerCase().includes("stockout"),
    );
    return stockoutInsight ?? "No immediate stockout risks detected in the next week.";
  }

  return `Here is what I see right now:\n${context.summary}\n\nAsk about reorder priorities, dead stock, stockout risk, or inventory health.`;
}

async function answerWithLlm(question: string, context: ChatContext): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are an inventory assistant for a Shopify SMB merchant. Answer briefly using only the provided inventory context. If data is missing, say so.",
        },
        {
          role: "user",
          content: [
            "Inventory context:",
            context.summary,
            "",
            "Top SKUs:",
            context.topSkus.join("\n"),
            "",
            "Insights:",
            context.insights.join("\n"),
            "",
            `Question: ${question}`,
          ].join("\n"),
        },
      ],
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return payload.choices?.[0]?.message?.content?.trim() ?? null;
}

export async function answerInventoryQuestion(merchantId: number, question: string) {
  const trimmed = question.trim();
  if (!trimmed) {
    return {
      answer: "Ask a question about reorder priorities, stockout risk, dead stock, or inventory health.",
      mode: "rules" as const,
    };
  }

  const context = await buildChatContext(merchantId);
  const llmAnswer = await answerWithLlm(trimmed, context);

  if (llmAnswer) {
    return { answer: llmAnswer, mode: "ai" as const };
  }

  return { answer: answerWithRules(trimmed, context), mode: "rules" as const };
}

export function getAiModeLabel() {
  return process.env.OPENAI_API_KEY ? "AI (OpenAI)" : "Smart rules";
}

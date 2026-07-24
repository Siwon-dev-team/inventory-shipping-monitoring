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
        `${row.productTitle}${row.sku ? ` (SKU: ${row.sku})` : ""}\n   • Current stock: ${row.inventoryQuantity}\n   • Suggested reorder: ${row.reorderSuggestionQty}\n   • Urgency score: ${row.urgencyScore}`,
    ),
    insights: insights.slice(0, 8).map((insight) => `${insight.title} — ${insight.message}`),
  };
}

function answerWithRules(question: string, context: ChatContext): string {
  const normalized = question.toLowerCase();

  // Dead stock questions
  if (normalized.includes("dead stock") || normalized.includes("dead") || normalized.includes("not selling")) {
    const deadInsight = context.insights.find((item) =>
      item.toLowerCase().includes("dead stock"),
    );
    return (
      deadInsight ??
      "No dead stock patterns detected right now. Check the Reorder list with the dead stock filter."
    );
  }

  // Reorder / buy / purchase questions
  if (
    normalized.includes("reorder") ||
    normalized.includes("restock") ||
    normalized.includes("should i buy") ||
    normalized.includes("should i order") ||
    normalized.includes("need to buy") ||
    normalized.includes("need to order") ||
    normalized.includes("what to buy") ||
    normalized.includes("what to order")
  ) {
    if (context.topSkus.length === 0) {
      return "No urgent reorder SKUs right now based on current velocity and thresholds.";
    }
    const formatted = context.topSkus.slice(0, 5).map((sku, i) => `${i + 1}. ${sku}`);
    return `Top reorder priorities:\n\n${formatted.join("\n\n")}`;
  }

  // Low stock / running low questions
  if (
    normalized.includes("low stock") ||
    normalized.includes("low on stock") ||
    normalized.includes("running low") ||
    normalized.includes("running out") ||
    normalized.includes("almost out")
  ) {
    if (context.topSkus.length === 0) {
      return "All products have adequate stock levels right now.";
    }
    const formatted = context.topSkus.slice(0, 5).map((sku, i) => `${i + 1}. ${sku}`);
    return `Products running low:\n\n${formatted.join("\n\n")}`;
  }

  // Health / summary / overview questions
  if (
    normalized.includes("health") ||
    normalized.includes("summary") ||
    normalized.includes("overview") ||
    normalized.includes("how is") ||
    normalized.includes("how's") ||
    normalized.includes("status")
  ) {
    let response = `Inventory Summary:\n\n${context.summary}`;
    if (context.insights.length > 0) {
      response += `\n\nKey insights:\n${context.insights.slice(0, 3).map((i, idx) => `${idx + 1}. ${i}`).join("\n")}`;
    }
    return response;
  }

  // Stockout / out of stock questions
  if (
    normalized.includes("stockout") ||
    normalized.includes("out of stock") ||
    normalized.includes("run out") ||
    normalized.includes("going to run out")
  ) {
    const stockoutInsight = context.insights.find((item) =>
      item.toLowerCase().includes("stockout"),
    );
    return stockoutInsight ?? "No immediate stockout risks detected in the next week.";
  }

  // Fast selling / best sellers questions
  if (
    normalized.includes("selling fast") ||
    normalized.includes("fast seller") ||
    normalized.includes("best seller") ||
    normalized.includes("top seller") ||
    normalized.includes("popular") ||
    normalized.includes("high velocity")
  ) {
    const velocityInsight = context.insights.find((item) =>
      item.toLowerCase().includes("velocity") || item.toLowerCase().includes("spike"),
    );
    if (velocityInsight) {
      return `Fast-moving products:\n\n${velocityInsight}`;
    }
    return "Check the ABC Analytics page - Class A products are your fastest sellers based on sales velocity.";
  }

  // Slow selling questions
  if (
    normalized.includes("slow") ||
    normalized.includes("not moving") ||
    normalized.includes("stale")
  ) {
    const deadInsight = context.insights.find((item) =>
      item.toLowerCase().includes("dead stock") || item.toLowerCase().includes("slow"),
    );
    return (
      deadInsight ??
      "Check ABC Analytics - Class C products are your slowest movers. Dead stock items haven't sold in 30+ days."
    );
  }

  // Alert questions
  if (normalized.includes("alert") || normalized.includes("warning") || normalized.includes("problem")) {
    if (context.insights.length === 0) {
      return "No active inventory alerts or warnings right now.";
    }
    const formatted = context.insights.slice(0, 5).map((i, idx) => `${idx + 1}. ${i}`);
    return `Active inventory alerts:\n\n${formatted.join("\n")}`;
  }

  // Help / what can you do
  if (normalized.includes("help") || normalized.includes("what can you")) {
    return `I can answer questions about your inventory:\n
• "What should I reorder?" - Top reorder priorities
• "What's running low?" - Low stock items
• "How is my inventory?" - Overall health summary
• "What's selling fast?" - Fast-moving products
• "Any stockout risks?" - Items at risk of running out
• "Any dead stock?" - Items not selling
• "What are my alerts?" - Active inventory warnings`;
  }

  // Default fallback with summary
  return `Inventory Summary:\n\n${context.summary}\n\nTry asking:\n• "What should I reorder?"\n• "What's running low?"\n• "Any stockout risks?"\n• "What's selling fast?"\n• Type "help" for more options`;
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

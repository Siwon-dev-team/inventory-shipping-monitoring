import type { SubscriptionPlan } from "@prisma/client";
import { buildReorderList } from "../inventory/reorder-list.server";
import { generateInventoryInsights } from "./insights.server";
import {
  checkQueryLimit,
  incrementQueryCount,
  hasFeature,
} from "../billing/subscription.server";

type ChatContext = {
  summary: string;
  topSkus: string[];
  insights: string[];
};

export type AiAnswerResult = {
  answer: string;
  mode: "ai" | "rules" | "pro_ai";
  plan: SubscriptionPlan;
  remaining: number;
  limitReached?: boolean;
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

function buildPromptMessages(question: string, context: ChatContext) {
  return {
    system:
      "You are an inventory assistant for a Shopify SMB merchant. Answer briefly and helpfully using only the provided inventory context. If data is missing, say so. Format responses clearly with bullet points when listing items.",
    user: [
      "Inventory context:",
      context.summary,
      "",
      "Top SKUs needing attention:",
      context.topSkus.join("\n"),
      "",
      "Current insights:",
      context.insights.join("\n"),
      "",
      `Question: ${question}`,
    ].join("\n"),
  };
}

async function answerWithGroq(question: string, context: ChatContext): Promise<string | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const prompts = buildPromptMessages(question, context);
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL ?? "llama-3.1-8b-instant",
      temperature: 0.3,
      max_tokens: 500,
      messages: [
        { role: "system", content: prompts.system },
        { role: "user", content: prompts.user },
      ],
    }),
  });

  if (!response.ok) return null;

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return payload.choices?.[0]?.message?.content?.trim() ?? null;
}

async function answerWithGemini(question: string, context: ChatContext): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompts = buildPromptMessages(question, context);
  const model = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${prompts.system}\n\n${prompts.user}` }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 500 },
    }),
  });

  if (!response.ok) return null;

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  return payload.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
}

async function answerWithOpenAI(
  question: string,
  context: ChatContext,
  model?: string,
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const prompts = buildPromptMessages(question, context);
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      temperature: 0.3,
      max_tokens: 500,
      messages: [
        { role: "system", content: prompts.system },
        { role: "user", content: prompts.user },
      ],
    }),
  });

  if (!response.ok) return null;

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return payload.choices?.[0]?.message?.content?.trim() ?? null;
}

async function answerWithProAI(
  question: string,
  context: ChatContext,
  merchantId: number,
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return answerWithGroq(question, context);

  const { getFunctionDefinitions, executeFunction } = await import("./function-calling.server");
  const proPrompts = buildProPromptMessages(question, context);
  const functions = getFunctionDefinitions();

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0.3,
      max_tokens: 1000,
      messages: [
        { role: "system", content: proPrompts.system },
        { role: "user", content: proPrompts.user },
      ],
      tools: functions.map((f) => ({ type: "function", function: f })),
      tool_choice: "auto",
    }),
  });

  if (!response.ok) return answerWithGroq(question, context);

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
        tool_calls?: Array<{
          id: string;
          function: { name: string; arguments: string };
        }>;
      };
    }>;
  };

  const message = payload.choices?.[0]?.message;

  // If there are function calls, execute them
  if (message?.tool_calls && message.tool_calls.length > 0) {
    const toolResults: string[] = [];

    for (const toolCall of message.tool_calls) {
      const fnName = toolCall.function.name;
      const fnArgs = JSON.parse(toolCall.function.arguments || "{}");

      const result = await executeFunction(merchantId, fnName as Parameters<typeof executeFunction>[1], fnArgs);
      toolResults.push(`**${fnName}**: ${result.message}\n${JSON.stringify(result.data, null, 2)}`);
    }

    // Make a follow-up call to summarize the results
    const followUpResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0.3,
        max_tokens: 1000,
        messages: [
          { role: "system", content: proPrompts.system },
          { role: "user", content: proPrompts.user },
          { role: "assistant", content: null, tool_calls: message.tool_calls },
          ...message.tool_calls.map((tc, i) => ({
            role: "tool" as const,
            tool_call_id: tc.id,
            content: toolResults[i],
          })),
        ],
      }),
    });

    if (followUpResponse.ok) {
      const followUpPayload = (await followUpResponse.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return followUpPayload.choices?.[0]?.message?.content?.trim() ?? null;
    }
  }

  return message?.content?.trim() ?? null;
}

function buildProPromptMessages(question: string, context: ChatContext) {
  return {
    system: `You are an advanced inventory intelligence assistant for a Shopify merchant. You have access to detailed inventory analytics and can provide strategic recommendations.

Capabilities:
- Analyze inventory health and trends
- Identify stockout risks with confidence levels
- Recommend optimal reorder quantities and timing
- Suggest pricing strategies for dead stock
- Provide what-if scenario analysis
- Give actionable, prioritized recommendations

Be specific, data-driven, and include confidence levels when making predictions. Format responses clearly with sections and bullet points.`,
    user: [
      "=== INVENTORY ANALYTICS ===",
      context.summary,
      "",
      "=== TOP PRIORITY SKUS ===",
      context.topSkus.join("\n"),
      "",
      "=== CURRENT ALERTS & INSIGHTS ===",
      context.insights.join("\n"),
      "",
      `=== MERCHANT QUESTION ===`,
      question,
      "",
      "Provide a detailed, actionable response with specific recommendations.",
    ].join("\n"),
  };
}

async function answerWithLlm(question: string, context: ChatContext): Promise<string | null> {
  // Try providers in order: Groq (free) -> Gemini (free) -> OpenAI (paid)
  const groqAnswer = await answerWithGroq(question, context);
  if (groqAnswer) return groqAnswer;

  const geminiAnswer = await answerWithGemini(question, context);
  if (geminiAnswer) return geminiAnswer;

  const openaiAnswer = await answerWithOpenAI(question, context);
  if (openaiAnswer) return openaiAnswer;

  return null;
}

export async function answerInventoryQuestion(
  merchantId: number,
  question: string,
): Promise<AiAnswerResult> {
  const trimmed = question.trim();

  // Check query limits
  const limitCheck = await checkQueryLimit(merchantId);

  if (!trimmed) {
    return {
      answer: "Ask a question about reorder priorities, stockout risk, dead stock, or inventory health.",
      mode: "rules",
      plan: limitCheck.plan,
      remaining: limitCheck.remaining,
    };
  }

  // Check if limit reached
  if (!limitCheck.allowed) {
    return {
      answer: `Daily query limit reached (${limitCheck.plan === "FREE" ? "20" : "1000"} queries). ${
        limitCheck.plan === "FREE"
          ? "Upgrade to Pro for 1,000 daily queries and advanced AI features."
          : "Limit resets at midnight UTC."
      }`,
      mode: "rules",
      plan: limitCheck.plan,
      remaining: 0,
      limitReached: true,
    };
  }

  // Increment usage
  await incrementQueryCount(merchantId);
  const remaining = limitCheck.remaining - 1;

  const context = await buildChatContext(merchantId);

  // Use Pro AI if on Pro plan and has advanced_qa feature
  if (limitCheck.plan === "PRO" && hasFeature("PRO", "advanced_qa")) {
    const proAnswer = await answerWithProAI(trimmed, context, merchantId);
    if (proAnswer) {
      return { answer: proAnswer, mode: "pro_ai", plan: "PRO", remaining };
    }
  }

  // Use free tier AI (Groq/Gemini/OpenAI fallback)
  const llmAnswer = await answerWithLlm(trimmed, context);
  if (llmAnswer) {
    return { answer: llmAnswer, mode: "ai", plan: limitCheck.plan, remaining };
  }

  // Fallback to rules
  return {
    answer: answerWithRules(trimmed, context),
    mode: "rules",
    plan: limitCheck.plan,
    remaining,
  };
}

export function getAiModeLabel(plan?: SubscriptionPlan) {
  if (plan === "PRO" && process.env.OPENAI_API_KEY) {
    return "Pro AI (GPT-4o)";
  }
  if (process.env.GROQ_API_KEY) return "AI (Groq Llama)";
  if (process.env.GEMINI_API_KEY) return "AI (Google Gemini)";
  if (process.env.OPENAI_API_KEY) return "AI (OpenAI)";
  return "Smart rules";
}

export function getAiModeForResult(mode: "ai" | "rules" | "pro_ai"): string {
  switch (mode) {
    case "pro_ai":
      return "Pro AI (GPT-4o)";
    case "ai":
      return "AI";
    default:
      return "Smart Rules";
  }
}

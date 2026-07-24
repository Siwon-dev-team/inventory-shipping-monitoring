import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { Badge, Card, IndexTable } from "@shopify/polaris";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  answerInventoryQuestion,
  getAiModeLabel,
} from "../services/ai/chat.server";
import {
  getLatestInventoryInsights,
  persistInventoryInsights,
} from "../services/ai/insights.server";
import { ensureMerchantSetup } from "../services/merchant-setup.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);
  const settings = await prisma.settings.findUnique({
    where: { merchantId: merchant.id },
  });

  const insights = settings?.aiEnabled
    ? await getLatestInventoryInsights(merchant.id, 15)
    : [];

  const isAiConfigured = Boolean(
    process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY
  );

  return {
    insights,
    aiEnabled: settings?.aiEnabled ?? true,
    aiMode: getAiModeLabel(),
    isAiConfigured,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);
  const formData = await request.formData();
  const actionType = String(formData.get("actionType") ?? "");

  if (actionType === "refresh_insights") {
    const settings = await prisma.settings.findUnique({
      where: { merchantId: merchant.id },
    });
    if (!settings?.aiEnabled) {
      return { ok: false as const, message: "AI insights are disabled in settings." };
    }

    const insights = await persistInventoryInsights(merchant.id);
    return {
      ok: true as const,
      message: `Generated ${insights.length} insights.`,
      answer: null,
      mode: null,
    };
  }

  if (actionType === "ask") {
    const question = String(formData.get("question") ?? "");
    const settings = await prisma.settings.findUnique({
      where: { merchantId: merchant.id },
    });
    if (!settings?.aiEnabled) {
      return {
        ok: false as const,
        message: "AI assistant is disabled in Notifications settings.",
        answer: null,
        mode: null,
      };
    }

    const result = await answerInventoryQuestion(merchant.id, question);
    return {
      ok: true as const,
      message: null,
      answer: result.answer,
      mode: result.mode,
    };
  }

  return { ok: false as const, message: "Invalid action.", answer: null, mode: null };
};

function insightBadge(type: string) {
  if (type.includes("STOCKOUT") || type.includes("REORDER")) {
    return <Badge tone="critical">{type}</Badge>;
  }
  if (type.includes("DEAD")) {
    return <Badge tone="warning">{type}</Badge>;
  }
  if (type.includes("SPIKE") || type.includes("DROP")) {
    return <Badge tone="info">{type}</Badge>;
  }
  return <Badge>{type}</Badge>;
}

export default function AiInsightsPage() {
  const { insights, aiEnabled, aiMode, isAiConfigured } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <s-page heading="AI Inventory Insights">
      <s-section heading="Assistant">
        <Card>
          <div style={{ padding: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
              <Badge tone={isAiConfigured ? "success" : "warning"}>
                {isAiConfigured ? "AI Active" : "Basic Mode"}
              </Badge>
              <span style={{ color: "#637381", fontSize: "14px" }}>{aiMode}</span>
            </div>
            {isAiConfigured ? (
              <p style={{ margin: 0, color: "#202223", fontSize: "14px" }}>
                Ask any question about your inventory in natural language.
              </p>
            ) : (
              <p style={{ margin: 0, color: "#637381", fontSize: "14px" }}>
                Add a free AI key (Groq or Gemini) in server settings to enable smart answers.
              </p>
            )}
          </div>
        </Card>
      </s-section>

      <s-section heading="Ask your inventory">
        <Card>
          <div style={{ padding: "16px" }}>
            <Form method="post">
              <input type="hidden" name="actionType" value="ask" />
              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", marginBottom: "4px", fontWeight: 500 }}>
                  Question
                </label>
                <input
                  type="text"
                  name="question"
                  placeholder="e.g. What should I reorder? / Any stockout risks? / How is my inventory?"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    border: "1px solid #c9cccf",
                    borderRadius: "8px",
                    fontSize: "14px",
                  }}
                />
              </div>
              <s-button type="submit" variant="primary">Ask AI</s-button>
            </Form>
          </div>
        </Card>
        {actionData?.answer ? (
          <Card>
            <div style={{ padding: "16px" }}>
              <div style={{ marginBottom: "12px" }}>
                <Badge tone="success">AI Response</Badge>
              </div>
              <div style={{ whiteSpace: "pre-wrap", lineHeight: "1.7", color: "#202223" }}>
                {actionData.answer}
              </div>
            </div>
          </Card>
        ) : null}
      </s-section>

      <s-section heading="Auto-generated insights">
        <div style={{ marginBottom: "12px" }}>
          <Form method="post" style={{ display: "inline" }}>
            <input type="hidden" name="actionType" value="refresh_insights" />
            <s-button type="submit">Refresh insights</s-button>
          </Form>
          {actionData?.message ? (
            <span style={{ marginLeft: "12px", color: "#008060" }}>{actionData.message}</span>
          ) : null}
        </div>

        {!aiEnabled ? (
          <Card>
            <div style={{ padding: "16px", color: "#637381" }}>
              Enable AI in Notifications settings to use insights.
            </div>
          </Card>
        ) : insights.length === 0 ? (
          <Card>
            <div style={{ padding: "16px", color: "#637381" }}>
              No insights yet. Click "Refresh insights" to generate.
            </div>
          </Card>
        ) : (
          <Card>
            <IndexTable
              resourceName={{ singular: "insight", plural: "insights" }}
              itemCount={insights.length}
              selectable={false}
              headings={[
                { title: "Type" },
                { title: "Title" },
                { title: "Insight" },
                { title: "Score" },
              ]}
            >
              {insights.map((insight, index) => (
                <IndexTable.Row id={`insight-${insight.id}`} key={insight.id} position={index}>
                  <IndexTable.Cell>{insightBadge(insight.type)}</IndexTable.Cell>
                  <IndexTable.Cell>{insight.title}</IndexTable.Cell>
                  <IndexTable.Cell>{insight.message}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {insight.score != null ? insight.score.toFixed(0) : "-"}
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        )}
      </s-section>
    </s-page>
  );
}

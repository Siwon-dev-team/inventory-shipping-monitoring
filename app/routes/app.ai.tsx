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

  return {
    insights,
    aiEnabled: settings?.aiEnabled ?? true,
    aiMode: getAiModeLabel(),
    openAiConfigured: Boolean(process.env.OPENAI_API_KEY),
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
  const { insights, aiEnabled, aiMode, openAiConfigured } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <s-page heading="AI Inventory Insights">
      <s-section heading="Assistant mode">
        <s-paragraph>
          Mode: <s-text>{aiMode}</s-text>
        </s-paragraph>
        <s-paragraph>
          AI status: <s-text>{aiEnabled ? "Enabled" : "Disabled"}</s-text>
        </s-paragraph>
        {!openAiConfigured ? (
          <s-paragraph>
            Set `OPENAI_API_KEY` to unlock LLM answers. Without it, the assistant uses smart
            inventory rules.
          </s-paragraph>
        ) : null}
      </s-section>

      <s-section heading="Refresh insights">
        <Form method="post">
          <input type="hidden" name="actionType" value="refresh_insights" />
          <s-button type="submit" variant="primary">
            Regenerate insights
          </s-button>
        </Form>
        {actionData?.message ? (
          <s-paragraph>
            <s-text>{actionData.message}</s-text>
          </s-paragraph>
        ) : null}
      </s-section>

      <s-section heading="Ask your inventory">
        <Form method="post">
          <input type="hidden" name="actionType" value="ask" />
          <s-stack direction="block" gap="base">
            <s-text-field
              name="question"
              label="Question"
              value=""
              placeholder="What should I reorder first?"
            />
            <s-button type="submit">Ask AI</s-button>
          </s-stack>
        </Form>
        {actionData?.answer ? (
          <s-box borderWidth="base" borderRadius="base" padding="base">
            <s-paragraph>
              <s-text>
                [{actionData.mode}] {actionData.answer}
              </s-text>
            </s-paragraph>
          </s-box>
        ) : null}
      </s-section>

      <s-section heading="Generated insights">
        {!aiEnabled ? (
          <s-paragraph>Enable AI in notification settings to use insights.</s-paragraph>
        ) : insights.length === 0 ? (
          <s-paragraph>No insights yet. Click regenerate.</s-paragraph>
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

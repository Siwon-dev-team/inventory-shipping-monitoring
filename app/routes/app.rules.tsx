import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, Link } from "react-router";
import { Badge, Card, IndexTable, Button } from "@shopify/polaris";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { ensureMerchantSetup } from "../services/merchant-setup.server";
import { getOrCreateSubscription, hasFeature } from "../services/billing/subscription.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);
  const subscription = await getOrCreateSubscription(merchant.id);

  const canUseRules = hasFeature(subscription.plan, "auto_replenishment");

  const rules = canUseRules
    ? await prisma.replenishmentRule.findMany({
        where: { merchantId: merchant.id },
        orderBy: { createdAt: "desc" },
      })
    : [];

  const suppliers = await prisma.supplier.findMany({
    where: { merchantId: merchant.id },
  });

  return {
    rules,
    suppliers,
    plan: subscription.plan,
    canUseRules,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);
  const subscription = await getOrCreateSubscription(merchant.id);

  if (!hasFeature(subscription.plan, "auto_replenishment")) {
    return { ok: false, error: "Upgrade to Pro to use auto-replenishment rules." };
  }

  const formData = await request.formData();
  const actionType = String(formData.get("actionType") ?? "");

  if (actionType === "create") {
    const name = String(formData.get("name") ?? "");
    const trigger = String(formData.get("trigger") ?? "DAYS_OF_COVER");
    const triggerValue = Number(formData.get("triggerValue") ?? 7);
    const action = String(formData.get("action") ?? "CREATE_DRAFT_PO");

    await prisma.replenishmentRule.create({
      data: {
        merchantId: merchant.id,
        name: name || `Rule ${Date.now()}`,
        trigger: trigger as "DAYS_OF_COVER" | "STOCKOUT_DATE" | "QUANTITY_BELOW",
        triggerValue,
        action: action as "CREATE_DRAFT_PO" | "SEND_PO" | "NOTIFY_SLACK" | "NOTIFY_EMAIL",
        enabled: true,
      },
    });

    return { ok: true, message: "Rule created successfully." };
  }

  if (actionType === "toggle") {
    const ruleId = Number(formData.get("ruleId"));
    const enabled = formData.get("enabled") === "true";

    await prisma.replenishmentRule.update({
      where: { id: ruleId },
      data: { enabled: !enabled },
    });

    return { ok: true, message: `Rule ${enabled ? "disabled" : "enabled"}.` };
  }

  if (actionType === "delete") {
    const ruleId = Number(formData.get("ruleId"));

    await prisma.replenishmentRule.delete({
      where: { id: ruleId },
    });

    return { ok: true, message: "Rule deleted." };
  }

  return { ok: false, error: "Invalid action." };
};

function triggerLabel(trigger: string, value: number): string {
  switch (trigger) {
    case "DAYS_OF_COVER":
      return `Days of cover < ${value}`;
    case "STOCKOUT_DATE":
      return `Stockout within ${value} days`;
    case "QUANTITY_BELOW":
      return `Quantity < ${value}`;
    default:
      return trigger;
  }
}

function actionLabel(action: string): string {
  switch (action) {
    case "CREATE_DRAFT_PO":
      return "Create draft PO";
    case "SEND_PO":
      return "Send PO to supplier";
    case "NOTIFY_SLACK":
      return "Notify via Slack";
    case "NOTIFY_EMAIL":
      return "Notify via Email";
    default:
      return action;
  }
}

export default function RulesPage() {
  const { rules, plan, canUseRules } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  if (!canUseRules) {
    return (
      <s-page heading="Auto-Replenishment Rules">
        <s-section>
          <Card>
            <div style={{ padding: "32px", textAlign: "center" }}>
              <Badge tone="info">Pro Feature</Badge>
              <h2 style={{ marginTop: "16px", marginBottom: "8px" }}>
                Automate your inventory replenishment
              </h2>
              <p style={{ color: "#637381", marginBottom: "20px" }}>
                Set up rules to automatically create purchase orders or send alerts when inventory
                levels hit your thresholds.
              </p>
              <Link to="/app/billing">
                <Button variant="primary">Upgrade to Pro</Button>
              </Link>
            </div>
          </Card>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Auto-Replenishment Rules">
      {actionData?.message && (
        <s-section>
          <div style={{ padding: "12px", background: "#d4edda", borderRadius: "8px", color: "#155724" }}>
            {actionData.message}
          </div>
        </s-section>
      )}
      {actionData?.error && (
        <s-section>
          <div style={{ padding: "12px", background: "#f8d7da", borderRadius: "8px", color: "#721c24" }}>
            {actionData.error}
          </div>
        </s-section>
      )}

      <s-section heading="Create New Rule">
        <Card>
          <div style={{ padding: "16px" }}>
            <Form method="post">
              <input type="hidden" name="actionType" value="create" />
              <div style={{ display: "grid", gap: "16px", gridTemplateColumns: "1fr 1fr 1fr 1fr auto" }}>
                <div>
                  <label style={{ display: "block", marginBottom: "4px", fontWeight: 500 }}>
                    Rule Name
                  </label>
                  <input
                    type="text"
                    name="name"
                    placeholder="e.g., Low stock alert"
                    style={{ width: "100%", padding: "8px", border: "1px solid #ccc", borderRadius: "4px" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: "4px", fontWeight: 500 }}>
                    Trigger
                  </label>
                  <select
                    name="trigger"
                    style={{ width: "100%", padding: "8px", border: "1px solid #ccc", borderRadius: "4px" }}
                  >
                    <option value="DAYS_OF_COVER">Days of Cover Below</option>
                    <option value="STOCKOUT_DATE">Stockout Within Days</option>
                    <option value="QUANTITY_BELOW">Quantity Below</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: "4px", fontWeight: 500 }}>
                    Value
                  </label>
                  <input
                    type="number"
                    name="triggerValue"
                    defaultValue={7}
                    min={1}
                    style={{ width: "100%", padding: "8px", border: "1px solid #ccc", borderRadius: "4px" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: "4px", fontWeight: 500 }}>
                    Action
                  </label>
                  <select
                    name="action"
                    style={{ width: "100%", padding: "8px", border: "1px solid #ccc", borderRadius: "4px" }}
                  >
                    <option value="CREATE_DRAFT_PO">Create Draft PO</option>
                    <option value="NOTIFY_SLACK">Notify Slack</option>
                    <option value="NOTIFY_EMAIL">Notify Email</option>
                  </select>
                </div>
                <div style={{ alignSelf: "end" }}>
                  <Button variant="primary" submit>
                    Create Rule
                  </Button>
                </div>
              </div>
            </Form>
          </div>
        </Card>
      </s-section>

      <s-section heading="Active Rules">
        {rules.length === 0 ? (
          <Card>
            <div style={{ padding: "32px", textAlign: "center", color: "#637381" }}>
              No rules yet. Create your first rule above.
            </div>
          </Card>
        ) : (
          <Card>
            <IndexTable
              resourceName={{ singular: "rule", plural: "rules" }}
              itemCount={rules.length}
              selectable={false}
              headings={[
                { title: "Name" },
                { title: "Trigger" },
                { title: "Action" },
                { title: "Status" },
                { title: "Last Run" },
                { title: "Actions" },
              ]}
            >
              {rules.map((rule, index) => (
                <IndexTable.Row id={`rule-${rule.id}`} key={rule.id} position={index}>
                  <IndexTable.Cell>{rule.name}</IndexTable.Cell>
                  <IndexTable.Cell>{triggerLabel(rule.trigger, rule.triggerValue)}</IndexTable.Cell>
                  <IndexTable.Cell>{actionLabel(rule.action)}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={rule.enabled ? "success" : "info"}>
                      {rule.enabled ? "Active" : "Disabled"}
                    </Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {rule.lastRunAt ? new Date(rule.lastRunAt).toLocaleString() : "Never"}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <Form method="post" style={{ display: "inline" }}>
                        <input type="hidden" name="actionType" value="toggle" />
                        <input type="hidden" name="ruleId" value={rule.id} />
                        <input type="hidden" name="enabled" value={String(rule.enabled)} />
                        <Button size="slim" submit>
                          {rule.enabled ? "Disable" : "Enable"}
                        </Button>
                      </Form>
                      <Form method="post" style={{ display: "inline" }}>
                        <input type="hidden" name="actionType" value="delete" />
                        <input type="hidden" name="ruleId" value={rule.id} />
                        <Button size="slim" tone="critical" submit>
                          Delete
                        </Button>
                      </Form>
                    </div>
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

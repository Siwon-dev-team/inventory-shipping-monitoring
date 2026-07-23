import { DigestFrequency, NotificationChannel, NotificationEvent } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { ensureMerchantSetup } from "../services/merchant-setup.server";

const EVENTS = [
  NotificationEvent.LOW_STOCK,
  NotificationEvent.CRITICAL_STOCK,
  NotificationEvent.OUT_OF_STOCK,
  NotificationEvent.RESTOCKED,
];

const CHANNELS = [
  NotificationChannel.EMAIL,
  NotificationChannel.SLACK,
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);

  const flows = await prisma.notificationFlow.findMany({
    where: { merchantId: merchant.id },
    orderBy: [{ event: "asc" }, { channel: "asc" }],
  });
  const settings = await prisma.settings.findUnique({
    where: { merchantId: merchant.id },
  });

  return {
    merchantId: merchant.id,
    contactEmail: merchant.contactEmail,
    hasFallbackRecipient: Boolean(process.env.ALERT_EMAIL_TO),
    slackWebhookUrl: settings?.slackWebhookUrl ?? "",
    digestEnabled: settings?.digestEnabled ?? false,
    digestFrequency: settings?.digestFrequency ?? DigestFrequency.DAILY,
    aiEnabled: settings?.aiEnabled ?? true,
    flows,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);
  const formData = await request.formData();
  const actionType = String(formData.get("actionType") ?? "flow");

  if (actionType === "contact_email") {
    const contactEmailRaw = String(formData.get("contactEmail") ?? "").trim();
    const contactEmail = contactEmailRaw.length > 0 ? contactEmailRaw : null;
    if (contactEmail && !contactEmail.includes("@")) {
      return { ok: false as const, message: "Please enter a valid email address." };
    }

    await prisma.merchant.update({
      where: { id: merchant.id },
      data: { contactEmail },
    });

    return { ok: true as const, message: "Email recipient saved." };
  }

  if (actionType === "slack_settings") {
    const slackWebhookUrlRaw = String(formData.get("slackWebhookUrl") ?? "").trim();
    const slackWebhookUrl =
      slackWebhookUrlRaw.length > 0 ? slackWebhookUrlRaw : null;

    await prisma.settings.updateMany({
      where: { merchantId: merchant.id },
      data: { slackWebhookUrl },
    });

    return { ok: true as const, message: "Slack settings saved." };
  }

  if (actionType === "digest_settings") {
    const digestEnabled = formData.get("digestEnabled") === "on";
    const digestFrequencyRaw = String(formData.get("digestFrequency") ?? DigestFrequency.DAILY);
    const digestFrequency =
      digestFrequencyRaw === DigestFrequency.WEEKLY
        ? DigestFrequency.WEEKLY
        : DigestFrequency.DAILY;

    await prisma.settings.updateMany({
      where: { merchantId: merchant.id },
      data: { digestEnabled, digestFrequency },
    });

    return { ok: true as const, message: "Digest settings saved." };
  }

  if (actionType === "ai_settings") {
    const aiEnabled = formData.get("aiEnabled") === "on";

    await prisma.settings.updateMany({
      where: { merchantId: merchant.id },
      data: { aiEnabled },
    });

    return { ok: true as const, message: "AI settings saved." };
  }

  const event = String(formData.get("event")) as NotificationEvent;
  const channel = String(formData.get("channel")) as NotificationChannel;
  const enabled = formData.get("enabled") === "on";

  if (!EVENTS.includes(event) || !(CHANNELS as readonly NotificationChannel[]).includes(channel)) {
    return { ok: false as const, message: "Invalid event or channel." };
  }

  await prisma.notificationFlow.upsert({
    where: {
      merchantId_event_channel: {
        merchantId: merchant.id,
        event,
        channel,
      },
    },
    update: { enabled },
    create: {
      merchantId: merchant.id,
      event,
      channel,
      enabled,
    },
  });

  return { ok: true as const, message: "Flow updated." };
};

function isEnabled(
  flows: Array<{ event: NotificationEvent; channel: NotificationChannel; enabled: boolean }>,
  event: NotificationEvent,
  channel: NotificationChannel,
) {
  return flows.find((flow) => flow.event === event && flow.channel === channel)?.enabled ?? false;
}

export default function NotificationsPage() {
  const {
    flows,
    contactEmail,
    hasFallbackRecipient,
    slackWebhookUrl,
    digestEnabled,
    digestFrequency,
    aiEnabled,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <s-page heading="Notification Flow Configuration">
      <s-section heading="Email recipient">
        <s-paragraph>
          Alerts are sent to merchant email first. If empty, the app falls back to
          the environment recipient.
        </s-paragraph>
        <Form method="post">
          <input type="hidden" name="actionType" value="contact_email" />
          <s-stack direction="inline" gap="base">
            <s-text-field
              name="contactEmail"
              label="Recipient email"
              value={contactEmail ?? ""}
            />
            <s-button type="submit" variant="primary">
              Save email
            </s-button>
          </s-stack>
        </Form>
        <s-paragraph>
          Fallback `ALERT_EMAIL_TO`: {hasFallbackRecipient ? "Configured" : "Not configured"}
        </s-paragraph>
      </s-section>

      <s-section heading="Slack webhook">
        <s-paragraph>
          Paste an incoming webhook URL to receive instant alerts in Slack.
        </s-paragraph>
        <Form method="post">
          <input type="hidden" name="actionType" value="slack_settings" />
          <s-stack direction="inline" gap="base">
            <s-text-field
              name="slackWebhookUrl"
              label="Slack webhook URL"
              value={slackWebhookUrl}
            />
            <s-button type="submit" variant="primary">
              Save Slack settings
            </s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="Inventory digest">
        <s-paragraph>
          Sends a summary of urgent SKUs by email and Slack when enabled.
        </s-paragraph>
        <Form method="post">
          <input type="hidden" name="actionType" value="digest_settings" />
          <s-stack direction="block" gap="base">
            <s-checkbox
              name="digestEnabled"
              checked={digestEnabled}
              label="Enable inventory digest"
            />
            <label>
              Frequency
              <select name="digestFrequency" defaultValue={digestFrequency}>
                <option value={DigestFrequency.DAILY}>Daily</option>
                <option value={DigestFrequency.WEEKLY}>Weekly</option>
              </select>
            </label>
            <s-button type="submit">Save digest settings</s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="AI assistant">
        <s-paragraph>
          Enable AI insights and Q&amp;A on the AI Insights page. Uses OpenAI when configured,
          otherwise smart inventory rules.
        </s-paragraph>
        <Form method="post">
          <input type="hidden" name="actionType" value="ai_settings" />
          <s-checkbox name="aiEnabled" checked={aiEnabled} label="Enable AI insights" />
          <s-button type="submit">Save AI settings</s-button>
        </Form>
      </s-section>

      <s-section heading="Event channel matrix">
        {actionData ? (
          <s-paragraph>
            <s-text>{actionData.message}</s-text>
          </s-paragraph>
        ) : null}
        <s-stack direction="block" gap="base">
          {EVENTS.map((event) => (
            <s-box key={event} borderWidth="base" borderRadius="base" padding="base">
              <s-heading>{event}</s-heading>
              <s-stack direction="inline" gap="base">
                {CHANNELS.map((channel) => (
                  <Form key={`${event}-${channel}`} method="post">
                    <input type="hidden" name="actionType" value="flow" />
                    <input type="hidden" name="event" value={event} />
                    <input type="hidden" name="channel" value={channel} />
                    <s-checkbox
                      name="enabled"
                      checked={isEnabled(flows, event, channel)}
                      label={channel}
                    />
                    <s-button type="submit" variant="tertiary">
                      Save
                    </s-button>
                  </Form>
                ))}
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}


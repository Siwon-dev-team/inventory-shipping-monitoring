import { NotificationChannel, NotificationEvent } from "@prisma/client";
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
  NotificationChannel.SMS,
  NotificationChannel.OTT,
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);

  const flows = await prisma.notificationFlow.findMany({
    where: { merchantId: merchant.id },
    orderBy: [{ event: "asc" }, { channel: "asc" }],
  });

  return { merchantId: merchant.id, flows };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);
  const formData = await request.formData();

  const event = String(formData.get("event")) as NotificationEvent;
  const channel = String(formData.get("channel")) as NotificationChannel;
  const enabled = formData.get("enabled") === "on";

  if (!EVENTS.includes(event) || !CHANNELS.includes(channel)) {
    return { ok: false };
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

  return { ok: true };
};

function isEnabled(
  flows: Array<{ event: NotificationEvent; channel: NotificationChannel; enabled: boolean }>,
  event: NotificationEvent,
  channel: NotificationChannel,
) {
  return flows.find((flow) => flow.event === event && flow.channel === channel)?.enabled ?? false;
}

export default function NotificationsPage() {
  const { flows } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <s-page heading="Notification Flow Configuration">
      <s-section heading="Event channel matrix">
        {actionData?.ok ? (
          <s-paragraph>
            <s-text>Flow updated.</s-text>
          </s-paragraph>
        ) : null}
        <s-stack direction="block" gap="base">
          {EVENTS.map((event) => (
            <s-box key={event} borderWidth="base" borderRadius="base" padding="base">
              <s-heading>{event}</s-heading>
              <s-stack direction="inline" gap="base">
                {CHANNELS.map((channel) => (
                  <Form key={`${event}-${channel}`} method="post">
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


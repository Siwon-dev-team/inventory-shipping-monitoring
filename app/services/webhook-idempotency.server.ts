import prisma from "../db.server";

type MarkWebhookProcessedInput = {
  shopDomain: string;
  topic: string;
  webhookId: string;
  merchantId?: number;
  payloadHash?: string;
};

export async function markWebhookProcessed(
  input: MarkWebhookProcessedInput,
): Promise<boolean> {
  try {
    await prisma.webhookDelivery.create({
      data: {
        merchantId: input.merchantId,
        shopDomain: input.shopDomain,
        topic: input.topic,
        webhookId: input.webhookId,
        payloadHash: input.payloadHash ?? null,
      },
    });
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      return false;
    }
    throw error;
  }
}


import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findUniqueMock,
  findManyMock,
  sendEmailMock,
  sendSlackMessageMock,
  buildReorderListMock,
  updateMock,
} = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  findManyMock: vi.fn(),
  sendEmailMock: vi.fn(),
  sendSlackMessageMock: vi.fn(),
  buildReorderListMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock("../../app/db.server", () => ({
  default: {
    merchant: {
      findUnique: findUniqueMock,
      findMany: findManyMock,
    },
    settings: {
      update: updateMock,
    },
  },
}));

vi.mock("../../app/services/inventory/reorder-list.server", () => ({
  buildReorderList: buildReorderListMock,
}));

vi.mock("../../app/services/notifications/email.server", () => ({
  sendEmail: sendEmailMock,
}));

vi.mock("../../app/services/notifications/slack.server", () => ({
  sendSlackMessage: sendSlackMessageMock,
}));

import { sendInventoryDigestForMerchant } from "../../app/services/notifications/digest.server";

describe("sendInventoryDigestForMerchant", () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    buildReorderListMock.mockReset();
    sendEmailMock.mockReset();
    sendSlackMessageMock.mockReset();
    updateMock.mockReset();
  });

  it("skips when digest is disabled", async () => {
    findUniqueMock.mockResolvedValue({
      shopDomain: "shop.myshopify.com",
      contactEmail: "merchant@example.com",
      settings: { digestEnabled: false, slackWebhookUrl: null },
    });

    const result = await sendInventoryDigestForMerchant(1);
    expect(result).toEqual({ sent: false, reason: "digest_disabled" });
  });

  it("skips weekly digest when not due", async () => {
    findUniqueMock.mockResolvedValue({
      shopDomain: "shop.myshopify.com",
      contactEmail: "merchant@example.com",
      settings: {
        digestEnabled: true,
        digestFrequency: "WEEKLY",
        lastDigestSentAt: new Date(),
        slackWebhookUrl: null,
      },
    });

    const result = await sendInventoryDigestForMerchant(1);
    expect(result).toEqual({ sent: false, reason: "not_due" });
  });

  it("sends email and slack when digest is enabled", async () => {
    findUniqueMock.mockResolvedValue({
      shopDomain: "shop.myshopify.com",
      contactEmail: "merchant@example.com",
      settings: {
        digestEnabled: true,
        digestFrequency: "DAILY",
        lastDigestSentAt: null,
        slackWebhookUrl: "https://hooks.slack.com/test",
      },
    });
    buildReorderListMock.mockResolvedValue({
      summary: {
        stockHealthScore: 80,
        activeAlerts: 2,
        needsReorder: 1,
        deadStockCount: 0,
      },
      rows: [
        {
          productTitle: "Product A",
          sku: "SKU-1",
          locationName: "Main",
          inventoryQuantity: 2,
          reorderSuggestionQty: 10,
          urgencyScore: 90,
        },
      ],
    });

    const result = await sendInventoryDigestForMerchant(1);

    expect(sendEmailMock).toHaveBeenCalledOnce();
    expect(sendSlackMessageMock).toHaveBeenCalledOnce();
    expect(updateMock).toHaveBeenCalledOnce();
    expect(result.sent).toBe(true);
  });
});

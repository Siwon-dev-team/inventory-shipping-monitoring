import { beforeEach, describe, expect, it, vi } from "vitest";

const { buildReorderListMock } = vi.hoisted(() => ({
  buildReorderListMock: vi.fn(),
}));

vi.mock("../../app/services/inventory/reorder-list.server", () => ({
  buildReorderList: buildReorderListMock,
}));

vi.mock("../../app/services/ai/insights.server", () => ({
  generateInventoryInsights: vi.fn().mockResolvedValue([
    {
      type: "SUMMARY",
      title: "Inventory health summary",
      message: "Stock health is 80%.",
    },
  ]),
}));

import { answerInventoryQuestion } from "../../app/services/ai/chat.server";

describe("answerInventoryQuestion", () => {
  beforeEach(() => {
    buildReorderListMock.mockReset();
    buildReorderListMock.mockResolvedValue({
      summary: {
        stockHealthScore: 80,
        needsReorder: 2,
        deadStockCount: 1,
      },
      rows: [
        {
          productTitle: "Product A",
          sku: "SKU-1",
          inventoryQuantity: 2,
          reorderSuggestionQty: 10,
          urgencyScore: 90,
        },
      ],
    });
  });

  it("answers reorder questions with rule mode", async () => {
    const result = await answerInventoryQuestion(1, "What should I reorder first?");
    expect(result.mode).toBe("rules");
    expect(result.answer).toContain("Product A");
  });
});

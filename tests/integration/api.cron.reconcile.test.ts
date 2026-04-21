import { describe, expect, it } from "vitest";
import { action } from "../../app/routes/api.cron.reconcile";

describe("api.cron.reconcile action", () => {
  it("returns unauthorized when CRON_SECRET is missing", async () => {
    const previousSecret = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;

    const request = new Request("https://example.test/api/cron/reconcile", {
      method: "POST",
      headers: {
        authorization: "Bearer test",
      },
    });

    const response = await action({ request } as never);
    expect(response.status).toBe(401);

    if (previousSecret) {
      process.env.CRON_SECRET = previousSecret;
    }
  });
});


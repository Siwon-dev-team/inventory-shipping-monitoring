import { describe, expect, it } from "vitest";
import { detectVelocityAnomalies } from "../../app/services/ai/anomaly-detection.server";

describe("detectVelocityAnomalies", () => {
  it("detects demand spikes", () => {
    const anomalies = detectVelocityAnomalies([
      {
        variantId: 1,
        productTitle: "Fast seller",
        sku: "A",
        velocity7d: 10,
        velocity30d: 3,
        classification: "FAST_MOVING",
      },
    ]);

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.type).toBe("SPIKE");
  });

  it("detects demand drops", () => {
    const anomalies = detectVelocityAnomalies([
      {
        variantId: 2,
        productTitle: "Cooling product",
        sku: "B",
        velocity7d: 0.5,
        velocity30d: 2,
        classification: "STABLE",
      },
    ]);

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.type).toBe("DROP");
  });
});

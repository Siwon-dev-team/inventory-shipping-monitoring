import type { Location, Product, Settings, Variant } from "@prisma/client";
import { evaluateAlertLifecycle } from "./alert-lifecycle.server";
import { resolveThresholdState } from "./threshold.server";
import { dispatchInventoryNotification } from "../notifications/dispatcher.server";

type MonitorInput = {
  merchantId: number;
  settings: Settings;
  product: Product;
  variant: Variant;
  currentQuantity: number;
  location?: Location | null;
};

export async function monitorVariantQuantity(input: MonitorInput) {
  if (!input.settings.monitoringEnabled) {
    return { changed: false, action: "monitoring_disabled" as const };
  }

  const resolvedState = resolveThresholdState({
    quantity: input.currentQuantity,
    globalLowThreshold: input.settings.globalLowThreshold,
    globalCriticalThreshold: input.settings.globalCriticalThreshold,
    locationLowThreshold: input.location?.lowThreshold,
    locationCriticalThreshold: input.location?.criticalThreshold,
    productLowThreshold: input.product.lowThreshold,
    productCriticalThreshold: input.product.criticalThreshold,
    variantLowThreshold: input.variant.lowThreshold,
    variantCriticalThreshold: input.variant.criticalThreshold,
  });

  const lifecycleResult = await evaluateAlertLifecycle({
    merchantId: input.merchantId,
    productId: input.product.id,
    variantId: input.variant.id,
    locationId: input.location?.id,
    currentQuantity: input.currentQuantity,
    thresholdValue: resolvedState.lowThreshold,
    alertLevel: resolvedState.alertLevel,
    triggerEvent: resolvedState.triggerEvent,
  });

  if (lifecycleResult.action === "created_active" && lifecycleResult.event) {
    await dispatchInventoryNotification({
      merchantId: input.merchantId,
      event: lifecycleResult.event,
      alertId: lifecycleResult.alertId,
      productTitle: input.product.title,
      variantSku: input.variant.sku ?? null,
      currentQuantity: input.currentQuantity,
      thresholdValue: resolvedState.lowThreshold,
      levelLabel: resolvedState.alertLevel ?? "LOW",
    });
  }

  if (
    lifecycleResult.action === "resolved" &&
    input.settings.notifyOnRestocked &&
    lifecycleResult.event
  ) {
    await dispatchInventoryNotification({
      merchantId: input.merchantId,
      event: lifecycleResult.event,
      alertId: lifecycleResult.alertId,
      productTitle: input.product.title,
      variantSku: input.variant.sku ?? null,
      currentQuantity: input.currentQuantity,
      thresholdValue: resolvedState.lowThreshold,
      levelLabel: "RESTOCKED",
    });
  }

  return lifecycleResult;
}


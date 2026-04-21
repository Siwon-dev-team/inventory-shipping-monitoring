import { AlertLevel, NotificationEvent } from "@prisma/client";

export type ThresholdInput = {
  quantity: number;
  globalLowThreshold: number;
  globalCriticalThreshold?: number | null;
  locationLowThreshold?: number | null;
  locationCriticalThreshold?: number | null;
  productLowThreshold?: number | null;
  productCriticalThreshold?: number | null;
  variantLowThreshold?: number | null;
  variantCriticalThreshold?: number | null;
};

export type ThresholdResolution = {
  lowThreshold: number;
  criticalThreshold: number;
  alertLevel: AlertLevel | null;
  triggerEvent: NotificationEvent | null;
};

function pickByPriority(values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

export function resolveThresholdState(input: ThresholdInput): ThresholdResolution {
  const lowThreshold =
    pickByPriority([
      input.variantLowThreshold,
      input.productLowThreshold,
      input.locationLowThreshold,
      input.globalLowThreshold,
    ]) ?? input.globalLowThreshold;

  const criticalThreshold =
    pickByPriority([
      input.variantCriticalThreshold,
      input.productCriticalThreshold,
      input.locationCriticalThreshold,
      input.globalCriticalThreshold,
    ]) ?? Math.max(1, Math.floor(lowThreshold * 0.5));

  if (input.quantity <= 0) {
    return {
      lowThreshold,
      criticalThreshold,
      alertLevel: AlertLevel.OUT_OF_STOCK,
      triggerEvent: NotificationEvent.OUT_OF_STOCK,
    };
  }

  if (input.quantity <= criticalThreshold) {
    return {
      lowThreshold,
      criticalThreshold,
      alertLevel: AlertLevel.CRITICAL,
      triggerEvent: NotificationEvent.CRITICAL_STOCK,
    };
  }

  if (input.quantity <= lowThreshold) {
    return {
      lowThreshold,
      criticalThreshold,
      alertLevel: AlertLevel.LOW,
      triggerEvent: NotificationEvent.LOW_STOCK,
    };
  }

  return {
    lowThreshold,
    criticalThreshold,
    alertLevel: null,
    triggerEvent: null,
  };
}


import type { SubscriptionPlan } from "@prisma/client";
import prisma from "../../db.server";

const PLAN_LIMITS = {
  FREE: {
    dailyQueryLimit: 20,
    historicalDays: 30,
    features: ["basic_qa", "basic_insights"],
  },
  PRO: {
    dailyQueryLimit: 1000,
    historicalDays: 365,
    features: [
      "basic_qa",
      "basic_insights",
      "advanced_qa",
      "function_calling",
      "auto_replenishment",
      "weekly_reports",
      "ml_forecasting",
      "scenario_modeling",
    ],
  },
} as const;

export type PlanFeature = (typeof PLAN_LIMITS.PRO.features)[number];

export async function getOrCreateSubscription(merchantId: number) {
  let subscription = await prisma.subscription.findUnique({
    where: { merchantId },
  });

  if (!subscription) {
    subscription = await prisma.subscription.create({
      data: {
        merchantId,
        plan: "FREE",
        status: "ACTIVE",
        dailyQueryLimit: PLAN_LIMITS.FREE.dailyQueryLimit,
        queryResetAt: getNextResetDate(),
      },
    });
  }

  return subscription;
}

export async function getSubscription(merchantId: number) {
  return prisma.subscription.findUnique({
    where: { merchantId },
  });
}

export function getPlanLimits(plan: SubscriptionPlan) {
  return PLAN_LIMITS[plan];
}

export function hasFeature(plan: SubscriptionPlan, feature: PlanFeature): boolean {
  const features = PLAN_LIMITS[plan].features as readonly string[];
  return features.includes(feature);
}

export async function checkQueryLimit(merchantId: number): Promise<{
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  plan: SubscriptionPlan;
}> {
  const subscription = await getOrCreateSubscription(merchantId);

  // Reset daily count if needed
  const now = new Date();
  if (now >= subscription.queryResetAt) {
    await prisma.subscription.update({
      where: { merchantId },
      data: {
        dailyQueryCount: 0,
        queryResetAt: getNextResetDate(),
      },
    });
    subscription.dailyQueryCount = 0;
    subscription.queryResetAt = getNextResetDate();
  }

  const remaining = subscription.dailyQueryLimit - subscription.dailyQueryCount;

  return {
    allowed: remaining > 0,
    remaining,
    resetAt: subscription.queryResetAt,
    plan: subscription.plan,
  };
}

export async function incrementQueryCount(merchantId: number) {
  return prisma.subscription.update({
    where: { merchantId },
    data: {
      dailyQueryCount: { increment: 1 },
    },
  });
}

export async function upgradeToPro(
  merchantId: number,
  shopifySubscriptionId: string,
) {
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setDate(periodEnd.getDate() + 30);

  return prisma.subscription.upsert({
    where: { merchantId },
    create: {
      merchantId,
      plan: "PRO",
      status: "ACTIVE",
      shopifySubscriptionId,
      dailyQueryLimit: PLAN_LIMITS.PRO.dailyQueryLimit,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      queryResetAt: getNextResetDate(),
    },
    update: {
      plan: "PRO",
      status: "ACTIVE",
      shopifySubscriptionId,
      dailyQueryLimit: PLAN_LIMITS.PRO.dailyQueryLimit,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      cancelledAt: null,
    },
  });
}

export async function downgradeToFree(merchantId: number) {
  return prisma.subscription.update({
    where: { merchantId },
    data: {
      plan: "FREE",
      status: "ACTIVE",
      dailyQueryLimit: PLAN_LIMITS.FREE.dailyQueryLimit,
      shopifySubscriptionId: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
    },
  });
}

export async function cancelSubscription(merchantId: number) {
  return prisma.subscription.update({
    where: { merchantId },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
    },
  });
}

function getNextResetDate(): Date {
  const now = new Date();
  const reset = new Date(now);
  reset.setUTCHours(0, 0, 0, 0);
  reset.setDate(reset.getDate() + 1);
  return reset;
}

export const PRO_PRICE = 9.99;
export const PRO_PRICE_CURRENCY = "USD";

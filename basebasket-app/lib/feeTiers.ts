export type FeeTierName = "Standard" | "Pro" | "Institutional";

export interface FeeQuote {
  tierName: FeeTierName;
  tierIndex: 0 | 1 | 2;
  feeBps: bigint;
  feePercent: string;
}

export function resolveBasketFeeTier(usdValue: number): FeeQuote {
  if (usdValue >= 100_000) {
    return { tierName: "Institutional", tierIndex: 2, feeBps: BigInt('15'), feePercent: "0.15" };
  }
  if (usdValue >= 5_000) {
    return { tierName: "Pro", tierIndex: 1, feeBps: BigInt('60'), feePercent: "0.60" };
  }
  return {
    tierName: "Standard",
    tierIndex: 0,
    feeBps: BigInt('150'),
    feePercent: "1.50",
  };
}

import { NextResponse } from "next/server";
import { encodeFunctionData, parseAbi } from "viem";
import { BASE_ADDRESSES, BASE_BASKET_ROUTER_ADDRESS } from "@/constants/contracts";
import { BASKET_PRESETS } from "@/constants/presets";
import { resolveBasketFeeTier } from "@/lib/feeTiers";

const MORPHO_BLUE_ABI = parseAbi([
  "function supplyCollateral((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, address onBehalf, bytes data) external",
  "function supply((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) external returns (uint256 assetsSupplied, uint256 sharesSupplied)",
]);

const AERODROME_ROUTER_ABI = parseAbi([
  "function addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) external returns (uint256 amountA, uint256 amountB, uint256 liquidity)",
]);

async function fetchZeroXQuote(
  sellToken: `0x${string}`,
  buyToken: `0x${string}`,
  sellAmount: bigint,
  slippageBps: number,
  taker: `0x${string}`
) {
  const params = new URLSearchParams({
    chainId: "8453",
    sellToken,
    buyToken,
    sellAmount: sellAmount.toString(),
    taker,
    slippageBps: slippageBps.toString(),
  });

  const endpoint = ["https://0x.org", "swap", "allowance-holder", "quote"].join("/");
  const res = await fetch(`${endpoint}?${params.toString()}`, {
    headers: {
      "0x-api-key": process.env.ZERO_X_API_KEY!,
      "0x-version": "v2",
    },
  });
  if (!res.ok) throw new Error(`0x Quote failed: ${await res.text()}`);
  return res.json();
}

export async function POST(req: Request) {
  try {
    const {
      presetId = "cbbtc-usdc-barbell",
      userAddress,
      usdcAmountRaw,
      slippageBps = 50,
    } = await req.json();

    const preset = BASKET_PRESETS[presetId];
    if (!preset) return NextResponse.json({ error: `Unknown preset: ${presetId}` }, { status: 400 });
    if (!userAddress || !usdcAmountRaw) {
      return NextResponse.json({ error: "Missing userAddress or usdcAmountRaw" }, { status: 400 });
    }

    const totalAmount = BigInt(usdcAmountRaw);
    const usdNotionalValue = Number(totalAmount) / 1e6;
    const feeQuote = resolveBasketFeeTier(usdNotionalValue);
    const feeAmount = (totalAmount * feeQuote.feeBps) / 10_000n;
    const netUsdc = totalAmount - feeAmount;

    const approvals: { token: `0x${string}`; spender: `0x${string}`; amount: bigint }[] = [];
    const calls: { target: `0x${string}`; value: bigint; callData: `0x${string}` }[] = [];
    let totalEthValue = 0n;
    let outputToken: `0x${string}` = "0x0000000000000000000000000000000000000000";
    let minOutputAmount = 0n;
    let sweepTokens: `0x${string}`[] = [BASE_ADDRESSES.USDC];

    if (preset.type === "BARBELL_50_50") {
      const halfForMorpho = netUsdc / 2n;
      const halfForLp = netUsdc - halfForMorpho;
      const quarterForLpAssetA = halfForLp / 2n;
      const quarterForLpUsdc = halfForLp - quarterForLpAssetA;
      const totalUsdcForAssetA = halfForMorpho + quarterForLpAssetA;

      const quoteA = await fetchZeroXQuote(
        BASE_ADDRESSES.USDC,
        preset.collateralAsset,
        totalUsdcForAssetA,
        slippageBps,
        BASE_BASKET_ROUTER_ADDRESS
      );

      const minTotalAssetAOut = BigInt(quoteA.minBuyAmount);
      const assetAForMorpho = (minTotalAssetAOut * 2n) / 3n;
      const assetAForLp = minTotalAssetAOut - assetAForMorpho;

      approvals.push({
        token: BASE_ADDRESSES.USDC,
        spender: BASE_ADDRESSES.ZERO_X_ALLOWANCE_HOLDER,
        amount: totalUsdcForAssetA,
      });
      calls.push({
        target: quoteA.transaction.to as `0x${string}`,
        value: BigInt(quoteA.transaction.value || "0"),
Use code with caution.
callData: quoteA.transaction.data as 0x${string},
});
totalEthValue += BigInt(quoteA.transaction.value || "0");
const morphoCalldata = encodeFunctionData({
abi: MORPHO_BLUE_ABI,
functionName: "supplyCollateral",
args: [preset.morphoMarket, assetAForMorpho, userAddress as 0x${string}, "0x"],
});
approvals.push({
token: preset.collateralAsset,
spender: BASE_ADDRESSES.MORPHO_BLUE,
amount: assetAForMorpho,
});
calls.push({
target: BASE_ADDRESSES.MORPHO_BLUE,
value: 0n,
callData: morphoCalldata,
});
const minAmountALp = (assetAForLp * BigInt(10_000 - slippageBps)) / 10_000n;
const minAmountBLp = (quarterForLpUsdc * BigInt(10_000 - slippageBps)) / 10_000n;
const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
const aerodromeCalldata = encodeFunctionData({
abi: AERODROME_ROUTER_ABI,
functionName: "addLiquidity",
args: [
preset.collateralAsset,
BASE_ADDRESSES.USDC,
preset.isStableLp,
assetAForLp,
quarterForLpUsdc,
minAmountALp,
minAmountBLp,
userAddress as 0x${string},
deadline,
],
});
approvals.push(
{
token: preset.collateralAsset,
spender: BASE_ADDRESSES.AERODROME_ROUTER,
amount: assetAForLp,
},
{
token: BASE_ADDRESSES.USDC,
spender: BASE_ADDRESSES.AERODROME_ROUTER,
amount: quarterForLpUsdc,
}
);
calls.push({
target: BASE_ADDRESSES.AERODROME_ROUTER,
value: 0n,
callData: aerodromeCalldata,
});
sweepTokens = [BASE_ADDRESSES.USDC, preset.collateralAsset];
}
if (preset.type === "ASYMMETRIC_80_20") {
const eightyForLending = (netUsdc * 8_000n) / 10_000n;
const twentyForGrowth = netUsdc - eightyForLending;
const morphoSupplyCalldata = encodeFunctionData({
abi: MORPHO_BLUE_ABI,
functionName: "supply",
args: [preset.lendingMarket, eightyForLending, 0n, userAddress as 0x${string}, "0x"],
});
approvals.push({
token: BASE_ADDRESSES.USDC,
spender: BASE_ADDRESSES.MORPHO_BLUE,
amount: eightyForLending,
});
calls.push({
target: BASE_ADDRESSES.MORPHO_BLUE,
value: 0n,
callData: morphoSupplyCalldata,
});
const quoteGrowth = await fetchZeroXQuote(
BASE_ADDRESSES.USDC,
preset.growthAsset,
twentyForGrowth,
slippageBps,
BASE_BASKET_ROUTER_ADDRESS
);
approvals.push({
token: BASE_ADDRESSES.USDC,
spender: BASE_ADDRESSES.ZERO_X_ALLOWANCE_HOLDER,
amount: twentyForGrowth,
});
calls.push({
target: quoteGrowth.transaction.to as 0x${string},
value: BigInt(quoteGrowth.transaction.value || "0"),
callData: quoteGrowth.transaction.data as 0x${string},
});
totalEthValue += BigInt(quoteGrowth.transaction.value || "0");
outputToken = preset.growthAsset;
minOutputAmount = BigInt(quoteGrowth.minBuyAmount);
sweepTokens = [BASE_ADDRESSES.USDC, preset.growthAsset];
}
return NextResponse.json({
presetId: preset.id,
basketName: preset.name,
strategyType: preset.type,
tier: feeQuote,
inputToken: BASE_ADDRESSES.USDC,
totalAmount: totalAmount.toString(),
feeBps: feeQuote.feeBps.toString(),
outputToken,
minOutputAmount: minOutputAmount.toString(),
approvals: approvals.map((a) => ({
token: a.token,
spender: a.spender,
amount: a.amount.toString(),
})),
calls: calls.map((c) => ({
target: c.target,
value: c.value.toString(),
callData: c.callData,
})),
sweepTokens,
ethValue: totalEthValue.toString(),
});
} catch (err: any) {
return NextResponse.json(
{ error: err.message || "Failed to generate preset quote" },
{ status: 500 }
);
}
}

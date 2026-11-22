import { NextResponse } from "next/server";
import { createPublicClient, encodeFunctionData, http, parseAbi } from "viem";
import { base } from "viem/chains";
import { BASE_ADDRESSES, BASE_BASKET_ROUTER_ADDRESS } from "@/constants/contracts";
import { BASKET_PRESETS } from "@/constants/presets";
import { resolveBasketFeeTier } from "@/lib/feeTiers";

type HexAddress = `0x${string}`;

const AERODROME_DEFAULT_FACTORY = "0x420DD381b31aEf6683db6B902084cB0FFECe40Da" as HexAddress;

const publicClient = createPublicClient({
  chain: base,
  transport: http("https://base.org"),
});

const MORPHO_BLUE_ABI = parseAbi([
  "function supplyCollateral((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, address onBehalf, bytes data) external",
  "function supply((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) external returns (uint256 assetsSupplied, uint256 sharesSupplied)",
]);

const AERODROME_ROUTER_ABI = parseAbi([
  "function getAmountsOut(uint256 amountIn, (address from, address to, bool stable, address factory)[] routes) external view returns (uint256[] amounts)",
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable, address factory)[] routes, address to, uint256 deadline) external returns (uint256[] amounts)",
  "function addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) external returns (uint256 amountA, uint256 amountB, uint256 liquidity)",
]);

function buildAerodromeRoutes(sellToken: HexAddress, buyToken: HexAddress) {
  if (buyToken.toLowerCase() === BASE_ADDRESSES.WSTETH.toLowerCase()) {
    return [
      { from: sellToken, to: BASE_ADDRESSES.WETH, stable: false, factory: AERODROME_DEFAULT_FACTORY },
      { from: BASE_ADDRESSES.WETH, to: BASE_ADDRESSES.WSTETH, stable: true, factory: AERODROME_DEFAULT_FACTORY },
    ];
  }
  return [
    { from: sellToken, to: buyToken, stable: false, factory: AERODROME_DEFAULT_FACTORY },
  ];
}

async function fetchAerodromeOnchainQuote(
  sellToken: HexAddress,
  buyToken: HexAddress,
  sellAmount: bigint,
  slippageBps: number,
  recipient: HexAddress
) {
  const routes = buildAerodromeRoutes(sellToken, buyToken);
  const amounts = await publicClient.readContract({
    address: BASE_ADDRESSES.AERODROME_ROUTER,
    abi: AERODROME_ROUTER_ABI,
    functionName: "getAmountsOut",
    args: [sellAmount, routes],
  });

  const expectedOut = amounts[amounts.length - 1];
  const minBuyAmount = (expectedOut * BigInt(10000 - slippageBps)) / BigInt("10000");
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);

  const callData = encodeFunctionData({
    abi: AERODROME_ROUTER_ABI,
    functionName: "swapExactTokensForTokens",
    args: [sellAmount, minBuyAmount, routes, recipient, deadline],
  });

  return {
    minBuyAmount,
    target: BASE_ADDRESSES.AERODROME_ROUTER,
    callData,
  };
}

export async function POST(req: Request) {
  try {
    const {
      presetId = "cbbtc-usdc-barbell",
      userAddress,
      usdcAmountRaw,
      slippageBps = 50,
      customWeights,
    } = await req.json();

    if (!userAddress || !usdcAmountRaw) {
      return NextResponse.json({ error: "Missing userAddress or usdcAmountRaw" }, { status: 400 });
    }

    const totalAmount = BigInt(usdcAmountRaw);
    const usdNotionalValue = Number(totalAmount) / 1e6;
    const feeQuote = resolveBasketFeeTier(usdNotionalValue);
    const feeAmount = (totalAmount * feeQuote.feeBps) / BigInt("10000");
    const netUsdc = totalAmount - feeAmount;

    const approvals: { token: HexAddress; spender: HexAddress; amount: bigint }[] = [];
    const calls: { target: HexAddress; value: bigint; callData: HexAddress }[] = [];
    const totalEthValue = BigInt("0");
    let outputToken: HexAddress = "0x0000000000000000000000000000000000000000";
    let minOutputAmount = BigInt("0");
    let sweepTokens: HexAddress[] = [BASE_ADDRESSES.USDC];

    if (presetId === "custom") {
      const wUsdc = Number(customWeights?.USDC || 0);
      const wCbbtc = Number(customWeights?.cbBTC || 0);
      const wWeth = Number(customWeights?.WETH || 0);
      if (wUsdc + wCbbtc + wWeth !== 100) {
        return NextResponse.json({ error: "Custom weights must total 100%" }, { status: 400 });
      }

      const usdcPart = (netUsdc * BigInt(wUsdc)) / BigInt("100");
      const cbbtcPart = (netUsdc * BigInt(wCbbtc)) / BigInt("100");
      const wethPart = netUsdc - usdcPart - cbbtcPart;

      if (usdcPart > BigInt("0")) {
        const shield = BASKET_PRESETS["asymmetric-btc-shield"];
        if (shield && shield.type === "ASYMMETRIC_80_20") {
          const morphoSupplyCalldata = encodeFunctionData({
            abi: MORPHO_BLUE_ABI,
            functionName: "supply",
            args: [shield.lendingMarket, usdcPart, BigInt("0"), userAddress as HexAddress, "0x"],
          });
          approvals.push({ token: BASE_ADDRESSES.USDC, spender: BASE_ADDRESSES.MORPHO_BLUE, amount: usdcPart });
          calls.push({ target: BASE_ADDRESSES.MORPHO_BLUE, value: BigInt("0"), callData: morphoSupplyCalldata });
        }
      }

      if (cbbtcPart > BigInt("0")) {
        const qBtc = await fetchAerodromeOnchainQuote(BASE_ADDRESSES.USDC, BASE_ADDRESSES.CBBTC, cbbtcPart, slippageBps, userAddress as HexAddress);
        approvals.push({ token: BASE_ADDRESSES.USDC, spender: BASE_ADDRESSES.AERODROME_ROUTER, amount: cbbtcPart });
        calls.push({ target: qBtc.target, value: BigInt("0"), callData: qBtc.callData });
      }

      if (wethPart > BigInt("0")) {
        const qEth = await fetchAerodromeOnchainQuote(BASE_ADDRESSES.USDC, BASE_ADDRESSES.WETH, wethPart, slippageBps, userAddress as HexAddress);
        approvals.push({ token: BASE_ADDRESSES.USDC, spender: BASE_ADDRESSES.AERODROME_ROUTER, amount: wethPart });
        calls.push({ target: qEth.target, value: BigInt("0"), callData: qEth.callData });
      }

      return NextResponse.json({
        presetId: "custom",
        basketName: "Custom Atomic Basket (" + wUsdc + "% USDC / " + wCbbtc + "% cbBTC / " + wWeth + "% WETH)",
        strategyType: "CUSTOM",
        tier: feeQuote,
        inputToken: BASE_ADDRESSES.USDC,
        totalAmount: totalAmount.toString(),
        feeBps: feeQuote.feeBps.toString(),
        outputToken,
        minOutputAmount: "0",
        approvals: approvals.map((a) => ({ token: a.token, spender: a.spender, amount: a.amount.toString() })),
        calls: calls.map((c) => ({ target: c.target, value: c.value.toString(), callData: c.callData })),
        sweepTokens: [BASE_ADDRESSES.USDC, BASE_ADDRESSES.CBBTC, BASE_ADDRESSES.WETH],
        ethValue: totalEthValue.toString(),
      });
    }

    const preset = BASKET_PRESETS[presetId];
    if (!preset) return NextResponse.json({ error: "Unknown preset: " + presetId }, { status: 400 });

    if (preset.type === "BARBELL_50_50") {
      const halfForMorpho = netUsdc / BigInt("2");
      const halfForLp = netUsdc - halfForMorpho;
      const quarterForLpAssetA = halfForLp / BigInt("2");
      const quarterForLpPair = halfForLp - quarterForLpAssetA;
      const totalUsdcForAssetA = halfForMorpho + quarterForLpAssetA;

      const quoteA = await fetchAerodromeOnchainQuote(
        BASE_ADDRESSES.USDC,
        preset.collateralAsset,
        totalUsdcForAssetA,
        slippageBps,
        BASE_BASKET_ROUTER_ADDRESS
      );

      const minTotalAssetAOut = quoteA.minBuyAmount;
      const assetAForMorpho = (minTotalAssetAOut * BigInt("2")) / BigInt("3");
      const assetAForLp = minTotalAssetAOut - assetAForMorpho;

      approvals.push({ token: BASE_ADDRESSES.USDC, spender: BASE_ADDRESSES.AERODROME_ROUTER, amount: totalUsdcForAssetA });
      calls.push({ target: quoteA.target, value: BigInt("0"), callData: quoteA.callData });

      const morphoCalldata = encodeFunctionData({
        abi: MORPHO_BLUE_ABI,
        functionName: "supplyCollateral",
        args: [preset.morphoMarket, assetAForMorpho, userAddress as HexAddress, "0x"],
      });
      approvals.push({ token: preset.collateralAsset, spender: BASE_ADDRESSES.MORPHO_BLUE, amount: assetAForMorpho });
      calls.push({ target: BASE_ADDRESSES.MORPHO_BLUE, value: BigInt("0"), callData: morphoCalldata });

      let assetBForLp = quarterForLpPair;
      if (preset.lpPairAsset !== BASE_ADDRESSES.USDC) {
        const quoteB = await fetchAerodromeOnchainQuote(
          BASE_ADDRESSES.USDC,
          preset.lpPairAsset,
          quarterForLpPair,
          slippageBps,
          BASE_BASKET_ROUTER_ADDRESS
        );
        assetBForLp = quoteB.minBuyAmount;
        approvals.push({ token: BASE_ADDRESSES.USDC, spender: BASE_ADDRESSES.AERODROME_ROUTER, amount: quarterForLpPair });
        calls.push({ target: quoteB.target, value: BigInt("0"), callData: quoteB.callData });
      }

      const minAmountALp = (assetAForLp * BigInt(10000 - slippageBps)) / BigInt("10000");
      const minAmountBLp = (assetBForLp * BigInt(10000 - slippageBps)) / BigInt("10000");
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);

      const aerodromeCalldata = encodeFunctionData({
        abi: AERODROME_ROUTER_ABI,
        functionName: "addLiquidity",
        args: [
          preset.collateralAsset,
          preset.lpPairAsset,
          preset.isStableLp,
          assetAForLp,
          assetBForLp,
          minAmountALp,
          minAmountBLp,
          userAddress as HexAddress,
          deadline,
        ],
      });

      approvals.push(
        { token: preset.collateralAsset, spender: BASE_ADDRESSES.AERODROME_ROUTER, amount: assetAForLp },
Use code with caution.
{ token: preset.lpPairAsset, spender: BASE_ADDRESSES.AERODROME_ROUTER, amount: assetBForLp }
);
calls.push({ target: BASE_ADDRESSES.AERODROME_ROUTER, value: BigInt("0"), callData: aerodromeCalldata });
sweepTokens = preset.lpPairAsset === BASE_ADDRESSES.USDC
? [BASE_ADDRESSES.USDC, preset.collateralAsset]
: [BASE_ADDRESSES.USDC, preset.collateralAsset, preset.lpPairAsset];
}
if (preset.type === "ASYMMETRIC_80_20") {
const eightyForLending = (netUsdc * BigInt("8000")) / BigInt("10000");
const twentyForGrowth = netUsdc - eightyForLending;
const morphoSupplyCalldata = encodeFunctionData({
abi: MORPHO_BLUE_ABI,
functionName: "supply",
args: [preset.lendingMarket, eightyForLending, BigInt("0"), userAddress as HexAddress, "0x"],
});
approvals.push({ token: BASE_ADDRESSES.USDC, spender: BASE_ADDRESSES.MORPHO_BLUE, amount: eightyForLending });
calls.push({ target: BASE_ADDRESSES.MORPHO_BLUE, value: BigInt("0"), callData: morphoSupplyCalldata });
const quoteGrowth = await fetchAerodromeOnchainQuote(
BASE_ADDRESSES.USDC,
preset.growthAsset,
twentyForGrowth,
slippageBps,
userAddress as HexAddress
);
approvals.push({ token: BASE_ADDRESSES.USDC, spender: BASE_ADDRESSES.AERODROME_ROUTER, amount: twentyForGrowth });
calls.push({ target: quoteGrowth.target, value: BigInt("0"), callData: quoteGrowth.callData });
outputToken = preset.growthAsset;
minOutputAmount = quoteGrowth.minBuyAmount;
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
approvals: approvals.map((a) => ({ token: a.token, spender: a.spender, amount: a.amount.toString() })),
calls: calls.map((c) => ({ target: c.target, value: c.value.toString(), callData: c.callData })),
sweepTokens,
ethValue: totalEthValue.toString(),
});
} catch (err: any) {
return NextResponse.json({ error: err.message || "Failed to generate onchain quote" }, { status: 500 });
}
}

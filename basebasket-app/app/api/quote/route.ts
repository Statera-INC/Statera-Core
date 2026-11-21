import { NextResponse } from "next/server";
import { encodeFunctionData, parseAbi } from "viem";
import { BASE_ADDRESSES, BASE_BASKET_ROUTER_ADDRESS } from "@/constants/contracts";
import { BASKET_PRESETS } from "@/constants/presets";
import { resolveBasketFeeTier } from "@/lib/feeTiers";

type HexAddress = `0x${string}`;

const MORPHO_BLUE_ABI = parseAbi([
  "function supplyCollateral((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, address onBehalf, bytes data) external",
  "function supply((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) external returns (uint256 assetsSupplied, uint256 sharesSupplied)",
]);

const AERODROME_ROUTER_ABI = parseAbi([
  "function addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) external returns (uint256 amountA, uint256 amountB, uint256 liquidity)",
]);

async function fetchZeroXQuote(
  sellToken: HexAddress,
  buyToken: HexAddress,
  sellAmount: bigint,
  slippageBps: number,
  taker: HexAddress
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
  const res = await fetch(endpoint + "?" + params.toString(), {
    headers: {
      "0x-api-key": process.env.ZERO_X_API_KEY!,
      "0x-version": "v2",
    },
  });
  if (!res.ok) throw new Error("0x Quote failed: " + (await res.text()));
  return res.json();
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
    let totalEthValue = BigInt("0");
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
        const qBtc = await fetchZeroXQuote(BASE_ADDRESSES.USDC, BASE_ADDRESSES.CBBTC, cbbtcPart, slippageBps, BASE_BASKET_ROUTER_ADDRESS);
        approvals.push({ token: BASE_ADDRESSES.USDC, spender: BASE_ADDRESSES.ZERO_X_ALLOWANCE_HOLDER, amount: cbbtcPart });
        calls.push({ target: qBtc.transaction.to as HexAddress, value: BigInt(qBtc.transaction.value || "0"), callData: qBtc.transaction.data as HexAddress });
        totalEthValue += BigInt(qBtc.transaction.value || "0");
      }

      if (wethPart > BigInt("0")) {
        const qEth = await fetchZeroXQuote(BASE_ADDRESSES.USDC, BASE_ADDRESSES.WETH, wethPart, slippageBps, BASE_BASKET_ROUTER_ADDRESS);
        approvals.push({ token: BASE_ADDRESSES.USDC, spender: BASE_ADDRESSES.ZERO_X_ALLOWANCE_HOLDER, amount: wethPart });
        calls.push({ target: qEth.transaction.to as HexAddress, value: BigInt(qEth.transaction.value || "0"), callData: qEth.transaction.data as HexAddress });
        totalEthValue += BigInt(qEth.transaction.value || "0");
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
      const assetAForMorpho = (minTotalAssetAOut * BigInt("2")) / BigInt("3");
      const assetAForLp = minTotalAssetAOut - assetAForMorpho;

      approvals.push({ token: BASE_ADDRESSES.USDC, spender: BASE_ADDRESSES.ZERO_X_ALLOWANCE_HOLDER, amount: totalUsdcForAssetA });
      calls.push({ target: quoteA.transaction.to as HexAddress, value: BigInt(quoteA.transaction.value || "0"), callData: quoteA.transaction.data as HexAddress });
      totalEthValue += BigInt(quoteA.transaction.value || "0");

      const morphoCalldata = encodeFunctionData({
        abi: MORPHO_BLUE_ABI,
        functionName: "supplyCollateral",
        args: [preset.morphoMarket, assetAForMorpho, userAddress as HexAddress, "0x"],
      });
      approvals.push({ token: preset.collateralAsset, spender: BASE_ADDRESSES.MORPHO_BLUE, amount: assetAForMorpho });
      calls.push({ target: BASE_ADDRESSES.MORPHO_BLUE, value: BigInt("0"), callData: morphoCalldata });

      let assetBForLp = quarterForLpUsdc;
      if (preset.lpPairAsset !== BASE_ADDRESSES.USDC) {
        const quoteB = await fetchZeroXQuote(
          BASE_ADDRESSES.USDC,
          preset.lpPairAsset,
          quarterForLpUsdc,
          slippageBps,
          BASE_BASKET_ROUTER_ADDRESS
        );
        assetBForLp = BigInt(quoteB.minBuyAmount);
        approvals.push({ token: BASE_ADDRESSES.USDC, spender: BASE_ADDRESSES.ZERO_X_ALLOWANCE_HOLDER, amount: quarterForLpUsdc });
        calls.push({ target: quoteB.transaction.to as HexAddress, value: BigInt(quoteB.transaction.value || "0"), callData: quoteB.transaction.data as HexAddress });
        totalEthValue += BigInt(quoteB.transaction.value || "0");
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

      const quoteGrowth = await fetchZeroXQuote(
        BASE_ADDRESSES.USDC,
        preset.growthAsset,
        twentyForGrowth,
        slippageBps,
        BASE_BASKET_ROUTER_ADDRESS
      );
      approvals.push({ token: BASE_ADDRESSES.USDC, spender: BASE_ADDRESSES.ZERO_X_ALLOWANCE_HOLDER, amount: twentyForGrowth });
      calls.push({ target: quoteGrowth.transaction.to as HexAddress, value: BigInt(quoteGrowth.transaction.value || "0"), callData: quoteGrowth.transaction.data as HexAddress });
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
approvals: approvals.map((a) => ({ token: a.token, spender: a.spender, amount: a.amount.toString() })),
calls: calls.map((c) => ({ target: c.target, value: c.value.toString(), callData: c.callData })),
sweepTokens,
ethValue: totalEthValue.toString(),
});
} catch (err: any) {
return NextResponse.json({ error: err.message || "Failed to generate preset quote" }, { status: 500 });
}
}

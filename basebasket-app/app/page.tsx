"use client";
import React, { useState, useMemo } from "react";
import { ShieldCheck, ChevronDown, ChevronUp, Sliders, Layers, ArrowUpRight, Wallet, LogOut, Sparkles } from "lucide-react";
import { parseUnits } from "viem";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { BASE_ADDRESSES, BASE_BASKET_ROUTER_ADDRESS } from "@/constants/contracts";
import { resolveBasketFeeTier } from "@/lib/feeTiers";
import { BasketOrderPreview } from "@/components/BasketOrderPreview";

const e = React.createElement;

const SUPPORTED_ASSETS = Array(
  { symbol: "USDC", name: "USD Coin (Base Mainnet)", decimals: 2, usdPrice: 1, address: BASE_ADDRESSES.USDC, quickAmounts: Array(100, 500, 2500, 10000) }
);

const CURATED_PRESETS = Array(
  {
    id: "cbbtc-usdc-barbell",
    title: "cbBTC / USDC 50/50 Barbell",
    apy: "11.4%",
    risk: "Moderate Risk",
    riskClass: "text-amber-300 bg-amber-400/10 border-amber-400/20",
    description: "50% cbBTC Morpho collateral + 50% cbBTC/USDC Aerodrome liquidity pool."
  },
  {
    id: "weth-usdc-barbell",
    title: "WETH / USDC 50/50 Barbell",
    apy: "14.2%",
    risk: "Moderate Risk",
    riskClass: "text-amber-300 bg-amber-400/10 border-amber-400/20",
    description: "50% WETH Morpho collateral + 50% WETH/USDC Aerodrome liquidity pool."
  },
  {
    id: "wsteth-weth-barbell",
    title: "wstETH / WETH 50/50 Staked Barbell",
    apy: "15.8%",
    risk: "Dual Yield",
    riskClass: "text-blue-300 bg-blue-400/10 border-blue-400/20",
    description: "50% wstETH Morpho collateral + 50% wstETH/WETH Aerodrome correlated staked pool."
  },
  {
    id: "asymmetric-btc-shield",
    title: "80/20 Asymmetric BTC Shield",
    apy: "7.8%",
    risk: "Principal Protected",
    riskClass: "text-emerald-300 bg-emerald-400/10 border-emerald-400/20",
    description: "80% USDC earning lending yield on Morpho Blue + 20% spot cbBTC upside."
  }
);

const TRUST_PILLARS = Array(
  {
    title: "100% Stateless Router",
    badge: "Router Balance: $0.00",
    copy: "BaseBasketRouter.sol never holds user funds between blocks. Assets swap, deposit, and return directly to your wallet in one atomic transaction."
  },
  {
    title: "Zero-Dust Sweeps",
    badge: "100% Capital Efficiency",
    copy: "Every wei of unspent token or ETH gas dust after swap routing and LP pairing is automatically swept back to your wallet before execution completes."
  },
  {
    title: "24h Timelocked Multisig",
    badge: "Delay: 86,400s",
    copy: "Protocol fee caps (hard-coded 150 BPS max) and whitelisted adapters are governed by a multi-signer safe behind a mandatory 24-hour public delay."
  },
  {
    title: "Tenderly Pre-Simulated",
    badge: "Simulation Active",
    copy: "Every route is simulated against live Base block state before you sign, preventing failed transactions, reverts, or unexpected slippage."
  }
);

export default function BaseBasketTerminal() {
  const { address, isConnected } = useAccount();
  const { connectors, connect } = useConnect();
  const { disconnect } = useDisconnect();

  const [activeTab, setActiveTab] = useState("presets");
  const [selectedPreset, setSelectedPreset] = useState(CURATED_PRESETS.at(0)!.id);
  const [selectedAsset, setSelectedAsset] = useState(SUPPORTED_ASSETS.at(0)!);
  const [assetDropdownOpen, setAssetDropdownOpen] = useState(false);
  const [rawAmount, setRawAmount] = useState("10000");
  const [trustExpanded, setTrustExpanded] = useState(false);
  const [showWalletMenu, setShowWalletMenu] = useState(false);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [quoteError, setQuoteError] = useState(null as string | null);
  const [quotePayload, setQuotePayload] = useState(null as any);
  const [customWeights, setCustomWeights] = useState({ USDC: 50, cbBTC: 30, WETH: 20 } as Record<string, number>);

  const handleWeightChange = (asset: string, newValue: string) => {
    const val = Math.max(0, Math.min(100, Number(newValue)));
    const remaining = 100 - val;
    const otherKeys = Object.keys(customWeights).filter((k) => k !== asset);
    const k0 = otherKeys.at(0)!;
    const k1 = otherKeys.at(1)!;
    const currentOtherSum = customWeights[k0] + customWeights[k1];
    const updated: Record<string, number> = { ...customWeights, [asset]: val };
    if (currentOtherSum === 0) {
      updated[k0] = Math.floor(remaining / 2);
      updated[k1] = remaining - updated[k0];
    } else {
      updated[k0] = Math.round((customWeights[k0] / currentOtherSum) * remaining);
      updated[k1] = remaining - updated[k0];
    }
    setCustomWeights(updated);
  };

  const numericAmount = parseFloat(rawAmount.replace(/,/g, "")) || 0;
  const usdNotional = numericAmount * selectedAsset.usdPrice;
  const feeQuote = resolveBasketFeeTier(usdNotional);
  const feeRate = Number(feeQuote.feeBps) / 10000;

  const { feeAmountStr, netRoutedStr } = useMemo(() => {
    const fee = numericAmount * feeRate;
    const net = Math.max(0, numericAmount - fee);
    return {
      feeAmountStr: fee.toLocaleString("en-US", { minimumFractionDigits: selectedAsset.decimals, maximumFractionDigits: selectedAsset.decimals }),
      netRoutedStr: net.toLocaleString("en-US", { minimumFractionDigits: selectedAsset.decimals, maximumFractionDigits: selectedAsset.decimals })
    };
  }, [numericAmount, feeRate, selectedAsset]);

  const handleReviewOrder = async () => {
    if (!isConnected || !address) { setShowWalletMenu(true); return; }
    if (numericAmount <= 0) { setQuoteError("Enter a valid deposit amount."); return; }
    setLoadingQuote(true); setQuoteError(null);
    try {
      const usdcEquivalentRaw = parseUnits(usdNotional.toFixed(6), 6).toString();
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presetId: activeTab === "presets" ? selectedPreset : "custom",
          customWeights,
          userAddress: address,
          usdcAmountRaw: usdcEquivalentRaw,
          slippageBps: 50
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to construct atomic route.");
      setQuotePayload(data);
    } catch (err: any) {
      setQuoteError(err.message || "Quote generation failed.");
    } finally {
      setLoadingQuote(false);
    }
  };

  const routerUrl = "basescan.org" + (BASE_BASKET_ROUTER_ADDRESS || "0x0000000000000000000000000000000000000000");

  return e("div", { className: "relative min-h-screen pb-16 text-black" },
    e("header", { className: "win97-window sticky top-0 z-20 mx-auto flex max-w-6xl items-center justify-between px-4 py-2.5 sm:mt-3" },
      e("div", { className: "flex items-center gap-3" },
        e("div", { className: "flex h-9 w-9 items-center justify-center border-2 border-[#111827] bg-[#C0C0C0]" },
          e("svg", { width: 28, height: 28, viewBox: "0 0 40 40", fill: "none" },
            e("line", { x1: 7, y1: 14, x2: 33, y2: 14, stroke: "#000080", strokeWidth: 3, strokeLinecap: "square" }),
            e("line", { x1: 20, y1: 14, x2: 20, y2: 28, stroke: "#111827", strokeWidth: 2.5 }),
            e("polygon", { points: "20,22 13,32 27,32", fill: "#111827" }),
            e("rect", { x: 7, y: 17, width: 7, height: 6, fill: "#111827" }),
            e("rect", { x: 26, y: 17, width: 7, height: 6, fill: "#000080" })
          )
        ),
        e("div", { className: "flex flex-wrap items-center gap-2" },
          e("span", { className: "text-base font-bold tracking-tight text-black" }, "BASEBASKET"),
          e("span", { className: "win97-sunken px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-black" }, "Statera Inc.")
        )
      ),
      e("div", { className: "flex items-center gap-3" },
        e("a", { href: routerUrl, target: "_blank", rel: "noreferrer", className: "win97-btn hidden items-center gap-1 px-3 py-1.5 text-xs font-medium text-black sm:flex" },
          "Verified Router ", e(ArrowUpRight, { className: "h-3.5 w-3.5" })
        ),
        e("div", { className: "relative" },
          isConnected && address
            ? e("button", { onClick: () => disconnect(), className: "win97-btn flex items-center gap-2 px-3.5 py-1.5 font-mono text-xs font-bold text-black" },
                e("span", { className: "h-2.5 w-2.5 border border-black bg-[#008000]" }),
                address.slice(0, 6) + "..." + address.slice(-4),
                e(LogOut, { className: "h-3.5 w-3.5 text-black" })
              )
            : e("button", { onClick: () => setShowWalletMenu(!showWalletMenu), className: "win97-btn flex items-center gap-2 px-3.5 py-1.5 font-mono text-xs font-bold text-black" },
                e(Wallet, { className: "h-3.5 w-3.5 text-[#000080]" }), " Connect Wallet"
              ),
          showWalletMenu && !isConnected && e("div", { className: "win97-window absolute right-0 z-30 mt-2 w-60 p-1.5" },
            e("div", { className: "win97-titlebar mb-1 px-2 py-1 text-[11px] font-bold" }, "Select Wallet Provider"),
            connectors.map((c) => e("button", {
              key: c.uid,
              onClick: () => { connect({ connector: c }); setShowWalletMenu(false); },
              className: "win97-btn mt-1 flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-black"
            }, e("span", null, c.name), e(ArrowUpRight, { className: "h-3.5 w-3.5 text-black" })))
          )
        )
      )
    ),
    e("main", { className: "relative z-10 mx-auto flex max-w-2xl flex-col items-center px-3 pt-5 pb-12" },
      e("div", { className: "win97-window w-full p-1" },
        e("div", { className: "win97-titlebar flex items-center justify-between px-2.5 py-1.5 text-xs font-bold" },
          e("span", { className: "flex items-center gap-2" },
            e(Layers, { className: "h-3.5 w-3.5 text-white" }),
            "BaseBasket_Terminal.exe - [Base Mainnet L2]"
          ),
          e("div", { className: "flex items-center gap-1" },
            e("span", { className: "win97-btn flex h-4 w-4 items-center justify-center text-[10px] font-bold text-black" }, "_"),
            e("span", { className: "win97-btn flex h-4 w-4 items-center justify-center text-[10px] font-bold text-black" }, "□"),
            e("span", { className: "win97-btn flex h-4 w-4 items-center justify-center text-[10px] font-bold text-black" }, "×")
          )
        ),
        e("div", { className: "flex items-center justify-center gap-2 border-b-2 border-[#808080] bg-[#C0C0C0] px-4 pt-3 pb-2.5" },
          e("button", {
            onClick: () => setActiveTab("presets"),
            className: "flex items-center gap-2 px-4 py-1.5 text-xs font-bold " + (activeTab === "presets" ? "win97-btn-pressed text-[#000080]" : "win97-btn text-black")
          }, e("svg", { width: 14, height: 14, viewBox: "0 0 40 40", fill: "none" },
            e("line", { x1: 6, y1: 14, x2: 34, y2: 14, stroke: "#000080", strokeWidth: 3.5, strokeLinecap: "square" }),
            e("line", { x1: 20, y1: 14, x2: 20, y2: 28, stroke: "#111827", strokeWidth: 3 }),
            e("polygon", { points: "20,21 12,33 28,33", fill: "#111827" }),
            e("rect", { x: 6, y: 17, width: 7, height: 6, fill: "#111827" }),
            e("rect", { x: 27, y: 17, width: 7, height: 6, fill: "#000080" })
          ), " Curated Presets"),
          e("button", {
            onClick: () => setActiveTab("custom"),
            className: "flex items-center gap-2 px-4 py-1.5 text-xs font-bold " + (activeTab === "custom" ? "win97-btn-pressed text-[#000080]" : "win97-btn text-black")
          }, e(Sliders, { className: "h-3.5 w-3.5" }), " Custom Builder")
        ),
        e("div", { className: "space-y-4 bg-[#C0C0C0] p-4 sm:p-5" },
          activeTab === "presets"
            ? e("div", { className: "space-y-2.5" },
                CURATED_PRESETS.map((preset) => {
                  const isSel = selectedPreset === preset.id;
                  return e("div", {
                    key: preset.id,
                    onClick: () => setSelectedPreset(preset.id),
                    className: "cursor-pointer p-3.5 " + (isSel ? "win97-btn-pressed bg-[#D4D4D4] outline-1 outline-dashed outline-black" : "win97-btn")
                  },
                    e("div", { className: "mb-1.5 flex flex-wrap items-center justify-between gap-2" },
                      e("span", { className: "flex items-center gap-2 text-sm font-bold text-black" },
                        e("span", { className: "inline-block h-3 w-3 border border-black " + (isSel ? "bg-[#000080]" : "bg-white") }),
                        preset.title
                      ),
                      e("div", { className: "flex items-center gap-1.5 font-mono text-[11px] font-bold" },
                        e("span", { className: "win97-sunken px-2 py-0.5 text-[#006400]" }, "Est. " + preset.apy + " APY"),
                        e("span", { className: "win97-sunken px-2 py-0.5 text-black" }, preset.risk)
                      )
                    ),
                    e("p", { className: "text-xs leading-relaxed text-[#222222]" }, preset.description)
                  );
                })
              )
            : e("div", { className: "win97-groupbox space-y-4 p-4" },
                e("div", { className: "flex items-center justify-between text-xs" },
                  e("span", { className: "font-bold text-black" }, "Auto-Balancing Allocation Sliders"),
                  e("span", { className: "win97-sunken px-2 py-0.5 font-mono font-bold text-[#006400]" }, "Total: 100%")
                ),
                Object.keys(customWeights).map((assetKey) => e("div", { key: assetKey, className: "space-y-1.5" },
                  e("div", { className: "flex justify-between font-mono text-xs" },
                    e("span", { className: "font-bold text-black" }, assetKey),
                    e("span", { className: "font-bold text-[#000080]" }, customWeights[assetKey] + "%")
                  ),
                  e("input", {
                    type: "range",
                    min: 0,
                    max: 100,
                    value: customWeights[assetKey],
                    onChange: (ev: any) => handleWeightChange(assetKey, ev.target.value),
                    className: "h-2 w-full cursor-pointer accent-[#000080]"
                  })
                ))
              ),
          e("div", { className: "win97-groupbox p-3.5" },
            e("div", { className: "flex flex-wrap items-center justify-between gap-2 text-xs text-black" },
              e("span", { className: "font-bold" }, "Deposit Asset & Amount"),
              e("div", { className: "flex flex-wrap gap-1.5 font-mono text-[10px]" },
                selectedAsset.quickAmounts.map((q) => e("button", {
                  key: q,
                  onClick: () => setRawAmount(q.toString()),
                  className: "win97-btn px-2 py-0.5 font-bold text-black"
                }, q.toLocaleString() + " " + selectedAsset.symbol))
              )
            ),
            e("div", { className: "mt-2.5 flex items-center justify-between gap-3" },
              e("input", {
type: "text",
value: rawAmount,
onChange: (ev: any) => setRawAmount(ev.target.value.replace(/[^0-9.]/g, "")),
placeholder: "0.00",
className: "win97-sunken w-full px-3 py-2 font-mono text-2xl font-bold text-black outline-none"
}),
e("div", { className: "relative" },
e("button", {
onClick: () => setAssetDropdownOpen(!assetDropdownOpen),
className: "win97-btn flex items-center gap-2 px-3.5 py-2.5 font-mono text-xs font-bold text-black"
}, selectedAsset.symbol, e(ChevronDown, { className: "h-3.5 w-3.5 text-black" })),
assetDropdownOpen && e("div", { className: "win97-window absolute right-0 z-30 mt-1 w-44 p-1" },
SUPPORTED_ASSETS.map((a) => e("button", {
key: a.symbol,
onClick: () => { setSelectedAsset(a); setRawAmount(a.quickAmounts.at(0)!.toString()); setAssetDropdownOpen(false); },
className: "win97-btn mt-0.5 flex w-full items-center justify-between px-2.5 py-1.5 text-left text-xs text-black"
}, e("span", { className: "font-bold" }, a.symbol), e("span", { className: "text-[10px] text-[#333333]" }, a.name)))
)
)
),
e("div", { className: "mt-2 font-mono text-[11px] font-medium text-[#222222]" },
"Est. Notional Value: $" + usdNotional.toLocaleString("en-US", { maximumFractionDigits: 2 }) + " USD"
)
),
e("div", { className: "win97-groupbox space-y-2 p-3.5 text-xs" },
e("div", { className: "flex items-center justify-between" },
e("span", { className: "font-bold text-black" }, "Active Volume Tier"),
e("span", { className: "win97-sunken px-2.5 py-0.5 font-mono text-[11px] font-bold text-[#000080]" },
feeQuote.tierName + " (" + feeQuote.feePercent + "%)"
)
),
e("div", { className: "flex justify-between text-black" },
e("span", null, "Protocol Routing Fee"),
e("span", { className: "font-mono font-bold text-black" }, feeAmountStr + " " + selectedAsset.symbol)
),
e("div", { className: "flex justify-between border-t border-[#808080] pt-2 font-bold" },
e("span", { className: "text-black" }, "Net Capital Routed"),
e("span", { className: "font-mono text-[#000080]" }, netRoutedStr + " " + selectedAsset.symbol)
)
),
quoteError && e("div", { className: "win97-sunken border-2 border-[#800000] bg-[#FFE4E4] p-3 text-xs font-bold text-[#800000]" }, quoteError),
e("button", {
onClick: handleReviewOrder,
disabled: loadingQuote,
className: "win97-btn flex w-full items-center justify-center gap-2 py-3 text-sm font-bold text-black active:translate-y-[1px]"
},
e(Sparkles, { className: "h-4 w-4 text-[#000080]" }),
!isConnected ? "Connect Wallet to Execute" : loadingQuote ? "Simulating Atomic Route..." : "Simulate & Execute Basket"
),
e("div", { className: "border-t-2 border-[#808080] pt-2.5" },
e("button", {
type: "button",
onClick: () => setTrustExpanded((prev) => !prev),
className: "win97-btn flex w-full cursor-pointer items-center justify-between px-3 py-2 text-xs font-bold text-black"
},
e("span", { className: "flex items-center gap-1.5" }, e(ShieldCheck, { className: "h-4 w-4 text-[#006400]" }), " Security Invariants & Audit Architecture (4 Pillars)"),
trustExpanded ? e(ChevronUp, { className: "h-4 w-4 text-black" }) : e(ChevronDown, { className: "h-4 w-4 text-black" })
),
trustExpanded ? e("div", { className: "mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2" },
TRUST_PILLARS.map((p) => e("div", { key: p.title, className: "win97-sunken p-3" },
e("div", { className: "flex items-center justify-between gap-1.5" },
e("span", { className: "text-xs font-bold text-black" }, p.title),
e("span", { className: "bg-[#000080] px-1.5 py-0.5 font-mono text-[9px] font-bold text-white" }, p.badge)
),
e("p", { className: "mt-1.5 text-[11px] leading-relaxed text-[#222222]" }, p.copy),
e("a", {
href: routerUrl,
target: "_blank",
rel: "noreferrer",
className: "mt-2 inline-flex items-center gap-1 font-mono text-[10px] font-bold text-[#000080] underline"
}, "Verify on BaseScan ", e(ArrowUpRight, { className: "h-3 w-3" }))
))
) : null
)
),
e("div", { className: "flex items-center justify-between border-t-2 border-[#808080] bg-[#C0C0C0] px-2.5 py-1 font-mono text-[10px] text-black" },
e("span", { className: "win97-sunken px-2 py-0.5" }, "Status: Non-Custodial Router Ready"),
e("span", { className: "win97-sunken px-2 py-0.5" }, "Zero-Dust Sweep Active")
)
)
),
quotePayload ? e("div", { className: "fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" },
e(BasketOrderPreview, {
basketName: quotePayload.basketName,
usdNotionalValue: usdNotional,
inputToken: BASE_ADDRESSES.USDC,
inputSymbol: "USDC",
inputDecimals: 6,
totalAmount: BigInt(quotePayload.totalAmount),
outputToken: quotePayload.outputToken,
outputSymbol: quotePayload.outputToken === BASE_ADDRESSES.CBBTC ? "cbBTC" : "USDC",
outputDecimals: quotePayload.outputToken === BASE_ADDRESSES.CBBTC ? 8 : 6,
minOutputAmount: BigInt(quotePayload.minOutputAmount),
approvals: quotePayload.approvals.map((a: any) => ({ token: a.token, spender: a.spender, amount: BigInt(a.amount) })),
calls: quotePayload.calls.map((c: any) => ({ target: c.target, value: BigInt(c.value), callData: c.callData })),
sweepTokens: quotePayload.sweepTokens,
ethValue: BigInt(quotePayload.ethValue || "0"),
onClose: () => setQuotePayload(null)
})
) : null
);
}

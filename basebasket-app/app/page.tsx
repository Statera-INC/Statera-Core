"use client";

import React, { useState } from "react";
import {
  ShieldCheck,
  Zap,
  ChevronDown,
  ChevronUp,
  Layers,
  Sliders,
  ArrowUpRight,
  Wallet,
  LogOut,
} from "lucide-react";
import { parseUnits } from "viem";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { BASE_ADDRESSES, BASE_BASKET_ROUTER_ADDRESS } from "@/constants/contracts";
import { BASKET_PRESETS } from "@/constants/presets";
import { resolveBasketFeeTier } from "@/lib/feeTiers";
import { BasketOrderPreview } from "@/components/BasketOrderPreview";

type Mode = "preset" | "custom";
type AssetAction = "spot" | "vault" | "loop";

interface CustomAllocation {
  asset: string;
  weight: number;
  action: AssetAction;
}

export default function BaseBasketTerminal() {
  const { address, isConnected } = useAccount();
  const { connectors, connect } = useConnect();
  const { disconnect } = useDisconnect();

  const [mode, setMode] = useState<Mode>("preset");
  const [selectedPresetId, setSelectedPresetId] = useState<string>("cbbtc-usdc-barbell");
  const [amount, setAmount] = useState<string>("10000");
  const [showWalletMenu, setShowWalletMenu] = useState<boolean>(false);
  const [showInvariants, setShowInvariants] = useState<boolean>(false);
  const [loadingQuote, setLoadingQuote] = useState<boolean>(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quotePayload, setQuotePayload] = useState<any | null>(null);

  const [customLegs, setCustomLegs] = useState<CustomAllocation[]>([
    { asset: "cbBTC", weight: 50, action: "loop" },
    { asset: "WETH", weight: 30, action: "vault" },
    { asset: "USDC", weight: 20, action: "spot" },
  ]);

  const numericAmount = parseFloat(amount) || 0;
  const feeQuote = resolveBasketFeeTier(numericAmount);
  const feeAmount = (numericAmount * Number(feeQuote.feeBps)) / 10000;
  const netRouted = Math.max(0, numericAmount - feeAmount);
  const activePreset = BASKET_PRESETS[selectedPresetId];

  const updateLegAction = (index: number, action: AssetAction) => {
    const updated = [...customLegs];
    updated[index].action = action;
    setCustomLegs(updated);
  };

  const handleReviewOrder = async () => {
    if (!isConnected || !address) {
      setShowWalletMenu(true);
      return;
    }
    if (numericAmount <= 0) {
      setQuoteError("Enter a valid USDC deposit amount.");
      return;
    }

    setLoadingQuote(true);
    setQuoteError(null);

    try {
      const usdcAmountRaw = parseUnits(numericAmount.toString(), 6).toString();
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presetId: selectedPresetId,
          userAddress: address,
          usdcAmountRaw,
          slippageBps: 50,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Unable to construct atomic route.");
      }
      setQuotePayload(data);
    } catch (err: any) {
      setQuoteError(err.message || "Quote generation failed.");
    } finally {
      setLoadingQuote(false);
    }
  };

  const routerExplorerUrl = [
    "https://basescan.org",
    "address",
    BASE_BASKET_ROUTER_ADDRESS || "0x0000000000000000000000000000000000000000",
  ].join("/");

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#06080d] text-slate-50 selection:bg-[#0052FF] selection:text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[540px] w-[720px] -translate-x-1/2 rounded-full bg-[#0052FF]/15 blur-[130px]" />
        <div className="absolute top-1/2 left-1/4 h-[420px] w-[420px] rounded-full bg-slate-300/[0.06] blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 h-[380px] w-[480px] rounded-full bg-[#0052FF]/10 blur-[120px]" />
      </div>

      <header className="relative z-20 mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#0052FF] to-blue-700 shadow-lg shadow-[#0052FF]/30 ring-1 ring-white/25">
            <Layers className="h-4 w-4 text-white" />
          </div>
          <div>
            <span className="text-base font-semibold tracking-tight text-slate-100">
              BASEBASKET
            </span>
            <span className="ml-2 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-400">
              Statera Inc.
            </span>
          </div>
        </div>

        <nav className="hidden items-center gap-8 text-xs font-medium tracking-wide text-slate-400 md:flex">
          <span className="text-slate-100">Execution Terminal</span>
          <a
            href={routerExplorerUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 transition hover:text-slate-200"
          >
            Verified Router <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </nav>

        <div className="relative">
          {isConnected && address ? (
            <button
              onClick={() => disconnect()}
              className="flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 font-mono text-xs font-medium text-slate-100 backdrop-blur-md transition hover:border-red-400/50 hover:bg-red-500/10"
            >
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              {address.slice(0, 6)}...{address.slice(-4)}
              <LogOut className="h-3.5 w-3.5 text-slate-400" />
            </button>
          ) : (
            <button
              onClick={() => setShowWalletMenu(!showWalletMenu)}
              className="flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 font-mono text-xs font-medium text-slate-100 backdrop-blur-md transition hover:border-[#0052FF]/60 hover:bg-[#0052FF]/20"
            >
              <Wallet className="h-3.5 w-3.5 text-[#0052FF]" />
              Connect Wallet
            </button>
          )}

          {showWalletMenu && !isConnected && (
            <div className="liquid-glass-card absolute right-0 mt-2 w-60 rounded-2xl p-2 shadow-2xl">
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Select Base Wallet / Ledger
              </div>
              {connectors.map((connector) => (
                <button
                  key={connector.uid}
                  onClick={() => {
                    connect({ connector });
                    setShowWalletMenu(false);
                  }}
                  className="mt-1 flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs font-medium text-slate-200 transition hover:bg-white/[0.08]"
                >
                  <span>{connector.name}</span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-slate-400" />
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <main className="relative z-10 mx-auto flex max-w-[540px] flex-col items-center px-4 pt-6 pb-20">
        <div className="mb-6 text-center">
          <h1 className="bg-gradient-to-b from-white via-slate-100 to-slate-400 bg-clip-text text-2xl font-semibold tracking-tight text-transparent sm:text-3xl">
            Atomic Capital Routing
          </h1>
          <p className="mt-1.5 text-xs text-slate-400 sm:text-sm">
Use code with caution.
Single-signature multi-protocol execution across 0x, Morpho Blue, and Aerodrome.

<button
onClick={() => setMode("preset")}
className={flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-medium transition ${ mode === "preset" ? "bg-white/[0.10] text-white shadow-sm ring-1 ring-white/15" : "text-slate-400 hover:text-slate-200" }}
>

Curated Presets

<button
onClick={() => setMode("custom")}
className={flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-medium transition ${ mode === "custom" ? "bg-white/[0.10] text-white shadow-sm ring-1 ring-white/15" : "text-slate-400 hover:text-slate-200" }}
>

Custom Builder

{mode === "preset" ? (


{Object.values(BASKET_PRESETS).map((preset) => {
const active = preset.id === selectedPresetId;
return (
<button
key={preset.id}
onClick={() => setSelectedPresetId(preset.id)}
className={rounded-2xl border p-3.5 text-left transition ${ active ? "border-[#0052FF]/70 bg-[#0052FF]/15 shadow-inner" : "border-white/[0.07] bg-white/[0.02] hover:border-white/15" }}
>


{preset.name}


{preset.type === "BARBELL_50_50" ? "50/50 Barbell" : "80/20 Shield"}



{preset.description}


);
})}


) : (

{customLegs.map((leg, idx) => (


{leg.asset}

{leg.weight}%



{(["spot", "vault", "loop"] as AssetAction[]).map((act) => (
<button
key={act}
onClick={() => updateLegAction(idx, act)}
className={rounded-lg px-2.5 py-1 font-mono text-[10px] uppercase transition ${ leg.action === act ? "bg-[#0052FF] text-white" : "bg-white/[0.04] text-slate-400 hover:text-slate-200" }}
>
{act}

))}


))}

)}
Deposit Amount

{["1000", "5000", "25000", "100000"].map((presetVal) => (
<button
key={presetVal}
onClick={() => setAmount(presetVal)}
className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-slate-300 transition hover:border-[#0052FF]/60 hover:text-white"
>
${Number(presetVal).toLocaleString()}

))}

<input
type="number"
value={amount}
onChange={(e) => setAmount(e.target.value)}
placeholder="0.00"
className="w-full bg-transparent font-mono text-2xl font-semibold text-white outline-none placeholder:text-slate-600"
/>


USDC


Active Volume Tier

{feeQuote.tierName} ({feeQuote.feePercent}%)



Protocol Routing Fee

${feeAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC



Net Capital Routed

${netRouted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC


{quoteError && (

{quoteError}

)}
{!isConnected
? "Connect Wallet to Route"
: loadingQuote
? "Building Atomic Route..."
: Simulate & Review ${activePreset?.name || "Basket"}}
<button
onClick={() => setShowInvariants(!showInvariants)}
className="mt-4 flex w-full items-center justify-between px-1 text-[11px] text-slate-400 transition hover:text-slate-200"
>


100% Stateless • Zero-Dust Sweeps • Tenderly Simulated

{showInvariants ? (

) : (

)}
{showInvariants && (

• Custody: 0.00 USDC held between blocks
• Approvals: Reset to 0 in same tx (forceApprove)
• Governance: 2-of-3 Safe + 24h TimelockController

)}

{quotePayload && (

<BasketOrderPreview
basketName={quotePayload.basketName}
usdNotionalValue={numericAmount}
inputToken={BASE_ADDRESSES.USDC}
inputSymbol="USDC"
inputDecimals={6}
totalAmount={BigInt(quotePayload.totalAmount)}
outputToken={quotePayload.outputToken}
outputSymbol={
quotePayload.outputToken === BASE_ADDRESSES.CBBTC ? "cbBTC" : "USDC"
}
outputDecimals={
quotePayload.outputToken === BASE_ADDRESSES.CBBTC ? 8 : 6
}
minOutputAmount={BigInt(quotePayload.minOutputAmount)}
approvals={quotePayload.approvals.map((a: any) => ({
token: a.token,
spender: a.spender,
amount: BigInt(a.amount),
}))}
calls={quotePayload.calls.map((c: any) => ({
target: c.target,
value: BigInt(c.value),
callData: c.callData,
}))}
sweepTokens={quotePayload.sweepTokens}
ethValue={BigInt(quotePayload.ethValue || "0")}
onClose={() => setQuotePayload(null)}
/>

)}

);
}

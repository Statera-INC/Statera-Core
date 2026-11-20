"use client";
import React, { useState, useEffect } from "react";
import { encodeFunctionData, formatUnits } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { BASE_BUILDER_SUFFIX } from "@/config/wagmi";
import { resolveBasketFeeTier } from "@/lib/feeTiers";
import { BASE_BASKET_ROUTER_ABI, BASE_BASKET_ROUTER_ADDRESS } from "@/constants/contracts";
interface AssetChange {
type: string;
tokenSymbol: string;
amount: string;
from: string;
to: string;
}
interface OrderPreviewProps {
basketName: string;
usdNotionalValue: number;
inputToken: 0x${string};
inputSymbol: string;
inputDecimals: number;
totalAmount: bigint;
outputToken: 0x${string};
outputSymbol: string;
outputDecimals: number;
minOutputAmount: bigint;
approvals: { token: 0x${string}; spender: 0x${string}; amount: bigint }[];
calls: { target: 0x${string}; value: bigint; callData: 0x${string} }[];
sweepTokens: 0x${string}[];
ethValue?: bigint;
onClose: () => void;
}
export function BasketOrderPreview({
basketName,
usdNotionalValue,
inputToken,
inputSymbol,
inputDecimals,
totalAmount,
outputToken,
outputSymbol,
outputDecimals,
minOutputAmount,
approvals,
calls,
sweepTokens,
ethValue = 0n,
onClose,
}: OrderPreviewProps) {
const { address } = useAccount();
const { writeContractAsync, isPending } = useWriteContract();
const [simLoading, setSimLoading] = useState(true);
const [simError, setSimError] = useState<string | null>(null);
const [assetChanges, setAssetChanges] = useState<AssetChange[]>([]);
const [gasUsed, setGasUsed] = useState<number | null>(null);
const feeQuote = resolveBasketFeeTier(usdNotionalValue);
const feeAmount = (totalAmount * feeQuote.feeBps) / 10_000n;
const netDeployed = totalAmount - feeAmount;
useEffect(() => {
if (!address) return;
const runSimulation = async () => {
setSimLoading(true);
setSimError(null);
try {
const encodedCalldata = encodeFunctionData({
abi: BASE_BASKET_ROUTER_ABI,
functionName: "executeAtomicBasket",
args: [
inputToken,
totalAmount,
feeQuote.feeBps,
outputToken,
minOutputAmount,
approvals,
calls,
sweepTokens,
],
});
const res = await fetch("/api/simulate", {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({
from: address,
to: BASE_BASKET_ROUTER_ADDRESS,
data: encodedCalldata,
value: ethValue.toString(),
}),
});
const data = await res.json();
if (!data.success) {
setSimError(data.error || "Pre-execution simulation failed.");
} else {
setAssetChanges(data.assetChanges || []);
setGasUsed(data.gasUsed || null);
}
} catch {
setSimError("Unable to reach simulation engine.");
} finally {
setSimLoading(false);
}
};
runSimulation();
}, [address, inputToken, totalAmount, feeQuote.feeBps, outputToken, minOutputAmount, approvals, calls, sweepTokens, ethValue]);
const handleConfirmExecute = async () => {
await writeContractAsync({
address: BASE_BASKET_ROUTER_ADDRESS,
abi: BASE_BASKET_ROUTER_ABI,
functionName: "executeAtomicBasket",
args: [
inputToken,
totalAmount,
feeQuote.feeBps,
outputToken,
minOutputAmount,
approvals,
calls,
sweepTokens,
],
value: ethValue,
dataSuffix: BASE_BUILDER_SUFFIX,
});
};
return (




Pre-Execution Order Review

{basketName}


{feeQuote.tierName} Tier ({feeQuote.feePercent}% Fee)

Total Input

{formatUnits(totalAmount, inputDecimals)} {inputSymbol}



Protocol Fee ({feeQuote.feePercent}%)

-{formatUnits(feeAmount, inputDecimals)} {inputSymbol}



Net Capital Routed

{formatUnits(netDeployed, inputDecimals)} {inputSymbol}



Onchain Slippage Floor

≥ {formatUnits(minOutputAmount, outputDecimals)} {outputSymbol}


Onchain Execution Simulation

{gasUsed && (

Est. Gas: {gasUsed.toLocaleString()}

)}

{simLoading ? (
Simulating atomic calls on Base Mainnet...
) : simError ? (

Simulation Reverted: {simError}

) : (

{assetChanges.length === 0 ? (
Simulation passed with zero revert flags.
) : (
assetChanges.map((item, idx) => {
const isIncoming = item.to?.toLowerCase() === address?.toLowerCase();
return (


{isIncoming ? "Receive to Wallet" : "Send from Wallet"}

<span className={font-mono font-medium ${isIncoming ? "text-emerald-400" : "text-slate-200"}}>
{isIncoming ? "+" : "-"}{item.amount} {item.tokenSymbol}


);
})
)}

)}
100% Non-Custodial: Positions mint directly to{" "}

{address ? ${address.slice(0, 6)}...${address.slice(-4)} : "your wallet"}
. Zero funds or approvals remain on BaseBasketRouter after execution.
Cancel

<button
onClick={handleConfirmExecute}
disabled={simLoading || !!simError || isPending}
className="w-2/3 rounded-xl bg-[#0052FF] py-3 text-sm font-semibold text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
>
{isPending ? "Confirm in Wallet / Ledger..." : "Sign & Execute Basket"}



);
}

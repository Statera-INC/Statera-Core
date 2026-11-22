"use client";
import React, { useState, useEffect } from "react";
import { encodeFunctionData, formatUnits, erc20Abi } from "viem";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from "wagmi";
import { base } from "wagmi/chains";
import { BASE_BUILDER_SUFFIX } from "@/config/wagmi";
import { resolveBasketFeeTier } from "@/lib/feeTiers";
import { BASE_BASKET_ROUTER_ABI, BASE_BASKET_ROUTER_ADDRESS } from "@/constants/contracts";

const e = React.createElement;

export function BasketOrderPreview(props: any) {
  const {
    basketName, usdNotionalValue, inputToken, inputSymbol, inputDecimals,
    totalAmount, outputToken, outputSymbol, outputDecimals, minOutputAmount,
    approvals, calls, sweepTokens, ethValue = BigInt("0"), onClose
  } = props;

  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();

  const [simLoading, setSimLoading] = useState(true);
  const [simError, setSimError] = useState(null as string | null);
  const [txError, setTxError] = useState(null as string | null);
  const [assetChanges, setAssetChanges] = useState([] as any[]);
  const [gasUsed, setGasUsed] = useState(null as number | null);
  const [approveTxHash, setApproveTxHash] = useState(undefined as `0x${string}` | undefined);
  const [execTxHash, setExecTxHash] = useState(undefined as `0x${string}` | undefined);

  const routerDeployed =
    !!BASE_BASKET_ROUTER_ADDRESS &&
    BASE_BASKET_ROUTER_ADDRESS !== "0x0000000000000000000000000000000000000000";

  const { data: currentAllowance, refetch: refetchAllowance } = useReadContract({
    address: inputToken,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && routerDeployed ? [address, BASE_BASKET_ROUTER_ADDRESS] : undefined,
    chainId: base.id,
    query: { enabled: !!address && routerDeployed },
  });

  const { isLoading: waitingApprove, isSuccess: approveConfirmed } = useWaitForTransactionReceipt({
    hash: approveTxHash,
    chainId: base.id,
  });

  const { isLoading: waitingExec, isSuccess: execConfirmed } = useWaitForTransactionReceipt({
    hash: execTxHash,
    chainId: base.id,
  });

  useEffect(() => {
    if (approveConfirmed) refetchAllowance();
  }, [approveConfirmed, refetchAllowance]);

  const needsApproval =
    routerDeployed &&
    (currentAllowance === undefined || (currentAllowance as bigint) < (totalAmount as bigint));

  const feeQuote = resolveBasketFeeTier(usdNotionalValue);
  const feeAmount = (totalAmount * feeQuote.feeBps) / BigInt("10000");
  const netDeployed = totalAmount - feeAmount;

  useEffect(() => {
    if (!address) return;
    if (!routerDeployed) {
      setSimLoading(false);
      setSimError("Router address not configured yet. Deploy BaseBasketRouter.sol and set NEXT_PUBLIC_ROUTER_ADDRESS in .env.local.");
      return;
    }
    const runSimulation = async () => {
      setSimLoading(true);
      setSimError(null);
      try {
        const encodedCalldata = encodeFunctionData({
          abi: BASE_BASKET_ROUTER_ABI,
          functionName: "executeAtomicBasket",
          args: [{ inputToken, totalAmount, feeBps: feeQuote.feeBps, outputToken, minOutputAmount }, approvals, calls, sweepTokens],
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
  }, [address, routerDeployed, inputToken, totalAmount, feeQuote.feeBps, outputToken, minOutputAmount, approvals, calls, sweepTokens, ethValue]);

  const ensureBaseMainnet = async () => {
    if (chainId !== base.id && switchChainAsync) {
      await switchChainAsync({ chainId: base.id });
    }
  };

  const handleApprove = async () => {
    try {
      setTxError(null);
      await ensureBaseMainnet();
      const hash = await writeContractAsync({
        address: inputToken,
        abi: erc20Abi,
        functionName: "approve",
        args: [BASE_BASKET_ROUTER_ADDRESS, totalAmount],
        chainId: base.id,
      });
      setApproveTxHash(hash);
    } catch (err: any) {
      setTxError(err?.shortMessage || err?.message || "Token approval rejected.");
    }
  };

  const handleConfirmExecute = async () => {
    try {
      setTxError(null);
      await ensureBaseMainnet();
      const hash = await writeContractAsync({
        address: BASE_BASKET_ROUTER_ADDRESS,
        abi: BASE_BASKET_ROUTER_ABI,
        functionName: "executeAtomicBasket",
        args: [{ inputToken, totalAmount, feeBps: feeQuote.feeBps, outputToken, minOutputAmount }, approvals, calls, sweepTokens],
        value: ethValue,
        dataSuffix: BASE_BUILDER_SUFFIX,
        chainId: base.id,
      });
      setExecTxHash(hash);
    } catch (err: any) {
      setTxError(err?.shortMessage || err?.message || "Execution rejected.");
    }
  };

  const busy = isPending || waitingApprove || waitingExec;

  return e("div", { className: "win97-window w-full max-w-lg p-1 text-black" },
    e("div", { className: "win97-titlebar flex items-center justify-between px-2.5 py-1.5 text-xs font-bold" },
      e("span", null, "Execute_Order.exe - [Base Mainnet ID: 8453]"),
      e("button", { onClick: onClose, className: "win97-btn flex h-4 w-4 items-center justify-center text-[10px] font-bold text-black" }, "×")
    ),
    e("div", { className: "space-y-3 bg-[#C0C0C0] p-4" },
      e("div", { className: "flex flex-wrap items-center justify-between gap-2 border-b-2 border-[#808080] pb-2.5" },
        e("div", null,
          e("div", { className: "font-mono text-[10px] font-bold uppercase text-[#000080]" }, "Pre-Execution Order Review"),
          e("h3", { className: "text-base font-bold text-black" }, basketName)
        ),
        e("span", { className: "win97-sunken px-2.5 py-0.5 font-mono text-[11px] font-bold text-[#000080]" },
          feeQuote.tierName + " (" + feeQuote.feePercent + "% Fee)"
        )
      ),
      e("div", { className: "win97-groupbox space-y-1.5 p-3 text-xs" },
        e("div", { className: "flex justify-between" },
          e("span", null, "Total Input"),
          e("span", { className: "font-mono font-bold text-black" }, formatUnits(totalAmount, inputDecimals) + " " + inputSymbol)
        ),
        e("div", { className: "flex justify-between" },
          e("span", null, "Protocol Fee (" + feeQuote.feePercent + "%)"),
e("span", { className: "font-mono text-[#222222]" }, "-" + formatUnits(feeAmount, inputDecimals) + " " + inputSymbol)
),
e("div", { className: "flex justify-between border-t border-[#808080] pt-1.5 font-bold" },
e("span", null, "Net Capital Routed"),
e("span", { className: "font-mono text-[#000080]" }, formatUnits(netDeployed, inputDecimals) + " " + inputSymbol)
),
e("div", { className: "flex justify-between" },
e("span", null, "Onchain Slippage Floor"),
e("span", { className: "font-mono font-bold text-[#006400]" }, ">= " + formatUnits(minOutputAmount, outputDecimals) + " " + outputSymbol)
)
),
e("div", { className: "win97-groupbox p-3" },
e("div", { className: "flex items-center justify-between" },
e("span", { className: "font-mono text-[11px] font-bold uppercase text-black" }, "Onchain Execution Simulation"),
gasUsed && e("span", { className: "font-mono text-[11px] text-[#222222]" }, "Est. Gas: " + gasUsed.toLocaleString())
),
simLoading
? e("p", { className: "mt-2 font-mono text-xs text-[#222222]" }, "Simulating atomic calls on Base Mainnet...")
: simError
? e("div", { className: "win97-sunken mt-2 border-2 border-[#800000] bg-[#FFE4E4] p-2.5 text-xs font-bold text-[#800000]" }, simError)
: e("div", { className: "mt-2 space-y-1.5" },
assetChanges.length === 0
? e("p", { className: "font-mono text-xs font-bold text-[#006400]" }, "Simulation passed with zero revert flags.")
: assetChanges.map((item: any, idx: number) => {
const isIncoming = item.to && address && item.to.toLowerCase() === address.toLowerCase();
return e("div", { key: idx, className: "flex items-center justify-between font-mono text-xs" },
e("span", null, isIncoming ? "Receive to Wallet" : "Send from Wallet"),
e("span", { className: "font-bold " + (isIncoming ? "text-[#006400]" : "text-black") },
(isIncoming ? "+" : "-") + item.amount + " " + item.tokenSymbol
)
);
})
)
),
txError && e("div", { className: "win97-sunken border-2 border-[#800000] bg-[#FFE4E4] p-2.5 text-xs font-bold text-[#800000]" }, txError),
execConfirmed && execTxHash && e("div", { className: "win97-sunken border-2 border-[#006400] bg-[#E6FFE6] p-3 text-xs font-bold text-[#006400]" },
"Atomic Basket Executed on Base Mainnet! ",
e("a", {
href: "basescan.org" + execTxHash,
target: "_blank",
rel: "noreferrer",
className: "underline text-[#000080]"
}, "View on BaseScan →")
),
e("p", { className: "text-[11px] leading-relaxed text-[#222222]" },
"100% Non-Custodial: Positions mint directly to ",
e("span", { className: "font-mono font-bold text-black" }, address ? address.slice(0, 6) + "..." + address.slice(-4) : "your wallet"),
". Builder Attribution: bc_uqmcppys."
),
e("div", { className: "flex gap-2.5 pt-1" },
e("button", { onClick: onClose, className: "win97-btn w-1/3 py-2.5 text-xs font-bold text-black" }, execConfirmed ? "Close" : "Cancel"),
needsApproval
? e("button", {
onClick: handleApprove,
disabled: !routerDeployed || busy,
className: "win97-btn w-2/3 py-2.5 text-xs font-bold text-[#000080] disabled:opacity-50"
}, waitingApprove ? "Confirming Approval..." : isPending ? "Approve in Wallet..." : "Step 1: Approve " + inputSymbol)
: e("button", {
onClick: handleConfirmExecute,
disabled: !routerDeployed || simLoading || !!simError || busy || execConfirmed,
className: "win97-btn w-2/3 py-2.5 text-xs font-bold text-black disabled:opacity-50"
}, execConfirmed ? "Executed ✓" : waitingExec ? "Confirming on Base..." : isPending ? "Sign in Wallet..." : "Step 2: Sign & Execute Basket")
)
)
);
}

export const BASE_BASKET_ROUTER_ADDRESS =
  process.env.NEXT_PUBLIC_ROUTER_ADDRESS as `0x${string}`;

export const BASE_ADDRESSES = {
  MORPHO_BLUE: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb" as `0x${string}`,
  AERODROME_ROUTER: "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43" as `0x${string}`,
  AERODROME_SLIPSTREAM_ROUTER: "0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5" as `0x${string}`,
  AERODROME_POSITION_MANAGER: "0x827922686190790b37229fd06084350E74485b72" as `0x${string}`,
  ZERO_X_ALLOWANCE_HOLDER: "0x0000000000001fF3684f28c67538d4D072C22734" as `0x${string}`,
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as `0x${string}`,
  CBBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" as `0x${string}`,
  WETH: "0x4200000000000000000000000000000000000006" as `0x${string}`,
  WSTETH: "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452" as `0x${string}`,
} as const;

export const BASE_BASKET_ROUTER_ABI = [
  {
    type: "function",
    name: "executeAtomicBasket",
    stateMutability: "payable",
    inputs: [
      {
        name: "order",
        type: "tuple",
        components: [
          { name: "inputToken", type: "address" },
          { name: "totalAmount", type: "uint256" },
          { name: "feeBps", type: "uint256" },
          { name: "outputToken", type: "address" },
          { name: "minOutputAmount", type: "uint256" },
        ],
      },
      {
        name: "approvals",
        type: "tuple[]",
        components: [
          { name: "token", type: "address" },
          { name: "spender", type: "address" },
          { name: "amount", type: "uint256" },
        ],
      },
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "callData", type: "bytes" },
        ],
      },
      { name: "sweepTokens", type: "address[]" },
    ],
    outputs: [],
  },
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "ZeroAmount", inputs: [] },
  {
    type: "error",
    name: "FeeExceedsTierCap",
    inputs: [
      { name: "providedBps", type: "uint256" },
      { name: "maxAllowedBps", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "TargetNotWhitelisted",
    inputs: [{ name: "target", type: "address" }],
  },
  {
    type: "error",
    name: "SlippageCheckFailed",
    inputs: [
      { name: "received", type: "uint256" },
      { name: "minimum", type: "uint256" },
    ],
  },
  { type: "error", name: "EthRefundFailed", inputs: [] },
] as const;

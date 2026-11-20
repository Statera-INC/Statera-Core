import { http, createConfig } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";
import { Attribution } from "ox/erc8021";

export const BASE_BUILDER_SUFFIX = Attribution.toDataSuffix({
  codes: ["bc_YOUR_BUILDER_CODE"],
});

export const wagmiConfig = createConfig({
  chains: [base, baseSepolia],
  connectors: [
    coinbaseWallet({ appName: "BaseBasket by Statera Inc.", preference: "all" }),
    injected({ target: "metaMask" }),
    walletConnect({
      projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID!,
      metadata: {
        name: "BaseBasket",
        description: "Non-custodial atomic DeFi execution router on Base",
        url: "https://basebasket.xyz",
        icons: ["https://basebasket.xyz"],
      },
    }),
  ],
  transports: {
    [base.id]: http(),
    [baseSepolia.id]: http(),
  },
});

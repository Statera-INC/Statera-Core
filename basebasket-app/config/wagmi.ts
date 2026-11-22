import { http, createConfig } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";
import { Attribution } from "ox/erc8021";

export const BASE_BUILDER_SUFFIX = Attribution.toDataSuffix({
  codes: ["bc_uqmcppys"],
});

const wcId = process.env.NEXT_PUBLIC_WC_PROJECT_ID;
const hasValidWc = wcId && wcId !== "your_walletconnect_project_id";

export const wagmiConfig = createConfig({
  chains: [base, baseSepolia],
  connectors: [
    coinbaseWallet({ appName: "BaseBasket by Statera Inc.", preference: "all" }),
    injected({ target: "metaMask" }),
    ...(hasValidWc ? [walletConnect({ projectId: wcId })] : []),
  ],
  transports: {
    [base.id]: http(),
    [baseSepolia.id]: http(),
  },
});

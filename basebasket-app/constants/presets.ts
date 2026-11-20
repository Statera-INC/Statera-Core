import { BASE_ADDRESSES } from "./contracts";

export interface MorphoMarketConfig {
  loanToken: `0x${string}`;
  collateralToken: `0x${string}`;
  oracle: `0x${string}`;
  irm: `0x${string}`;
  lltv: bigint;
}

export type PresetStrategy =
  | {
      type: "BARBELL_50_50";
      id: string;
      name: string;
      description: string;
      collateralAsset: `0x${string}`;
      morphoMarket: MorphoMarketConfig;
      lpPairAsset: `0x${string}`;
      isStableLp: boolean;
    }
  | {
      type: "ASYMMETRIC_80_20";
      id: string;
      name: string;
      description: string;
      lendingMarket: MorphoMarketConfig;
      growthAsset: `0x${string}`;
    };

export const BASKET_PRESETS: Record<string, PresetStrategy> = {
  "cbbtc-usdc-barbell": {
    type: "BARBELL_50_50",
    id: "cbbtc-usdc-barbell",
    name: "cbBTC / USDC 50/50 Barbell",
    description: "50% cbBTC Morpho collateral + 50% cbBTC/USDC Aerodrome liquidity pool.",
    collateralAsset: BASE_ADDRESSES.CBBTC,
    morphoMarket: {
      loanToken: BASE_ADDRESSES.USDC,
      collateralToken: BASE_ADDRESSES.CBBTC,
      oracle: "0x663BECd10daE6C4A3Dcd89F1d76c1174199639B9",
      irm: "0x46415998764C29aB2a25CbeA6254146D50D22687",
      lltv: 860000000000000000n,
    },
    lpPairAsset: BASE_ADDRESSES.USDC,
    isStableLp: false,
  },
  "weth-usdc-barbell": {
    type: "BARBELL_50_50",
    id: "weth-usdc-barbell",
    name: "WETH / USDC 50/50 Barbell",
    description: "50% WETH Morpho collateral + 50% WETH/USDC Aerodrome liquidity pool.",
    collateralAsset: BASE_ADDRESSES.WETH,
    morphoMarket: {
      loanToken: BASE_ADDRESSES.USDC,
      collateralToken: BASE_ADDRESSES.WETH,
      oracle: "0xFEa2D58cEfCb9fcb597723c6bAE66fFE4193aFE4",
      irm: "0x46415998764C29aB2a25CbeA6254146D50D22687",
      lltv: 860000000000000000n,
    },
    lpPairAsset: BASE_ADDRESSES.USDC,
    isStableLp: false,
  },
  "asymmetric-btc-shield": {
    type: "ASYMMETRIC_80_20",
    id: "asymmetric-btc-shield",
    name: "80/20 Asymmetric BTC Shield",
    description: "80% USDC earning lending yield on Morpho Blue + 20% spot cbBTC upside.",
    lendingMarket: {
      loanToken: BASE_ADDRESSES.USDC,
      collateralToken: BASE_ADDRESSES.CBBTC,
      oracle: "0x663BECd10daE6C4A3Dcd89F1d76c1174199639B9",
      irm: "0x46415998764C29aB2a25CbeA6254146D50D22687",
      lltv: 860000000000000000n,
    },
    growthAsset: BASE_ADDRESSES.CBBTC,
  },
};

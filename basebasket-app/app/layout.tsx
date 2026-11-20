import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "BaseBasket Terminal | Statera Inc.",
  description:
    "Stateless, non-custodial atomic portfolio execution router on Base L2 across 0x, Morpho Blue, and Aerodrome.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

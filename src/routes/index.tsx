import { useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { createFileRoute } from "@tanstack/react-router";
import { Sparkles, Shield, Zap } from "lucide-react";
import { ClientOnly } from "@tanstack/react-router";
import { Web3Providers } from "@/components/Web3Providers";
import { OctraWalletCard } from "@/components/OctraWalletCard";
import { BridgeForm } from "@/components/BridgeForm";
import { DonationCard } from "@/components/DonationCard";
import { Toaster } from "@/components/ui/sonner";
import type { OctraBalance } from "@/lib/bridge/octra";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Octra → Ethereum Bridge — 0% Fee" },
      {
        name: "description",
        content:
          "Free, fully client-side bridge from Octra to Ethereum. No middleman, no fees — just gas. Sign with your own wallet.",
      },
      { property: "og:title", content: "Octra → Ethereum Bridge — 0% Fee" },
      {
        property: "og:description",
        content: "Free client-side OCT → wOCT bridge. No fees, no router.",
      },
    ],
  }),
});

function BridgeApp() {
  const [octraPk, setOctraPk] = useState("");
  const [octraBalance, setOctraBalance] = useState<OctraBalance | null>(null);

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/50 backdrop-blur-md bg-background/40 sticky top-0 z-40">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-gradient-primary flex items-center justify-center glow">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-bold text-base sm:text-lg leading-tight">
                Octra Bridge
              </h1>
              <p className="text-[10px] uppercase tracking-wider text-success font-semibold">
                0% Fee · Client-side
              </p>
            </div>
          </div>
          <ConnectButton
            accountStatus={{ smallScreen: "avatar", largeScreen: "full" }}
            chainStatus="icon"
            showBalance={{ smallScreen: false, largeScreen: true }}
          />
        </div>
      </header>

      <main className="container mx-auto px-4 py-10 max-w-2xl space-y-6">
        <section className="text-center space-y-3 mb-8">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Bridge <span className="text-gradient">OCT → Ethereum</span>
          </h2>
          <p className="text-muted-foreground max-w-lg mx-auto">
            Direct bridge with no router and no fees. Your keys stay in your browser;
            you sign Ethereum transactions yourself.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 pt-2 text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Shield className="h-3.5 w-3.5 text-primary" /> Non-custodial
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Zap className="h-3.5 w-3.5 text-primary" /> ~1 minute
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" /> 0% fees
            </span>
          </div>
        </section>

        <OctraWalletCard
          pk={octraPk}
          onPkChange={setOctraPk}
          onBalanceChange={setOctraBalance}
        />

        <BridgeForm octraPk={octraPk} octraBalance={octraBalance} />

        <DonationCard />

        <footer className="text-center text-xs text-muted-foreground pt-6 pb-4">
          Built for the community · Verify the contract:{" "}
          <a
            href="https://etherscan.io/address/0xe7ed69b852fd2a1406080b26a37e8e04e7da4cae"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            EthereumBridge
          </a>
        </footer>
      </main>
      <Toaster />
    </div>
  );
}

function Index() {
  return (
    <ClientOnly fallback={<div className="min-h-screen" />}>
      <Web3Providers>
        <BridgeApp />
      </Web3Providers>
    </ClientOnly>
  );
}

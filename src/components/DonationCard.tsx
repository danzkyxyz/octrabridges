import { Heart, Copy, Check } from "lucide-react";
import { useState } from "react";
import { useAccount, useSendTransaction } from "wagmi";
import { parseEther } from "viem";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DONATION_ADDRESS } from "@/lib/bridge/constants";
import { toast } from "sonner";

const PRESETS = ["0.001", "0.005", "0.01", "0.05"] as const;

export function DonationCard() {
  const { isConnected } = useAccount();
  const [copied, setCopied] = useState(false);
  const { sendTransactionAsync, isPending } = useSendTransaction();
  const [activeAmount, setActiveAmount] = useState<string | null>(null);

  const copy = async () => {
    await navigator.clipboard.writeText(DONATION_ADDRESS);
    setCopied(true);
    toast.success("Address copied!");
    setTimeout(() => setCopied(false), 1800);
  };

  const donate = async (amount: string) => {
    if (!isConnected) {
      toast.error("Connect your wallet first");
      return;
    }
    setActiveAmount(amount);
    try {
      const hash = await sendTransactionAsync({
        to: DONATION_ADDRESS,
        value: parseEther(amount),
      });
      toast.success(`Donation sent! TX: ${hash.slice(0, 10)}…`);
    } catch (e) {
      const msg = (e as Error).message;
      if (!msg.toLowerCase().includes("reject"))
        toast.error("Donation failed");
    } finally {
      setActiveAmount(null);
    }
  };

  return (
    <Card className="glass-card p-6 space-y-4 border-primary/20">
      <div className="flex items-center gap-2">
        <Heart className="h-5 w-5 text-primary" fill="currentColor" />
        <h3 className="text-lg font-semibold">Support this free bridge</h3>
      </div>
      <p className="text-sm text-muted-foreground">
        This bridge charges <span className="text-success font-semibold">0% fees</span>.
        If it helped you, consider a small ETH tip — it keeps the project alive.
      </p>

      <div className="rounded-lg border border-border bg-muted/40 p-3 flex items-center justify-between gap-2">
        <code className="text-xs sm:text-sm font-mono break-all">
          {DONATION_ADDRESS}
        </code>
        <Button
          size="icon"
          variant="ghost"
          onClick={copy}
          className="shrink-0"
          aria-label="Copy address"
        >
          {copied ? (
            <Check className="h-4 w-4 text-success" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {PRESETS.map((amt) => (
          <Button
            key={amt}
            variant="outline"
            disabled={isPending}
            onClick={() => donate(amt)}
            className="border-primary/30 hover:border-primary hover:bg-primary/10"
          >
            {isPending && activeAmount === amt
              ? "…"
              : `${amt} ETH`}
          </Button>
        ))}
      </div>
    </Card>
  );
}

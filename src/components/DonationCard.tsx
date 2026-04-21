import { Heart, Copy, Check } from "lucide-react";
import { useState } from "react";
import { useAccount, useSendTransaction, useWriteContract } from "wagmi";
import { parseEther, parseUnits } from "viem";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DONATION_ADDRESS, WOCT_TOKEN, OCT_DECIMALS } from "@/lib/bridge/constants";
import { ERC20_ABI } from "@/lib/bridge/abi";
import { toast } from "sonner";

type Token = "ETH" | "wOCT";

export function DonationCard() {
  const { isConnected } = useAccount();
  const [copied, setCopied] = useState(false);
  const [token, setToken] = useState<Token>("ETH");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();

  const copy = async () => {
    await navigator.clipboard.writeText(DONATION_ADDRESS);
    setCopied(true);
    toast.success("Address copied!");
    setTimeout(() => setCopied(false), 1800);
  };

  const isValidAmount = (() => {
    if (!amount) return false;
    const n = Number(amount);
    return Number.isFinite(n) && n > 0;
  })();

  const donate = async () => {
    if (!isConnected) {
      toast.error("Connect your wallet first");
      return;
    }
    if (!isValidAmount) {
      toast.error("Enter a valid amount");
      return;
    }
    setSending(true);
    try {
      let hash: `0x${string}`;
      if (token === "ETH") {
        hash = await sendTransactionAsync({
          to: DONATION_ADDRESS,
          value: parseEther(amount),
        });
      } else {
        hash = await writeContractAsync({
          address: WOCT_TOKEN,
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [DONATION_ADDRESS, parseUnits(amount, OCT_DECIMALS)],
        });
      }
      toast.success(`Donation sent! TX: ${hash.slice(0, 10)}…`);
      setAmount("");
    } catch (e) {
      const msg = (e as Error).message;
      if (!msg.toLowerCase().includes("reject"))
        toast.error("Donation failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="glass-card p-6 space-y-4 border-primary/20">
      <div className="flex items-center gap-2">
        <Heart className="h-5 w-5 text-primary" fill="currentColor" />
        <h3 className="text-lg font-semibold">Support this free bridge</h3>
      </div>
      <p className="text-sm text-muted-foreground">
        This bridge charges{" "}
        <span className="text-success font-semibold">0% fees</span>. If it
        helped you, consider a small tip — it keeps the project alive.
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

      <div className="grid grid-cols-[120px_1fr] gap-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Token</Label>
          <Select value={token} onValueChange={(v) => setToken(v as Token)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ETH">ETH</SelectItem>
              <SelectItem value="wOCT">wOCT</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Amount</Label>
          <Input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            placeholder={token === "ETH" ? "0.01" : "1.0"}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
      </div>

      <Button
        onClick={donate}
        disabled={sending || !isValidAmount}
        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
      >
        {sending
          ? "Sending…"
          : `Donate${isValidAmount ? ` ${amount} ${token}` : ""}`}
      </Button>
    </Card>
  );
}

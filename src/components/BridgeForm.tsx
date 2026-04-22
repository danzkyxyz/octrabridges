import { useMemo, useState } from "react";
import { ArrowDownUp, Loader2, ExternalLink, AlertCircle, CheckCircle2 } from "lucide-react";
import { useAccount } from "wagmi";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useBridge } from "@/lib/bridge/useBridge";
import { OCT_UNIT, OCTRA_FEE_RESERVE } from "@/lib/bridge/constants";
import type { OctraBalance } from "@/lib/bridge/octra";

interface Props {
  octraPk: string;
  octraBalance: OctraBalance | null;
}

const STAGE_PROGRESS: Record<string, number> = {
  idle: 0,
  lock: 12,
  confirming: 28,
  finding: 42,
  waiting_eth: 60,
  proof: 75,
  minting: 85,
  submitting: 92,
  done: 100,
  error: 0,
};

export function BridgeForm({ octraPk, octraBalance }: Props) {
  const { address, isConnected } = useAccount();
  const [amount, setAmount] = useState("");
  const { state, run, reset } = useBridge();

  const maxOct = useMemo(() => {
    if (!octraBalance) return 0;
    const max = octraBalance.balance_raw - OCTRA_FEE_RESERVE;
    return max > 0n ? Number(max) / 1e6 : 0;
  }, [octraBalance]);

  const amountRaw = useMemo(() => {
    const n = parseFloat(amount);
    if (!isFinite(n) || n <= 0) return 0n;
    return BigInt(Math.floor(n * 1e6));
  }, [amount]);

  const validation = useMemo(() => {
    if (!isConnected) return "Connect your Ethereum wallet";
    if (!octraPk.trim()) return "Enter your Octra private key";
    if (!octraBalance) return "Loading Octra balance…";
    if (amountRaw < 100n) return "Minimum 0.0001 OCT";
    if (amountRaw > octraBalance.balance_raw - OCTRA_FEE_RESERVE)
      return "Amount exceeds available balance";
    return null;
  }, [isConnected, octraPk, octraBalance, amountRaw]);

  const isRunning =
    state.stage !== "idle" && state.stage !== "done" && state.stage !== "error";

  const handleBridge = async () => {
    if (!address || validation) return;
    try {
      await run({
        octraPk: octraPk.trim(),
        amountRaw,
        ethRecipient: address,
      });
    } catch {
      /* state already shows error */
    }
  };

  return (
    <Card className="glass-card p-6 space-y-5">
      <div className="flex items-center gap-2">
        <ArrowDownUp className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold">Bridge OCT → wOCT (Ethereum)</h3>
        <span className="ml-auto text-xs px-2 py-1 rounded-full bg-success/15 text-success font-semibold">
          0% FEE
        </span>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="amount">Amount</Label>
          {octraBalance && (
            <button
              type="button"
              onClick={() => setAmount(maxOct.toString())}
              className="text-xs text-primary hover:underline"
            >
              Max: {maxOct.toFixed(6)} OCT
            </button>
          )}
        </div>
        <div className="relative">
          <Input
            id="amount"
            type="number"
            inputMode="decimal"
            min="0.0001"
            step="0.0001"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            disabled={isRunning}
            className="pr-16 text-lg font-mono"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
            OCT
          </span>
        </div>
        {amountRaw > 0n && (
          <p className="text-xs text-muted-foreground">
            You will receive{" "}
            <span className="text-success font-semibold">
              {(Number(amountRaw) / 1e6).toFixed(6)} wOCT
            </span>{" "}
            on Ethereum (no fees deducted).
          </p>
        )}
      </div>

      {address && (
        <div className="rounded-lg bg-muted/30 border border-border p-3 text-xs">
          <span className="text-muted-foreground">Receiving on: </span>
          <span className="font-mono">{address.slice(0, 10)}…{address.slice(-8)}</span>
        </div>
      )}

      {/* Progress */}
      {(isRunning || state.stage === "done") && (
        <div className="space-y-2">
          <Progress value={STAGE_PROGRESS[state.stage]} className="h-2" />
          <div className="flex items-center gap-2 text-sm">
            {isRunning ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-success" />
            )}
            <span className="font-medium">{state.label}</span>
            {state.detail && (
              <span className="text-xs text-muted-foreground truncate">
                {state.detail}
              </span>
            )}
          </div>
        </div>
      )}

      {state.stage === "error" && state.error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 flex items-start gap-2 text-sm">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <span className="text-destructive">{state.error}</span>
        </div>
      )}

      {state.octraTxHash && (
        <a
          href={`https://octrascan.io/tx/${state.octraTxHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition"
        >
          Octra TX <ExternalLink className="h-3 w-3" />
        </a>
      )}
      {state.ethTxHash && (
        <a
          href={`https://etherscan.io/tx/${state.ethTxHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition"
        >
          Ethereum TX <ExternalLink className="h-3 w-3" />
        </a>
      )}

      <div className="flex gap-2">
        <Button
          onClick={handleBridge}
          disabled={!!validation || isRunning}
          className="flex-1 bg-gradient-primary text-primary-foreground font-semibold hover:opacity-90 glow"
          size="lg"
        >
          {isRunning ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Bridging…
            </>
          ) : state.stage === "done" ? (
            "Done — Bridge Again"
          ) : (
            validation ?? "Bridge Now"
          )}
        </Button>
        {(state.stage === "done" || state.stage === "error") && (
          <Button variant="outline" onClick={reset}>
            Reset
          </Button>
        )}
      </div>
    </Card>
  );
}

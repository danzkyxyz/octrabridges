import { Loader2, AlertCircle, CheckCircle2, ExternalLink, Search, RotateCcw } from "lucide-react";
import { useAccount } from "wagmi";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useRecovery, type LockRecord } from "@/lib/bridge/useRecovery";

interface Props {
  octraPk: string;
}

function LockRow({
  lock,
  onRecover,
  isRecovering,
}: {
  lock: LockRecord;
  onRecover: () => void;
  isRecovering: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-mono text-xs">
          Lock #{lock.nonce}
        </span>
        <span className="font-semibold text-gradient">
          {lock.amountHuman} OCT
        </span>
      </div>
      <div className="text-xs text-muted-foreground truncate">
        → {lock.ethRecipient}
      </div>

      {lock.status === "done" && lock.processed && !lock.ethTxHash && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
          Already minted
        </div>
      )}

      {lock.status === "done" && lock.ethTxHash && (
        <div className="flex items-center gap-1.5 text-xs">
          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
          <a
            href={`https://etherscan.io/tx/${lock.ethTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline flex items-center gap-1"
          >
            Recovered! <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      {lock.status === "pending" && (
        <Button
          size="sm"
          onClick={onRecover}
          disabled={isRecovering}
          className="w-full bg-gradient-primary text-primary-foreground text-xs"
        >
          Recover
        </Button>
      )}

      {lock.status === "scanning" && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Checking…
        </div>
      )}

      {lock.status === "recovering" && (
        <div className="flex items-center gap-1.5 text-xs text-primary">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Searching epoch & minting…
        </div>
      )}

      {lock.status === "error" && lock.error && (
        <div className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          {lock.error}
        </div>
      )}
    </div>
  );
}

export function RecoveryCard({ octraPk }: Props) {
  const { isConnected } = useAccount();
  const { state, scan, recover, reset } = useRecovery();

  const canScan = !!octraPk.trim() && state.stage !== "scanning";
  const isRecovering = state.stage === "recovering";
  const unprocessed = state.locks.filter((l) => !l.processed);

  return (
    <Card className="glass-card p-6 space-y-4">
      <div className="flex items-center gap-2">
        <RotateCcw className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold">Recover Stuck Locks</h3>
      </div>

      <p className="text-xs text-muted-foreground">
        Scan the Octra bridge contract for your lock records that haven't been
        minted on Ethereum yet (e.g. due to <code>lock_to_eth</code> limit).
        Then recover each one by signing <code>verifyAndMint</code> with your
        connected wallet.
      </p>

      <div className="flex gap-2">
        <Button
          onClick={() => scan(octraPk)}
          disabled={!canScan}
          className="flex-1"
          variant={state.stage === "idle" ? "default" : "outline"}
        >
          {state.stage === "scanning" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Scanning…
            </>
          ) : (
            <>
              <Search className="h-4 w-4 mr-2" /> Scan Locks
            </>
          )}
        </Button>
        {state.stage !== "idle" && (
          <Button variant="outline" onClick={reset}>
            Reset
          </Button>
        )}
      </div>

      {state.stage === "error" && state.error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 flex items-start gap-2 text-sm">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <span className="text-destructive">{state.error}</span>
        </div>
      )}

      {state.stage === "ready" && state.locks.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-2">
          No lock records found for this Octra key.
        </p>
      )}

      {state.locks.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">
            {state.locks.length} lock(s) found · {unprocessed.length} unprocessed
          </div>
          {state.locks.map((lock) => (
            <LockRow
              key={lock.nonce}
              lock={lock}
              onRecover={() => {
                if (!isConnected) return;
                recover(lock, octraPk);
              }}
              isRecovering={isRecovering}
            />
          ))}
          {!isConnected && unprocessed.length > 0 && (
            <p className="text-xs text-destructive text-center">
              Connect your Ethereum wallet to recover.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

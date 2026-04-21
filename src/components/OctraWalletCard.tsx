import { useEffect, useState } from "react";
import { Eye, EyeOff, Wallet, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  deriveOctraAddress,
  getOctraBalance,
  type OctraBalance,
} from "@/lib/bridge/octra";

interface Props {
  pk: string;
  onPkChange: (v: string) => void;
  onBalanceChange: (b: OctraBalance | null) => void;
}

export function OctraWalletCard({ pk, onPkChange, onBalanceChange }: Props) {
  const [show, setShow] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<OctraBalance | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    setBalance(null);
    setAddress(null);
    onBalanceChange(null);
    const trimmed = pk.trim();
    if (!trimmed) return;

    let cancelled = false;
    let addr: string;
    try {
      addr = deriveOctraAddress(trimmed);
      setAddress(addr);
    } catch (e) {
      setErr((e as Error).message);
      return;
    }

    setLoading(true);
    getOctraBalance(addr)
      .then((b) => {
        if (cancelled) return;
        setBalance(b);
        onBalanceChange(b);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr((e as Error).message);
      })
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [pk, onBalanceChange]);

  return (
    <Card className="glass-card p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Wallet className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold">Octra Wallet</h3>
      </div>

      <div className="space-y-2">
        <Label htmlFor="octra-pk">Octra Private Key (base64, 32 bytes)</Label>
        <div className="relative">
          <Input
            id="octra-pk"
            type={show ? "text" : "password"}
            value={pk}
            onChange={(e) => onPkChange(e.target.value)}
            placeholder="Paste your Octra private key…"
            className="pr-10 font-mono text-sm"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            aria-label={show ? "Hide key" : "Show key"}
            onClick={() => setShow((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition"
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Key never leaves your browser. Used to sign the lock TX locally.
        </p>
      </div>

      {address && (
        <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
              Address
            </div>
            <div className="font-mono text-xs sm:text-sm break-all text-foreground">
              {address}
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-border">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              Balance
            </span>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : err ? (
              <span className="flex items-center gap-1.5 text-sm text-destructive">
                <XCircle className="h-4 w-4" /> {err}
              </span>
            ) : balance ? (
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <span className="text-xl font-bold text-gradient">
                  {balance.balance}
                </span>
                <span className="text-sm text-muted-foreground">OCT</span>
              </span>
            ) : null}
          </div>
        </div>
      )}
    </Card>
  );
}

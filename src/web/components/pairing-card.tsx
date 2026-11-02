import { useState } from "react";
import { KeyRound, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PairingCard({
  error,
  onPair,
}: {
  error: string | null;
  onPair: (token: string) => Promise<void>;
}) {
  const [token, setToken] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!token.trim() || busy) return;
    setBusy(true);
    try {
      await onPair(token.trim());
      setToken("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70dvh] w-full max-w-lg items-center px-4">
      <Card className="w-full">
        <CardHeader>
          <div className="mb-2 flex size-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShieldCheck className="size-6" />
          </div>
          <CardTitle>Pair this browser</CardTitle>
          <CardDescription>
            SecureInput is a local secret handoff between your coding agent and this browser. Pair once, then
            requests appear here automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Alert>
            <KeyRound className="size-4" />
            <AlertDescription>
              Run <code className="rounded bg-muted px-1 py-0.5">secureinput pair</code> in your terminal and open the
              link it prints. You can also paste the token below. Never share this token or pair a browser you do not
              trust.
            </AlertDescription>
          </Alert>

          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="pairing-token">Pairing token</Label>
              <div className="relative">
                <Input
                  id="pairing-token"
                  type={show ? "text" : "password"}
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="Paste the token from secureinput pair"
                  autoComplete="off"
                  spellCheck={false}
                  className="pr-11 font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="absolute top-1/2 right-1 -translate-y-1/2"
                  onClick={() => setShow((value) => !value)}
                  aria-label={show ? "Hide pairing token" : "Show pairing token"}
                >
                  {show ? <EyeOff /> : <Eye />}
                </Button>
              </div>
            </div>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <Button type="submit" className="w-full" disabled={busy || token.trim().length === 0}>
              {busy ? "Pairing…" : "Pair browser"}
            </Button>
          </form>

          <p className="text-xs leading-relaxed text-muted-foreground">
            This page is served from <span className="font-mono">127.0.0.1</span>. It only accepts loopback traffic,
            uses a signed session cookie, and never sends secrets to the agent by default.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

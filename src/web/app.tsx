import { useEffect, useMemo, useState } from "react";
import { History, Inbox, KeyRound, Loader2, LogOut, ShieldCheck, Wifi, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PairingCard } from "@/components/pairing-card";
import { RequestDetail } from "@/components/request-detail";
import { RequestList } from "@/components/request-list";
import { useSecureInput, type ConnectionState } from "@/lib/use-secure-input";

type TabValue = "pending" | "history";

export function App() {
  const { auth, state, connection, pairError, now, pair, logout, submit, deny } = useSecureInput();
  const [tab, setTab] = useState<TabValue>("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const pending = useMemo(() => {
    const items = (state?.requests ?? []).filter(
      (request) => request.status === "pending" || request.status === "executing",
    );
    return items.sort((a, b) => b.createdAt - a.createdAt);
  }, [state]);

  const history = useMemo(() => state?.history ?? [], [state]);
  const allRequests = useMemo(() => [...(state?.requests ?? []), ...(state?.history ?? [])], [state]);
  const items = tab === "pending" ? pending : history;
  const selected = selectedId ? allRequests.find((request) => request.id === selectedId) ?? null : null;

  useEffect(() => {
    if (auth !== "paired" || !state) return;
    if (!selectedId && pending[0]) setSelectedId(pending[0].id);
  }, [auth, pending, selectedId, state]);

  function changeTab(value: string) {
    const next = value as TabValue;
    setTab(next);
    const nextItems = next === "pending" ? pending : history;
    setSelectedId(nextItems[0]?.id ?? null);
  }

  return (
    <div className="min-h-dvh bg-muted/30">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ShieldCheck className="size-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold tracking-tight">SecureInput</h1>
              <p className="hidden truncate text-xs text-muted-foreground sm:block">
                Local secret handoff for coding agents
              </p>
            </div>
          </div>
          {auth === "paired" ? (
            <div className="flex items-center gap-2">
              <ConnectionBadge connection={connection} />
              <Badge variant={pending.length > 0 ? "default" : "secondary"} className="hidden sm:inline-flex">
                {pending.length} pending
              </Badge>
              <Button variant="ghost" size="icon" onClick={() => void logout()} aria-label="Unpair this browser">
                <LogOut />
              </Button>
            </div>
          ) : null}
        </div>
      </header>

      {auth === "loading" ? <LoadingScreen /> : null}
      {auth === "unpaired" ? <PairingCard error={pairError} onPair={pair} /> : null}
      {auth === "paired" && !state ? <LoadingScreen /> : null}
      {auth === "paired" && state ? (
        <main className="mx-auto w-full max-w-6xl px-4 py-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <Tabs value={tab} onValueChange={changeTab}>
              <TabsList>
                <TabsTrigger value="pending" className="gap-1.5">
                  <Inbox className="size-4" />
                  Pending
                  {pending.length > 0 ? <Badge variant="secondary">{pending.length}</Badge> : null}
                </TabsTrigger>
                <TabsTrigger value="history" className="gap-1.5">
                  <History className="size-4" />
                  History
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <p className="hidden text-xs text-muted-foreground md:block">
              Secrets stay on this machine. The agent only receives status and redacted output.
            </p>
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)] lg:items-start">
            <aside className="min-w-0 lg:sticky lg:top-20">
              <ScrollArea className="max-h-[calc(100dvh-14rem)] pr-2">
                <RequestList
                  requests={items}
                  selectedId={selectedId}
                  now={now}
                  onSelect={setSelectedId}
                  emptyTitle={tab === "pending" ? "No pending requests" : "No history yet"}
                  emptyDescription={
                    tab === "pending"
                      ? "Your coding agent will ask here when it needs an API key, password, or token. Ask it to use the request_secret tool."
                      : "Completed, denied, and expired requests appear here. Secret values are never shown."
                  }
                />
              </ScrollArea>
            </aside>

            <section className="min-w-0">
              {selected ? (
                <RequestDetail request={selected} now={now} onSubmit={submit} onDeny={deny} />
              ) : (
                <Empty className="border bg-card/50">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <KeyRound />
                    </EmptyMedia>
                    <EmptyTitle>Select a request</EmptyTitle>
                    <EmptyDescription>
                      Requests from your coding agent appear here. Enter the secret once, review the destination, and
                      SecureInput delivers it without putting it in the chat.
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent />
                </Empty>
              )}
            </section>
          </div>

          <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t pt-4 text-xs text-muted-foreground">
            <span>
              Loopback only · {state.policy.allowedRoots.length} allowed root
              {state.policy.allowedRoots.length === 1 ? "" : "s"} · v{state.policy.version}
            </span>
            <span className="font-mono">127.0.0.1:{state.policy.port}</span>
          </footer>
        </main>
      ) : null}
    </div>
  );
}

function ConnectionBadge({ connection }: { connection: ConnectionState }) {
  if (connection === "live") {
    return (
      <Badge variant="outline" className="gap-1 text-emerald-600 dark:text-emerald-400">
        <Wifi className="size-3" /> Live
      </Badge>
    );
  }
  if (connection === "connecting") {
    return (
      <Badge variant="outline" className="gap-1">
        <Loader2 className="size-3 animate-spin" /> Connecting
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1">
      <WifiOff className="size-3" /> Offline
    </Badge>
  );
}

function LoadingScreen() {
  return (
    <div className="mx-auto grid min-h-[70dvh] w-full max-w-lg place-items-center px-4">
      <div className="w-full space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    </div>
  );
}

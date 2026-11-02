import { Clock3, Inbox, ShieldAlert } from "lucide-react";
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
import type { PublicSecretRequest } from "../../shared/types";
import { deliveryLabel, formatCountdown } from "@/lib/format";
import { RiskBadge, StatusBadge } from "@/components/status-badge";

export function RequestList({
  requests,
  selectedId,
  now,
  onSelect,
  emptyTitle,
  emptyDescription,
}: {
  requests: PublicSecretRequest[];
  selectedId: string | null;
  now: number;
  onSelect: (id: string) => void;
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (requests.length === 0) {
    return (
      <Empty className="border bg-card/50">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Inbox />
          </EmptyMedia>
          <EmptyTitle>{emptyTitle}</EmptyTitle>
          <EmptyDescription>{emptyDescription}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent />
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {requests.map((request) => {
        const selected = request.id === selectedId;
        const expired = request.status === "pending" && request.expiresAt <= now;
        return (
          <Button
            key={request.id}
            type="button"
            variant={selected ? "secondary" : "ghost"}
            aria-pressed={selected}
            onClick={() => onSelect(request.id)}
            className="h-auto w-full flex-col items-stretch gap-2 rounded-lg border border-border/70 px-3 py-3 text-left whitespace-normal"
          >
            <div className="flex w-full items-start justify-between gap-2">
              <span className="line-clamp-2 text-sm font-medium">{request.title}</span>
              <StatusBadge status={expired ? "expired" : request.status} />
            </div>
            <div className="flex w-full items-center gap-2 text-xs text-muted-foreground">
              <span className="truncate">{deliveryLabel(request)}</span>
            </div>
            <div className="flex w-full items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                {request.risk.level === "high" ? <ShieldAlert className="size-3.5 shrink-0 text-destructive" /> : null}
                <span className="truncate">{request.source.clientName ?? "Coding agent"}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <RiskBadge level={request.risk.level} />
                {request.status === "pending" && !expired ? (
                  <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
                    <Clock3 className="size-3" />
                    {formatCountdown(request.expiresAt, now)}
                  </span>
                ) : null}
              </span>
            </div>
          </Button>
        );
      })}
    </div>
  );
}

export function PendingSummary({ count }: { count: number }) {
  return (
    <Badge variant={count > 0 ? "default" : "secondary"}>
      {count} pending
    </Badge>
  );
}

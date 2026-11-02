import { Badge } from "@/components/ui/badge";
import type { RequestStatus, RiskLevel } from "../../shared/types";
import { riskVariant, statusLabel, statusVariant } from "@/lib/format";

export function StatusBadge({ status }: { status: RequestStatus }) {
  return <Badge variant={statusVariant(status)}>{statusLabel(status)}</Badge>;
}

export function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <Badge variant={riskVariant(level)} className="capitalize">
      {level} risk
    </Badge>
  );
}

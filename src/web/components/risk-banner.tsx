import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { PublicSecretRequest } from "../../shared/types";

export function RiskBanner({ request }: { request: PublicSecretRequest }) {
  if (request.risk.reasons.length === 0) return null;
  const high = request.risk.level === "high";
  return (
    <Alert variant={high ? "destructive" : "default"}>
      <AlertTriangle className="size-4" />
      <AlertTitle>{high ? "Review this request carefully" : "Heads up"}</AlertTitle>
      <AlertDescription>
        <ul className="list-disc space-y-1 pl-4">
          {request.risk.reasons.map((reason) => (
            <li key={reason.code}>{reason.message}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

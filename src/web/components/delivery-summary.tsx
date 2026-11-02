import { Bot, FileText, Terminal } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { PublicSecretRequest } from "../../shared/types";
import { maskCommand } from "@/lib/format";

export function DeliverySummary({ request }: { request: PublicSecretRequest }) {
  const fieldLabels = new Map(request.fields.map((field) => [field.id, field.label] as const));
  const delivery = request.delivery;

  if (delivery.mode === "execute") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Terminal className="size-4" />
            Command destination
          </CardTitle>
          <CardDescription>The secret is passed directly to this command. The agent does not receive it.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-words">
            {maskCommand(delivery.command, delivery.args)}
          </pre>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="text-xs font-medium text-muted-foreground">Working directory</div>
              <div className="break-all font-mono text-xs">{delivery.cwd}</div>
            </div>
            <div>
              <div className="text-xs font-medium text-muted-foreground">Secret goes to</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {delivery.stdinFields && delivery.stdinFields.length > 0 ? <Badge variant="secondary">stdin</Badge> : null}
                {(delivery.envKeys ?? []).map((entry) => (
                  <Badge key={entry.key} variant="secondary" className="font-mono">
                    {entry.key}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
          <Separator />
          <p className="text-xs text-muted-foreground">
            Secrets are never placed in command arguments, so they do not appear in the process list. The command runs
            without a shell.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (delivery.mode === "write_env") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4" />
            File destination
          </CardTitle>
          <CardDescription>These keys will be written locally. The agent only sees the result summary.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <div className="text-xs font-medium text-muted-foreground">Env file</div>
            <div className="break-all font-mono text-xs">{delivery.path}</div>
          </div>
          <div className="space-y-1">
            {(delivery.mapping ?? []).map((entry) => (
              <div key={entry.envKey} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                <span className="text-xs">{fieldLabels.get(entry.fieldId) ?? entry.fieldId}</span>
                <span className="flex items-center gap-2 font-mono text-xs">
                  {entry.exists ? <Badge variant="destructive">overwrite</Badge> : <Badge variant="outline">new</Badge>}
                  {entry.envKey}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            The file is written atomically with mode 0600. Comments and line endings are preserved.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Alert variant="destructive">
      <Bot className="size-4" />
      <AlertTitle>This secret is returned to the agent</AlertTitle>
      <AlertDescription>
        Return mode is enabled. The value will enter the model context and may appear in transcript logs. Only continue
        if you understand and accept that.
      </AlertDescription>
    </Alert>
  );
}

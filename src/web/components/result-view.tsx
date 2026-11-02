import { Ban, CircleCheck, CircleX, Clock3, FileText, Terminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { PublicSecretRequest } from "../../shared/types";

export function ResultView({ request }: { request: PublicSecretRequest }) {
  const result = request.result;
  if (!result) return null;

  const completed = result.ok;
  const Icon =
    result.status === "denied" || result.status === "failed"
      ? CircleX
      : result.status === "expired" || result.status === "canceled"
        ? Clock3
        : completed
          ? CircleCheck
          : Ban;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div
            className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg ${
              completed ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-destructive/10 text-destructive"
            }`}
          >
            <Icon className="size-5" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-base capitalize">{result.status}</CardTitle>
            <CardDescription className="mt-1 break-words">{result.message}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {result.execution ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant={result.execution.exitCode === 0 ? "secondary" : "destructive"}>
                exit {result.execution.exitCode ?? "n/a"}
              </Badge>
              <span>{Math.round(result.execution.durationMs)}ms</span>
              {result.execution.timedOut ? <Badge variant="destructive">timed out</Badge> : null}
              {result.execution.truncated ? <Badge variant="outline">output truncated</Badge> : null}
            </div>
            {result.execution.stdout ? (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Terminal className="size-3.5" /> stdout
                </div>
                <pre className="max-h-64 overflow-auto rounded-md border bg-muted/60 p-3 font-mono text-xs whitespace-pre-wrap break-words">
                  {result.execution.stdout}
                </pre>
              </div>
            ) : null}
            {result.execution.stderr ? (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Terminal className="size-3.5" /> stderr
                </div>
                <pre className="max-h-64 overflow-auto rounded-md border bg-muted/60 p-3 font-mono text-xs whitespace-pre-wrap break-words">
                  {result.execution.stderr}
                </pre>
              </div>
            ) : null}
            {!result.execution.stdout && !result.execution.stderr ? (
              <p className="text-xs text-muted-foreground">The command produced no output.</p>
            ) : null}
            <Separator />
            <p className="text-xs text-muted-foreground">
              Secret values were redacted from command output. The agent only received this redacted result.
            </p>
          </>
        ) : null}

        {result.envFile ? (
          <>
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <FileText className="size-3.5" /> {result.envFile.path}
              </div>
              <div className="space-y-1">
                {result.envFile.keys.map((entry) => (
                  <div key={entry.key} className="flex items-center justify-between rounded-md border px-3 py-2 text-xs">
                    <span className="font-mono">{entry.key}</span>
                    <Badge variant={entry.overwritten ? "destructive" : "secondary"}>
                      {entry.overwritten ? "replaced" : "written"}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              The file was written locally. The secret was not returned to the agent.
            </p>
          </>
        ) : null}

        {result.status === "completed" && request.delivery.mode === "return" ? (
          <p className="text-xs font-medium text-destructive">
            The secret was returned to the agent and may now be in its context and transcript.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

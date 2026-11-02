import { useEffect, useMemo, useState } from "react";
import { Bot, Clock3, Eye, EyeOff, Folder, Loader2, LockKeyhole, ShieldAlert } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import type { PublicSecretRequest } from "../../shared/types";
import { validateFieldValues } from "../../shared/validation";
import { ApiError } from "@/lib/api";
import { formatCountdown, formatTime } from "@/lib/format";
import { DeliverySummary } from "@/components/delivery-summary";
import { ResultView } from "@/components/result-view";
import { RiskBanner } from "@/components/risk-banner";
import { RiskBadge, StatusBadge } from "@/components/status-badge";

export function RequestDetail({
  request,
  now,
  onSubmit,
  onDeny,
}: {
  request: PublicSecretRequest;
  now: number;
  onSubmit: (
    requestId: string,
    values: Record<string, string>,
    confirmations: { reviewedCommand?: boolean; overwrite?: boolean; sendToAgent?: boolean },
  ) => Promise<PublicSecretRequest>;
  onDeny: (requestId: string, reason?: string) => Promise<PublicSecretRequest>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewedCommand, setReviewedCommand] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [sendToAgent, setSendToAgent] = useState(false);

  useEffect(() => {
    setValues({});
    setRevealed({});
    setFieldErrors({});
    setError(null);
    setBusy(false);
    setReviewedCommand(false);
    setOverwrite(false);
    setSendToAgent(false);
  }, [request.id, request.status]);

  const expired = request.status === "pending" && request.expiresAt <= now;
  const pending = request.status === "pending" && !expired;
  const executing = request.status === "executing";
  const terminal = ["completed", "failed", "denied", "expired", "canceled"].includes(request.status);

  const missingConfirmations = useMemo(() => {
    const missing: string[] = [];
    if (request.risk.requiresCommandReview && !reviewedCommand) missing.push("review the command");
    if (request.risk.requiresOverwriteConfirm && !overwrite) missing.push("confirm the overwrite");
    if (request.risk.requiresReturnConfirm && !sendToAgent) missing.push("confirm the agent may see the secret");
    return missing;
  }, [overwrite, request.risk, reviewedCommand, sendToAgent]);

  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    if (busy) return;
    const validation = validateFieldValues(request.fields, values);
    if (!validation.ok) {
      setFieldErrors(validation.errors);
      setError("Check the highlighted fields.");
      return;
    }
    if (missingConfirmations.length > 0) {
      setError(`Please ${missingConfirmations.join(", ")} before continuing.`);
      return;
    }
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await onSubmit(request.id, values, {
        reviewedCommand: reviewedCommand || undefined,
        overwrite: overwrite || undefined,
        sendToAgent: sendToAgent || undefined,
      });
      setValues({});
      setRevealed({});
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        const details = caught.details as { fieldErrors?: Record<string, string> } | undefined;
        if (details?.fieldErrors) setFieldErrors(details.fieldErrors);
      } else {
        setError("Could not submit the request.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function deny() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onDeny(request.id);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not deny the request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={expired ? "expired" : request.status} />
            <RiskBadge level={request.risk.level} />
            {request.status === "pending" && !expired ? (
              <Badge variant="outline" className="font-mono">
                <Clock3 className="size-3" /> {formatCountdown(request.expiresAt, now)}
              </Badge>
            ) : null}
          </div>
          <h2 className="text-xl font-semibold tracking-tight break-words">{request.title}</h2>
          <p className="text-xs text-muted-foreground">
            Requested at {formatTime(request.createdAt)} · expires at {formatTime(request.expiresAt)}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Bot className="size-4" />
            Requested by {request.source.clientName ?? "Coding agent"}
            {request.source.clientVersion ? <span className="text-muted-foreground">v{request.source.clientVersion}</span> : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-xs text-muted-foreground">
          <div className="flex items-start gap-2">
            <Folder className="mt-0.5 size-3.5 shrink-0" />
            <span className="break-all font-mono">{request.source.cwd ?? "working directory not reported"}</span>
          </div>
          <p>
            This client name, working directory, and the request text below are supplied by the agent. They are not
            independently verified.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Why the agent is asking</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{request.description}</p>
        </CardContent>
      </Card>

      <RiskBanner request={request} />
      <DeliverySummary request={request} />

      {pending ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <LockKeyhole className="size-4" />
              Enter the secret
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} onKeyDown={(event) => {
              if (event.key === "Enter" && event.target instanceof HTMLInputElement && ["text", "password"].includes(event.target.type)) {
                event.preventDefault();
                void submit();
              }
            }} className="space-y-5" autoComplete="off">
              <div className="grid gap-4">
                {request.fields.map((field) => {
                  const fieldError = fieldErrors[field.id];
                  const show = revealed[field.id] ?? false;
                  return (
                    <div key={field.id} className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Label htmlFor={`field-${field.id}`}>
                          {field.label}
                          {field.required !== false ? <span className="ml-1 text-destructive">*</span> : null}
                        </Label>
                        {field.sensitive !== false && field.type === "password" ? (
                          <span className="text-xs text-muted-foreground">sensitive</span>
                        ) : null}
                      </div>
                      {field.description ? <p className="text-xs text-muted-foreground">{field.description}</p> : null}
                      <div className="relative">
                        <Input
                          id={`field-${field.id}`}
                          type={field.type === "password" && !show ? "password" : "text"}
                          value={values[field.id] ?? ""}
                          onChange={(event) => {
                            setValues((previous) => ({ ...previous, [field.id]: event.target.value }));
                            setFieldErrors((previous) => {
                              const next = { ...previous };
                              delete next[field.id];
                              return next;
                            });
                          }}
                          placeholder={field.placeholder ?? (field.type === "password" ? "Paste the value" : "")}
                          autoComplete={field.autocomplete ?? "off"}
                          autoCapitalize="off"
                          autoCorrect="off"
                          spellCheck={false}
                          maxLength={field.maxLength ?? 8192}
                          aria-invalid={Boolean(fieldError)}
                          aria-describedby={fieldError ? `field-error-${field.id}` : undefined}
                          className={field.type === "password" ? "pr-11 font-mono text-sm" : "font-mono text-sm"}
                        />
                        {field.type === "password" ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="absolute top-1/2 right-1 -translate-y-1/2"
                            onClick={() => setRevealed((previous) => ({ ...previous, [field.id]: !show }))}
                            aria-label={show ? `Hide ${field.label}` : `Show ${field.label}`}
                          >
                            {show ? <EyeOff /> : <Eye />}
                          </Button>
                        ) : null}
                      </div>
                      {fieldError ? (
                        <p id={`field-error-${field.id}`} className="text-xs text-destructive">
                          {fieldError}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {request.risk.requiresCommandReview ? (
                <label className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
                  <Checkbox checked={reviewedCommand} onCheckedChange={(value) => setReviewedCommand(value === true)} />
                  <span>I reviewed the command and destination above and trust where this secret is sent.</span>
                </label>
              ) : null}
              {request.risk.requiresOverwriteConfirm ? (
                <label className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
                  <Checkbox checked={overwrite} onCheckedChange={(value) => setOverwrite(value === true)} />
                  <span>I understand this replaces existing values in the env file.</span>
                </label>
              ) : null}
              {request.risk.requiresReturnConfirm ? (
                <label className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
                  <Checkbox checked={sendToAgent} onCheckedChange={(value) => setSendToAgent(value === true)} />
                  <span>I understand the agent will receive this secret and it may enter its context and transcript.</span>
                </label>
              ) : null}

              {error ? (
                <Alert variant="destructive">
                  <AlertTitle>Could not continue</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              <Separator />
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="outline" disabled={busy}>
                      Deny request
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Deny this request?</AlertDialogTitle>
                      <AlertDialogDescription>
                        The agent will be told that you denied it. No secret is sent or stored.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep it</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void deny()}>Deny request</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <Button type="button" onClick={() => void submit()} disabled={busy || missingConfirmations.length > 0}>
                  {busy ? <Loader2 className="animate-spin" /> : <LockKeyhole />}
                  {busy ? "Sending…" : "Send securely"}
                </Button>
              </div>
              {missingConfirmations.length > 0 ? (
                <p className="flex items-center gap-1 text-right text-xs text-muted-foreground">
                  <ShieldAlert className="size-3.5" /> Confirmation required above.
                </p>
              ) : null}
            </form>
          </CardContent>
        </Card>
      ) : null}

      {executing ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-6">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Delivering your secret…</p>
              <p className="text-xs text-muted-foreground">
                You can close this tab. The local daemon continues the delivery and reports the redacted result here.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {terminal ? <ResultView request={request} /> : null}
    </div>
  );
}

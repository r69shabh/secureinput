const KEY_LINE = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=)(.*)$/;

export function detectEol(content: string): "\r\n" | "\n" {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

export function findEnvKeys(content: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of content.split(/\r?\n/)) {
    const match = KEY_LINE.exec(line);
    if (!match?.[2]) continue;
    counts.set(match[2], (counts.get(match[2]) ?? 0) + 1);
  }
  return counts;
}

export function formatEnvValue(value: string): string {
  if (value.length === 0) return '""';
  if (/^[A-Za-z0-9_./:@%+,=-]*$/.test(value) && !value.startsWith(" ") && !value.endsWith(" ")) {
    return value;
  }
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

export interface EnvUpdateResult {
  content: string;
  written: string[];
  overwritten: string[];
}

export function applyEnvUpdates(content: string, updates: Record<string, string>): EnvUpdateResult {
  const eol = detectEol(content);
  const hadTrailingEol = content.endsWith("\n");
  const lines = content.length === 0 ? [] : content.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const written: string[] = [];
  const overwritten: string[] = [];
  const pending = new Map(Object.entries(updates));

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = KEY_LINE.exec(line);
    if (!match?.[2] || !pending.has(match[2])) continue;
    const key = match[2];
    const value = pending.get(key) ?? "";
    lines[index] = `${match[1] ?? ""}${key}${match[3] ?? "="}${formatEnvValue(value)}`;
    if (!overwritten.includes(key)) {
      overwritten.push(key);
      pending.delete(key);
    }
  }

  for (const [key, value] of pending) {
    lines.push(`${key}=${formatEnvValue(value)}`);
    written.push(key);
  }

  let output = lines.join(eol);
  if (hadTrailingEol || output.length > 0) output += eol;
  return { content: output, written, overwritten };
}

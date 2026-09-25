export type PromptMenuKind = "source" | "command";

export interface PromptToken {
  kind: PromptMenuKind;
  query: string;
  start: number;
}

export function parsePromptToken(
  value: string,
): PromptToken | null {
  const match = /(^|\s)([@/])([\w-]*)$/.exec(value);
  if (!match) return null;

  return {
    kind: match[2] === "@" ? "source" : "command",
    query: match[3].toLowerCase(),
    start: match.index + match[1].length,
  };
}

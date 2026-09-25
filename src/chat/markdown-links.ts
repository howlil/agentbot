/**
 * Returns the Obsidian link target for a rendered Markdown anchor.
 * External URLs stay browser-owned; internal links are opened by the workspace.
 */
export function resolveNoxMarkdownLink(
  rawTarget: string | null | undefined,
  hasInternalClass = false,
): string | null {
  if (!rawTarget) return null;

  const target = rawTarget.split("|")[0]?.trim() ?? "";
  if (!target) return null;

  const hasExternalScheme = /^[a-z][a-z\d+.-]*:/i.test(target);
  const isMarkdownPath = /\.md(?:#|$)/i.test(target);
  const isHeading = target.startsWith("#");
  if (!hasInternalClass && hasExternalScheme && !isHeading) return null;
  if (!hasInternalClass && !isMarkdownPath && !isHeading) return null;

  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

/**
 * Unquoted scrapers / refineQuoted often consume the leading `/` of absolute
 * Unix paths, leaving `Users/foo/...`. Restore it for Open/Save resolution.
 * Only restore well-known user/home volume roots — not ambiguous roots like
 * `tmp/` / `var/` which can be relative project paths.
 */
export function restoreAbsolutePathPrefix(filePath: string): string {
  const p = String(filePath || "")
    .trim()
    .replace(/\\/g, "/");
  if (!p || p.startsWith("/") || /^[A-Za-z]:\//.test(p)) return p;
  if (/^(Users|home|private|Volumes)\//.test(p)) {
    return `/${p}`;
  }
  return p;
}

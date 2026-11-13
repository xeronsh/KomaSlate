import fs from "node:fs";
import path from "node:path";

/**
 * Resolve a media path via `realpathSync` + `path.relative` so symlinks and
 * prefix-lookalike directories (e.g. `/app/static_leak`) cannot escape `allowedRoots`.
 */
export function assertSafeMediaPath(targetPath: string, allowedRoots: string[]): string {
  const resolved = fs.realpathSync(path.resolve(targetPath));
  const safe = allowedRoots.some((root) => {
    let resolvedRoot: string;
    try {
      resolvedRoot = fs.realpathSync(path.resolve(root));
    } catch {
      return false;
    }
    const rel = path.relative(resolvedRoot, resolved);
    return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
  });
  if (!safe) {
    throw new Error(`Security violation: media path outside allowed boundaries: ${resolved}`);
  }
  return resolved;
}

export interface MediaReferenceOptions {
  staticDir: string;
  gatewayBaseUrl?: string;
  transport: "stdio" | "http";
  shareFilesystem?: boolean;
}

/**
 * Zero-Copy local physical path resolution for stdio/same-host MCP servers,
 * with automatic gateway static URL fallback for remote HTTP MCP servers.
 */
export function resolveStaticMediaReference(
  mediaRef: string,
  options: MediaReferenceOptions,
): string {
  if (/^https?:\/\//i.test(mediaRef)) {
    return mediaRef;
  }

  const gatewayBase = (
    options.gatewayBaseUrl ??
    process.env.KOMASLATE_BACKEND_URL ??
    "http://127.0.0.1:18765"
  ).replace(/\/+$/, "");

  const useLocalZeroCopy = options.transport === "stdio" || options.shareFilesystem === true;

  if (mediaRef.startsWith("/static/")) {
    const relativeStatic = mediaRef.slice("/static/".length);
    if (!useLocalZeroCopy) {
      return `${gatewayBase}/static/${relativeStatic}`;
    }
    const candidate = path.join(options.staticDir, relativeStatic);
    return assertSafeMediaPath(candidate, [options.staticDir]);
  }

  const verifiedLocal = assertSafeMediaPath(mediaRef, [options.staticDir]);
  if (useLocalZeroCopy) {
    return verifiedLocal;
  }
  const resolvedRoot = fs.realpathSync(path.resolve(options.staticDir));
  const rel = path.relative(resolvedRoot, verifiedLocal).split(path.sep).join("/");
  return `${gatewayBase}/static/${rel}`;
}

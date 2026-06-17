import { resolve, sep } from 'node:path';

/** Resolve a vault-relative path and HARD-FAIL if it escapes the vault root. */
export function resolveInsideVault(vaultRoot: string, relPath: string): string {
  const root = resolve(vaultRoot);
  const abs = resolve(root, relPath);
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`Refusing to write outside vault: ${relPath}`);
  }
  return abs;
}

import { describe, it, expect } from 'vitest';
import { resolveInsideVault } from './paths';

const VAULT = '/Users/admin/Documents/ObsidianVault';

describe('resolveInsideVault', () => {
  it('resolves a normal relative path inside the vault', () => {
    expect(resolveInsideVault(VAULT, 'wiki/synthesis/x.md')).toBe(`${VAULT}/wiki/synthesis/x.md`);
  });
  it('rejects path traversal with ../', () => {
    expect(() => resolveInsideVault(VAULT, '../evil.md')).toThrow(/outside vault/i);
  });
  it('rejects absolute paths that escape the vault', () => {
    expect(() => resolveInsideVault(VAULT, '/etc/passwd')).toThrow(/outside vault/i);
  });
  it('rejects sneaky nested traversal', () => {
    expect(() => resolveInsideVault(VAULT, 'wiki/../../escape.md')).toThrow(/outside vault/i);
  });
});

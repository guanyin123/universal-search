import { simpleGit } from 'simple-git';

/** HARD-FAIL if the vault has uncommitted changes, so we never co-mingle commits. */
export async function assertCleanVault(vaultRoot: string): Promise<void> {
  const status = await simpleGit(vaultRoot).status();
  if (!status.isClean()) {
    throw new Error(
      `Vault git tree is dirty (${status.files.length} changed file(s)). ` +
        'Commit or stash your vault changes before running a deposit.'
    );
  }
}

/** Stage the given vault-relative files and commit. Returns the short sha. */
export async function autocommit(vaultRoot: string, files: string[], message: string): Promise<string> {
  if (files.length === 0) throw new Error('autocommit: no files to commit');
  const git = simpleGit(vaultRoot);
  await git.add(files);
  await git.commit(message);
  const sha = await git.revparse(['--short', 'HEAD']);
  return sha.trim();
}

// Fails when a branch changes what Bob sees but not the manual (docs/manual.md).
// Runs first in `npm run check` / `check:quiet`. Skips on main and when there's no main to compare with.
// Escape hatch: a commit message on the branch containing "Manual: none".
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const USER_FACING = /^src\/(ui|model|media|data|store)\//;

/** True if these changed files include something user-facing but not the manual. */
export function needsManual(files) {
  const facing = files.filter((f) => USER_FACING.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith('CLAUDE.md'));
  return facing.length > 0 && !files.includes('docs/manual.md');
}

function git(cmd) {
  try { return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const branch = git('rev-parse --abbrev-ref HEAD');
  const base = git('merge-base HEAD origin/main') ?? git('merge-base HEAD main');
  if (!branch || branch === 'main' || !base) process.exit(0);
  if ((git(`log --format=%B ${base}..HEAD`) ?? '').includes('Manual: none')) process.exit(0);
  // Committed and uncommitted changes since the branch left main, plus new files.
  const files = [...(git(`diff --name-only ${base}`) ?? '').split('\n'), ...(git('ls-files --others --exclude-standard') ?? '').split('\n')].filter(Boolean);
  if (needsManual(files)) {
    console.error('check-manual: this branch changes the app but not docs/manual.md. Update the manual for this change (or add "Manual: none" to a commit message if nothing user-visible changed).');
    process.exit(1);
  }
}

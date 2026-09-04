import { defineConfig, configDefaults } from 'vitest/config';

/* Agent worktrees under .claude/worktrees/ are whole copies of the repository
   without node_modules; vitest's default glob found their test files and
   reported ten failed files with zero failed tests. */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/.claude/**'],
  },
});

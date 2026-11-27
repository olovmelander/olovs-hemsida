#!/usr/bin/env node
/* THE REVIEWER'S BLIND LOOK, RUN WHERE NOTHING ABOUT THE COURSE CAN REACH IT.

   A course is released on the course-reviewer's verdict alone (the owner's decision, 27 November 2026), so the look
   must be blind. An agent started inside this repository is not: Claude Code gives every session the project's
   CLAUDE.md and its auto-memory, and both name what is known to be wrong on the grounds (the first reviewer asked to
   look at Bro Hof saw that and stopped, as its brief says). So the reviewer runs as its own headless Claude, in a
   fresh folder outside the repository that holds the sheets' copies and nothing else: no project, no memory, no
   CLAUDE.md, and only Read, Glob and Write. Its brief is .claude/agents/course-reviewer.md's. Its verdicts are copied
   back beside the sheets, and recorded with visual-review.mjs --record.

     node tools/course-review-run.mjs --ground <id> [--record]       after tools/course-review-pictures.mjs

   The Claude Code binary is BANVY_CLAUDE, else `claude` on the PATH, else the VS Code extension's own. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { groundRoutings } from './course-rebuild.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = name => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };

export function claudeBinary() {
  if (process.env.BANVY_CLAUDE) return process.env.BANVY_CLAUDE;
  const onPath = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], { encoding: 'utf8' });
  if (onPath.status === 0 && onPath.stdout.trim()) return onPath.stdout.trim().split(/\r?\n/)[0];
  const extensions = path.join(os.homedir(), '.vscode', 'extensions');
  const found = (fs.existsSync(extensions) ? fs.readdirSync(extensions) : []).filter(name => name.startsWith('anthropic.claude-code-')).sort().reverse()
    .map(name => path.join(extensions, name, 'resources', 'native-binary', process.platform === 'win32' ? 'claude.exe' : 'claude')).find(fs.existsSync);
  if (!found) throw new Error('no Claude Code binary: set BANVY_CLAUDE');
  return found;
}

/* Nothing a reviewer reads may come from above its folder: a CLAUDE.md there would reach it. */
export function blindFolderProblems(folder) {
  const problems = [];
  for (let dir = path.dirname(folder); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'CLAUDE.md'))) problems.push(`${dir} has a CLAUDE.md, which would reach the reviewer`);
    if (path.dirname(dir) === dir) break;
  }
  if (fs.existsSync(path.join(os.homedir(), '.claude', 'CLAUDE.md'))) problems.push('the user\'s own CLAUDE.md would reach the reviewer');
  return problems;
}

export const briefOf = text => text.replace(/^---[\s\S]*?\n---\n/, '').trim();

async function main() {
  const groundId = flag('--ground');
  if (!groundId) throw new Error('usage: course-review-run.mjs --ground <id> [--record]');
  const { routings } = groundRoutings(groundId);
  const sheets = path.join(ROOT, routings[0].build, 'cache', 'visual-review');
  const report = JSON.parse(fs.readFileSync(path.join(sheets, 'report.json'), 'utf8'));
  if (report.problems?.length) throw new Error(`the sheets were drawn with ${report.problems.length} problems: fix them and draw again`);

  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'banvy-blind-review-'));
  const problems = blindFolderProblems(folder);
  if (problems.length) throw new Error(`the review would not be blind: ${problems.join('; ')}`);
  for (const sheet of report.sheets) fs.copyFileSync(path.join(sheets, sheet.file), path.join(folder, sheet.file));
  const brief = briefOf(fs.readFileSync(path.join(ROOT, '.claude/agents/course-reviewer.md'), 'utf8'));
  const prompt = `${brief}\n\n## This review\n\nThe sheets are the ${report.sheets.length} .jpg files in your working folder (${report.sheets.map(s => s.id).join(', ')}). `
    + `Write your verdicts to verdicts.json in your working folder, with reviewedOn ${new Date().toISOString().slice(0, 10)}.`;
  const started = Date.now();
  /* --restricted: no tool that runs code, no settings files, the file tools confined to the folder; --strict-mcp-config:
     no MCP server either (the first run reached for Blender to crop a sheet). */
  const run = spawnSync(claudeBinary(), ['-p', prompt, '--restricted', '--strict-mcp-config', '--allowedTools', 'Read', 'Glob', 'Write',
    '--disallowedTools', 'Bash', 'Edit', 'WebFetch', 'WebSearch', 'Agent', '--permission-mode', 'acceptEdits', '--no-session-persistence', ...(flag('--model') ? ['--model', flag('--model')] : [])],
  { cwd: folder, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60 * 60 * 1000 });
  const said = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim();
  const verdictsFile = path.join(folder, 'verdicts.json');
  if (run.status !== 0 || !fs.existsSync(verdictsFile)) throw new Error(`the reviewer wrote no verdicts (exit ${run.status}): ${said.slice(-600)}`);
  const verdicts = JSON.parse(fs.readFileSync(verdictsFile, 'utf8'));
  const missing = report.sheets.map(s => s.id).filter(id => !(id in (verdicts.looked ?? {})));
  if (missing.length) throw new Error(`the reviewer did not look at ${missing.length} sheets: ${missing.slice(0, 6).join(', ')}`);
  fs.writeFileSync(path.join(sheets, 'verdicts.json'), `${JSON.stringify(verdicts, null, 1)}\n`);
  fs.writeFileSync(path.join(sheets, 'reviewer-report.txt'), `${said}\n`);
  fs.rmSync(folder, { recursive: true, force: true });
  const doubts = Object.keys(verdicts.doubts ?? {}).length, cannot = Object.keys(verdicts.cannotTell ?? {}).length;
  console.log(`${groundId}: ${Object.keys(verdicts.looked).length} sheets looked at blind in ${Math.round((Date.now() - started) / 1000)} s, ${doubts} doubted, ${cannot} it could not tell\n${said.slice(-1500)}`);
  if (args.includes('--record')) {
    const record = spawnSync(process.execPath, [path.join(ROOT, 'packages/course-workflow/visual-review.mjs'), '--ground', groundId, '--record', path.join(sheets, 'verdicts.json')], { cwd: ROOT, encoding: 'utf8' });
    process.stdout.write(record.stdout);
    if (record.status !== 0) throw new Error(record.stderr.trim().split('\n').slice(-3).join(' '));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

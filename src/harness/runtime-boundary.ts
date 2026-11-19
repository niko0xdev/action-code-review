import { randomUUID } from 'node:crypto';
import { realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** One explicitly loaded, action-owned extension; target extensions stay disabled. */
export async function preparePiBoundary(
	repositoryPath: string,
	configDir: string,
	skillPaths: readonly string[] = []
): Promise<string> {
	const root = await realpath(repositoryPath);
	const skills = await Promise.all(
		skillPaths.map(async (path) => {
			try {
				return await realpath(path);
			} catch {
				return '';
			}
		})
	);
	const extensionPath = join(configDir, `review-boundary-${randomUUID()}.mjs`);
	await writeFile(
		extensionPath,
		`
import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
const root = ${JSON.stringify(root)};
const skills = new Set(${JSON.stringify(skills.filter(Boolean))});
const unstablePath = /[\\u00a0\\u2000-\\u200a\\u202f\\u205f\\u3000]/;
// grep and find search hidden entries, so a search of the repository root also
// walks .git, where actions/checkout persists the job token. Their output is
// filtered here, after the tool ran, because a glob cannot exclude it reliably.
const gitSegment = /(?:^|\\/)\\.git(?:\\/|$)/;
const grepEntry = /^(.*?)(?::\\d+: |-\\d+- |:\\d+:$|-\\d+-$)/;
const credentials = [
  [/(authorization:[ \\t]*(?:basic|bearer|token)[ \\t]+)[A-Za-z0-9+\\/=._~-]+/gi, '$1[REDACTED]'],
  [/\\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{16,255}/g, '[REDACTED]'],
];
const inGitMetadata = (toolName, line) => {
  const entry = toolName === 'grep' ? (grepEntry.exec(line)?.[1] ?? line) : line;
  return gitSegment.test(entry.replace(/\\\\/g, '/'));
};
export function filterToolResult(event) {
  if (!['read', 'grep', 'find', 'ls'].includes(event.toolName)) return undefined;
  try {
    const content = event.content.map((part) => {
      if (!part || part.type !== 'text' || typeof part.text !== 'string') return part;
      let text = part.text;
      if (event.toolName === 'grep' || event.toolName === 'find')
        text = text.split('\\n').filter((line) => !inGitMetadata(event.toolName, line)).join('\\n');
      for (const [pattern, replacement] of credentials) text = text.replace(pattern, replacement);
      return { ...part, text };
    });
    return { content };
  } catch {
    // A handler error would let the unfiltered result through, so fail closed.
    return {
      content: [{ type: 'text', text: 'The tool result was withheld by the review boundary.' }],
      isError: true,
    };
  }
}
export default function boundary(pi) {
  pi.on('tool_result', filterToolResult);
  pi.on('tool_call', (event) => {
    if (!['read', 'grep', 'find', 'ls'].includes(event.toolName))
      return { block: true, reason: 'Only repository inspection tools are permitted.' };
    const raw = event.input.path ?? '.';
    if (typeof raw !== 'string' || raw.includes('\\0') || raw.startsWith('@') || raw.startsWith('~') || unstablePath.test(raw))
      return { block: true, reason: 'The tool path must name repository source.' };
    try {
      const path = realpathSync(resolve(root, raw));
      if (unstablePath.test(path))
        return { block: true, reason: 'The source path changes under runtime normalisation.' };
      const rel = relative(root, path);
      const inside = rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
      const metadata = rel.split(sep).includes('.git');
      if ((!inside || metadata) && !(event.toolName === 'read' && skills.has(path)))
        return { block: true, reason: 'The tool path is outside the permitted source boundary.' };
      event.input.path = path;
    } catch {
      return { block: true, reason: 'The source path could not be resolved safely.' };
    }
  });
}
`,
		{ mode: 0o600 }
	);
	return extensionPath;
}

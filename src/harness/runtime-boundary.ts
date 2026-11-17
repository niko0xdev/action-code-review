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
	const extensionPath = join(configDir, 'review-boundary.mjs');
	await writeFile(
		extensionPath,
		`
import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
const root = ${JSON.stringify(root)};
const skills = new Set(${JSON.stringify(skills.filter(Boolean))});
const unstablePath = /[\\u00a0\\u2000-\\u200a\\u202f\\u205f\\u3000]/;
export default function boundary(pi) {
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

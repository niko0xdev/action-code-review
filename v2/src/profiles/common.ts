import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DetectedProfile, ProfileId } from '../types/context.js';

/**
 * Deterministic stack detection (spec §9). Signals come from repository
 * files only — no network calls, no guessing from file extensions alone
 * where a manifest is the stronger signal.
 */

interface DetectionSignal {
	id: ProfileId;
	/** Human-readable evidence string recorded on detection. */
	evidence: string;
	test: (repo: string) => boolean;
}

function readPackageJson(repo: string): Record<string, unknown> | null {
	const path = join(repo, 'package.json');
	if (!existsSync(path)) {
		return null;
	}
	try {
		return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function packageDependency(repo: string, name: string): boolean {
	const pkg = readPackageJson(repo);
	const all = {
		...(pkg?.dependencies as Record<string, string> | undefined),
		...(pkg?.devDependencies as Record<string, string> | undefined),
	};
	return Boolean(all?.[name]);
}

function hasFile(repo: string, ...candidates: string[]): boolean {
	return candidates.some((candidate) => existsSync(join(repo, candidate)));
}

function hasMatchingFile(repo: string, dir: string, pattern: RegExp): boolean {
	const full = join(repo, dir);
	if (!existsSync(full)) {
		return false;
	}
	try {
		return readdirSync(full).some((name) => pattern.test(name));
	} catch {
		return false;
	}
}

function hasSourceWithExtension(
	repo: string,
	extension: string,
	minCount = 1
): boolean {
	let count = 0;
	const walk = (dir: string, depth: number): void => {
		if (depth > 4 || count >= minCount) {
			return;
		}
		let entries: import('node:fs').Dirent[] = [];
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (count >= minCount) {
				return;
			}
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (
					entry.name === 'node_modules' ||
					entry.name === '.git' ||
					entry.name === 'dist'
				) {
					continue;
				}
				walk(full, depth + 1);
			} else if (entry.name.endsWith(extension)) {
				count += 1;
			}
		}
	};
	walk(repo, 0);
	return count >= minCount;
}

const SIGNALS: DetectionSignal[] = [
	{
		id: 'nextjs',
		evidence: 'package.json:next dependency',
		test: (repo) => packageDependency(repo, 'next'),
	},
	{
		id: 'nextjs',
		evidence: 'next.config.* present',
		test: (repo) => hasMatchingFile(repo, '.', /^next\.config\./),
	},
	{
		id: 'react',
		evidence: 'package.json:react dependency',
		test: (repo) => packageDependency(repo, 'react'),
	},
	{
		id: 'react',
		evidence: '*.tsx sources present',
		test: (repo) => hasSourceWithExtension(repo, '.tsx'),
	},
	{
		id: 'nestjs',
		evidence: 'package.json:@nestjs/core dependency',
		test: (repo) => packageDependency(repo, '@nestjs/core'),
	},
	{
		id: 'nestjs',
		evidence: 'nest-cli.json present',
		test: (repo) => hasFile(repo, 'nest-cli.json'),
	},
	{
		id: 'nodejs',
		evidence: 'package.json present',
		test: (repo) => existsSync(join(repo, 'package.json')),
	},
	{
		id: 'typescript',
		evidence: 'tsconfig.json present',
		test: (repo) => existsSync(join(repo, 'tsconfig.json')),
	},
	{
		id: 'python',
		evidence: 'pyproject.toml present',
		test: (repo) => existsSync(join(repo, 'pyproject.toml')),
	},
	{
		id: 'python',
		evidence: 'uv.lock present',
		test: (repo) => existsSync(join(repo, 'uv.lock')),
	},
	{
		id: 'swift',
		evidence: 'Package.swift present',
		test: (repo) => existsSync(join(repo, 'Package.swift')),
	},
	{
		id: 'swift',
		evidence: '*.xcodeproj or *.xcworkspace present',
		test: (repo) => hasMatchingFile(repo, '.', /\.(xcodeproj|xcworkspace)$/),
	},
	{
		id: 'kotlin',
		evidence: 'build.gradle(.kts) present',
		test: (repo) => hasFile(repo, 'build.gradle', 'build.gradle.kts'),
	},
	{
		id: 'kotlin',
		evidence: 'AndroidManifest.xml present',
		test: (repo) =>
			hasSourceWithExtension(repo, 'AndroidManifest.xml') ||
			existsSync(join(repo, 'app/src/main/AndroidManifest.xml')),
	},
	{
		id: 'javascript',
		evidence: '*.js sources present',
		test: (repo) => hasSourceWithExtension(repo, '.js'),
	},
];

/**
 * Detect profiles for a checked-out repository. Multiple profiles may
 * apply (monorepos); results are deterministic and evidence-annotated.
 */
export function detectProfiles(repositoryPath: string): DetectedProfile[] {
	const found = new Map<ProfileId, DetectedProfile>();

	for (const signal of SIGNALS) {
		if (!signal.test(repositoryPath)) {
			continue;
		}
		const existing = found.get(signal.id);
		if (existing) {
			existing.evidence.push(signal.evidence);
		} else {
			found.set(signal.id, {
				id: signal.id,
				evidence: [signal.evidence],
			});
		}
	}

	return [...found.values()];
}

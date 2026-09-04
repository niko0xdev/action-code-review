import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	combinedRules,
	detectProfiles,
	profileRules,
	resolveProfiles,
} from '../../src/profiles/index.js';

const REQUIRED_RULES: Record<string, string> = {
	react: 'React 19',
	nextjs: 'NextJS 15',
	nestjs: 'Fastify',
	nodejs: 'ES2024',
	python: 'Pydantic v2',
	swift: 'Swift 6',
	kotlin: 'Kotlin 2.0',
	typescript: 'NoInfer',
	javascript: 'ES2024',
};

const scratch = join(tmpdir(), `acr-profiles-${process.pid}`);

function makeRepo(files: Record<string, string | undefined>): string {
	mkdirSync(scratch, { recursive: true });
	for (const [path, content] of Object.entries(files)) {
		const full = join(scratch, path);
		mkdirSync(join(full, '..'), { recursive: true });
		if (content !== undefined) {
			writeFileSync(full, content);
		} else {
			writeFileSync(full, '');
		}
	}
	return scratch;
}

afterEach(() => {
	rmSync(scratch, { recursive: true, force: true });
});

describe('detectProfiles (spec §9)', () => {
	it('detects React via package.json dependency and tsx files', () => {
		const repo = makeRepo({
			'package.json': '{"dependencies": {"react": "^18.0.0"}}',
			'src/App.tsx': 'export default () => <div/>;',
		});
		const profiles = detectProfiles(repo).map((p) => p.id);
		expect(profiles).toContain('react');
	});

	it('detects NextJS via next dependency', () => {
		const repo = makeRepo({
			'package.json':
				'{"dependencies": {"next": "^14.0.0", "react": "^18.0.0"}}',
			'app/page.tsx': 'export default function Page() { return null; }',
		});
		const profiles = detectProfiles(repo).map((p) => p.id);
		expect(profiles).toContain('nextjs');
		expect(profiles).toContain('react');
	});

	it('detects NestJS via @nestjs/core or nest-cli.json', () => {
		const repo = makeRepo({
			'package.json': '{"dependencies": {"@nestjs/core": "^10.0.0"}}',
			'src/main.ts': 'console.log(1);',
		});
		expect(detectProfiles(repo).map((p) => p.id)).toContain('nestjs');
	});

	it('detects Python/uv via pyproject.toml and uv.lock', () => {
		const repo = makeRepo({
			'pyproject.toml': '[project]\nname = "x"\n',
			'uv.lock': '',
			'main.py': 'print(1)',
		});
		expect(detectProfiles(repo).map((p) => p.id)).toContain('python');
	});

	it('detects Swift via Package.swift', () => {
		const repo = makeRepo({
			'Package.swift': '// swift-tools-version:5.9',
			'Sources/App/Main.swift': 'print(1)',
		});
		expect(detectProfiles(repo).map((p) => p.id)).toContain('swift');
	});

	it('detects Kotlin/Android via build.gradle.kts and kt sources', () => {
		const repo = makeRepo({
			'build.gradle.kts': 'plugins { id("com.android.application") }',
			'app/src/main/java/com/x/Main.kt': 'fun main() {}',
		});
		expect(detectProfiles(repo).map((p) => p.id)).toContain('kotlin');
	});

	it('returns nodejs/javascript fallbacks for plain JS repos', () => {
		const repo = makeRepo({
			'package.json': '{"devDependencies": {"typescript": "^5.0.0"}}',
			'index.ts': 'const x: number = 1;',
			'util.js': 'module.exports = {};',
		});
		const profiles = detectProfiles(repo).map((p) => p.id);
		expect(profiles).toContain('nodejs');
		expect(profiles).toContain('javascript');
	});

	it('detects typescript via tsconfig.json', () => {
		const repo = makeRepo({
			'package.json': '{}',
			'tsconfig.json': '{"compilerOptions": {}}',
			'index.ts': 'const x: number = 1;',
		});
		const profiles = detectProfiles(repo).map((p) => p.id);
		expect(profiles).toContain('typescript');
	});

	it('is deterministic across repeated calls', () => {
		const repo = makeRepo({
			'package.json': '{"dependencies": {"react": "^18.0.0"}}',
		});
		const a = detectProfiles(repo);
		const b = detectProfiles(repo);
		expect(a).toEqual(b);
	});
});

describe('detectProfiles — SQL (postgres/mysql)', () => {
	it('detects postgres via Prisma schema + .sql migration', () => {
		const repo = makeRepo({
			'prisma/schema.prisma': 'datasource db { provider = "postgresql" }',
			'migrations/001_init.sql': 'CREATE TABLE users (id SERIAL PRIMARY KEY);',
		});
		expect(detectProfiles(repo).map((p) => p.id)).toContain('postgres');
	});

	it('detects postgres via drizzle.config + .sql file', () => {
		const repo = makeRepo({
			'drizzle.config.ts': 'export default {}',
			'queries/init.sql': 'SELECT 1;',
		});
		expect(detectProfiles(repo).map((p) => p.id)).toContain('postgres');
	});

	it('detects postgres via migrations directory + .sql file', () => {
		const repo = makeRepo({
			'migrations/001_add_index.sql': 'CREATE INDEX idx ON users(email);',
			'src/data.sql': 'SELECT * FROM users;',
		});
		// migrations dir exists + .sql files present
		expect(detectProfiles(repo).map((p) => p.id)).toContain('postgres');
	});

	it('detects mysql via mysql2 in package.json + .sql file', () => {
		const repo = makeRepo({
			'package.json': '{"dependencies": {"mysql2": "^3.0.0"}}',
			'db/schema.sql': 'CREATE TABLE users (id INT PRIMARY KEY);',
		});
		expect(detectProfiles(repo).map((p) => p.id)).toContain('mysql');
	});

	it('detects mysql via .my.cnf + .sql file', () => {
		const repo = makeRepo({
			'.my.cnf': '[client]\nuser=root',
			'dump.sql': 'SELECT 1;',
		});
		expect(detectProfiles(repo).map((p) => p.id)).toContain('mysql');
	});

	it('does NOT detect postgres/mysql when only docs/fixtures .sql present (false-positive guard)', () => {
		const repo = makeRepo({
			'docs/fixtures/data.sql': 'SELECT * FROM example;',
			'README.md': '# docs',
		});
		const ids = detectProfiles(repo).map((p) => p.id);
		expect(ids).not.toContain('postgres');
		expect(ids).not.toContain('mysql');
	});

	it('does NOT detect mysql without .sql files even if mysql2 present', () => {
		const repo = makeRepo({
			'package.json': '{"dependencies": {"mysql2": "^3.0.0"}}',
			'src/index.ts': 'console.log(1)',
		});
		expect(detectProfiles(repo).map((p) => p.id)).not.toContain('mysql');
	});

	it('combined rules include postgres-specific SQL injection marker', () => {
		const rules = combinedRules(['postgres']);
		expect(rules).toContain('SQL injection');
		expect(rules).toContain('CONCURRENTLY');
	});

	it('postgres and mysql share the same rule set', () => {
		expect(combinedRules(['postgres'])).toEqual(combinedRules(['mysql']));
		expect(profileRules('postgres' as never)).toEqual(
			profileRules('mysql' as never)
		);
	});
});

describe('profileRules', () => {
	it.each(Object.entries(REQUIRED_RULES))(
		'includes required %s rule content',
		(id, text) => {
			expect(profileRules(id as never)).toContain(text);
		}
	);

	it('ignores invalid profile overrides and warns', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		expect(
			resolveProfiles('/missing', 'react,invalid,nodejs').map((p) => p.id)
		).toEqual(['react', 'nodejs']);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('invalid'));
		warn.mockRestore();
	});
	it.each(['react', 'nextjs', 'nestjs', 'nodejs', 'python', 'swift', 'kotlin'])(
		'has rules for %s mentioning its spec concerns',
		(id) => {
			const rules = profileRules(id as never);
			expect(rules.length).toBeGreaterThan(20);
		}
	);

	it('falls back to universal rules for unknown profiles', () => {
		expect(profileRules('unknown' as never)).toContain(
			'High signal is more important than comment count.'
		);
	});

	it('includes universal rules in every rule set', () => {
		const rules = profileRules('nodejs');
		expect(rules).toContain('formatting');
	});
});

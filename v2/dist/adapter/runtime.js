import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { BUILT_IN_SKILLS } from '../skills/registry.js';
export function buildPiRuntimeModelsJson(config) {
    return JSON.stringify({
        providers: {
            [config.provider]: {
                name: config.provider,
                baseUrl: config.baseUrl,
                api: 'openai-completions',
                compat: {
                    supportsDeveloperRole: false,
                    supportsReasoningEffort: false,
                },
                models: [
                    {
                        id: config.model,
                        name: config.model,
                        reasoning: false,
                        input: ['text'],
                        contextWindow: 128_000,
                        maxTokens: 16_384,
                        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                    },
                ],
            },
        },
    }, null, 2);
}
/**
 * Write built-in skill SKILL.md files for each detected profile into the
 * Pi config dir. Pi auto-discovers skills at `${PI_CODING_AGENT_DIR}/skills/`
 * recursively, so dropping one directory per profile is enough.
 *
 * Skills are progressive-disclosure: Pi loads their descriptions into the
 * system prompt (~1024 chars each), but only reads the body when the task
 * matches. The full bodies are stored as compiled-in TypeScript strings
 * (see `v2/src/skills/registry.ts`) so we ship self-contained — no external
 * file reads at action runtime.
 */
async function writeSkillsForProfiles(configDir, profiles) {
    for (const profile of profiles) {
        const content = BUILT_IN_SKILLS[profile];
        if (!content)
            continue;
        const skillDir = join(configDir, 'skills', profile);
        await mkdir(skillDir, { recursive: true });
        await writeFile(join(skillDir, 'SKILL.md'), content, 'utf8');
    }
}
export async function preparePiRuntimeConfig(config, options) {
    const configDir = await mkdtemp(join(tmpdir(), 'acr-v2-pi-'));
    try {
        await mkdir(configDir, { recursive: true });
        await writeFile(join(configDir, 'models.json'), buildPiRuntimeModelsJson(config), 'utf8');
        if (options?.profiles && options.profiles.length > 0) {
            await writeSkillsForProfiles(configDir, options.profiles);
        }
    }
    catch (error) {
        await rm(configDir, { recursive: true, force: true });
        throw error;
    }
    return {
        configDir,
        async cleanup() {
            await rm(configDir, { recursive: true, force: true });
        },
    };
}
// Re-export for tests
export { dirname };
//# sourceMappingURL=runtime.js.map
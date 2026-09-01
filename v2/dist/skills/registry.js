/**
 * Built-in skill content for each detected tech-stack profile.
 *
 * Skills are Pi's progressive-disclosure context: Pi loads their descriptions
 * at startup (small, in system prompt) and only reads the full body when a
 * task matches. Shipping these as compiled-in strings keeps the bundle
 * self-contained — no external file reads at runtime.
 *
 * Each entry is the full body of a `SKILL.md` file (frontmatter + markdown),
 * keyed by `ProfileId`. The runtime copies the relevant entries to
 * `${PI_CODING_AGENT_DIR}/skills/<id>/SKILL.md` after profile detection so
 * Pi can discover them as ordinary project skills.
 */
import javascriptSkill from './javascript.js';
import kotlinSkill from './kotlin.js';
import nestjsSkill from './nestjs.js';
import nextjsSkill from './nextjs.js';
import nodejsSkill from './nodejs.js';
import pythonSkill from './python.js';
import reactSkill from './react.js';
import swiftSkill from './swift.js';
import typescriptSkill from './typescript.js';
export const BUILT_IN_SKILLS = Object.freeze({
    react: reactSkill,
    nextjs: nextjsSkill,
    nestjs: nestjsSkill,
    nodejs: nodejsSkill,
    typescript: typescriptSkill,
    javascript: javascriptSkill,
    python: pythonSkill,
    swift: swiftSkill,
    kotlin: kotlinSkill,
});
/** All ProfileIds that have a built-in skill. */
export function profilesWithSkills() {
    return Object.keys(BUILT_IN_SKILLS);
}
//# sourceMappingURL=registry.js.map
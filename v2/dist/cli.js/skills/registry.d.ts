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
import type { ProfileId } from '../types/context.js';
export declare const BUILT_IN_SKILLS: Readonly<Partial<Record<ProfileId, string>>>;
/** All ProfileIds that have a built-in skill. */
export declare function profilesWithSkills(): ProfileId[];
//# sourceMappingURL=registry.d.ts.map
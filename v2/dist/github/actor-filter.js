export function isBotActor(actor) {
    return actor.endsWith('[bot]');
}
function normalizeActor(actor) {
    return actor.toLowerCase().replace(/\[bot\]$/, '');
}
function isAllowedBot(actor, allowedBots) {
    const trimmed = allowedBots.trim();
    if (trimmed === '*')
        return true;
    if (!trimmed)
        return false;
    const list = trimmed
        .split(',')
        .map((b) => b
        .trim()
        .toLowerCase()
        .replace(/\[bot\]$/, ''))
        .filter(Boolean);
    return list.includes(normalizeActor(actor));
}
export function matchesPattern(actor, pattern) {
    const p = pattern.trim();
    if (!p)
        return false;
    if (p === '*')
        return true;
    if (p === '*[bot]')
        return isBotActor(actor);
    if (p.endsWith('[bot]'))
        return normalizeActor(actor) === p.toLowerCase().replace(/\[bot\]$/, '');
    if (p.includes('*')) {
        const re = new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i');
        return re.test(actor);
    }
    return actor.toLowerCase() === p.toLowerCase();
}
export function isActorAllowed(actor, options) {
    if (!actor)
        return { allowed: true };
    const excludeList = (options.excludeActors ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    for (const pat of excludeList) {
        if (matchesPattern(actor, pat)) {
            return {
                allowed: false,
                reason: `actor ${actor} matched exclude-actors pattern "${pat}"`,
            };
        }
    }
    if (isBotActor(actor) && !isAllowedBot(actor, options.allowedBots ?? '')) {
        return { allowed: false, reason: `bot actor ${actor} not in allowed-bots` };
    }
    if (!isBotActor(actor) && excludeList.length === 0)
        return { allowed: true };
    // Non-bot actors not in exclude → allowed (no allowlist for humans)
    return { allowed: true };
}
//# sourceMappingURL=actor-filter.js.map
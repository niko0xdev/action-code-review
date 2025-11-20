const SPECIAL_REGEX_CHARS = /[\\^$+?.()|{}[\]]/g;

function escapeRegex(value: string): string {
        return value.replace(SPECIAL_REGEX_CHARS, '\\$&');
}

function globToRegExp(glob: string): RegExp {
        let regex = '^';

        for (let index = 0; index < glob.length; index += 1) {
                const char = glob[index];

                if (char === '*') {
                        const isGlobStar = glob[index + 1] === '*';
                        if (isGlobStar) {
                                regex += '.*';
                                index += 1;
                        } else {
                                regex += '[^/]*';
                        }
                        continue;
                }

                if (char === '?') {
                        regex += '[^/]';
                        continue;
                }

                regex += escapeRegex(char);
        }

        regex += '$';

        return new RegExp(regex);
}

export function createGlobMatcher(pattern: string): (value: string) => boolean {
        const matcher = globToRegExp(pattern);
        return (value: string) => matcher.test(value);
}

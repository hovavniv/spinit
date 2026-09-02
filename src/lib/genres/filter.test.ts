import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { filterTags } from './filter';
import { ALIASES, facetOf } from './vocabulary';

// The plan text's `new URL('./f.jsonl', import.meta.url)` cannot be used
// verbatim here: `vitest.config.ts`'s repo-wide `environment: 'jsdom'`
// replaces the global `URL` constructor with jsdom's own, which resolves a
// relative URL against `window.location` (http://localhost:3000/...)
// instead of against a file:// base -- even when `URL` is imported
// explicitly from `node:url`, since the jsdom-provided global still wins at
// this call site. `fileURLToPath(import.meta.url)` (a plain string, no `new
// URL()`) sidesteps jsdom entirely and resolves correctly.
const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '__fixtures__',
  'tags-by-name.jsonl',
);
const raw = readFileSync(fixturePath, 'utf8');

describe('filterTags', () => {
  it('drops folksonomy noise', () => {
    const out = filterTags(
      [{ name: 'pop', count: 100 }, { name: 'hairy chest', count: 4 },
       { name: 'spotify', count: 66 }, { name: 'female vocalists', count: 46 }],
      'Omer Adam', 'עומר אדם');
    expect(Object.keys(out.genres)).toEqual(['pop']);
  });

  it("drops the artist's own name, in BOTH spellings", () => {
    const out = filterTags(
      [{ name: 'ABBA', count: 4 }, { name: 'עומר אדם', count: 9 },
       { name: 'pop', count: 100 }],
      'ABBA', 'עומר אדם');
    expect(Object.keys(out.genres)).toEqual(['pop']);
  });

  it('merges aliases: r&b and rnb become ONE key, counts summed', () => {
    const out = filterTags([{ name: 'r&b', count: 52 }, { name: 'rnb', count: 3 }],
                           'Ariana Grande', null);
    expect(out.genres).toEqual({ rnb: 55 });
  });

  it('collapses israel/hebrew/jewish/isr into one origin', () => {
    const out = filterTags(
      [{ name: 'israeli', count: 100 }, { name: 'hebrew', count: 100 },
       { name: 'Israel', count: 7 }],
      'Omer Adam', null);
    expect(Object.keys(out.origins)).toEqual(['israeli']);
    expect(out.genres).toEqual({});
  });

  it('separates the three facets — israeli is an origin, 80s an era, disco a genre', () => {
    const out = filterTags(
      [{ name: 'disco', count: 72 }, { name: 'israeli', count: 50 },
       { name: '80s', count: 14 }],
      'X', null);
    expect(out.genres).toEqual({ disco: 72 });
    expect(out.origins).toEqual({ israeli: 50 });
    expect(out.eras).toEqual({ '80s': 14 });
  });

  it('matches whole tokens: roots is noise, roots reggae is a genre', () => {
    const out = filterTags([{ name: 'roots', count: 50 },
                            { name: 'roots reggae', count: 40 }], 'X', null);
    expect(out.genres).toEqual({ 'roots reggae': 40 });
  });

  it('ZERO usable genres is a SUCCESS, not a failure — the Eyal Golan case', () => {
    const out = filterTags([{ name: 'Israel', count: 100 },
                            { name: 'mizrahi', count: 100 },
                            { name: 'spotify', count: 66 }], 'Eyal Golan', null);
    expect(out.genres).toEqual({ mizrahi: 100 });
    expect(out.origins).toEqual({ israeli: 100 });
  });

  it('returns empty facets, never throws, for an artist with only noise', () => {
    const out = filterTags([{ name: 'hunks', count: 8 }], 'X', null);
    expect(out).toEqual({ genres: {}, origins: {}, eras: {} });
  });

  it('every alias target resolves to a real bucket', () => {
    const targets = Object.values(ALIASES);
    // A loop over an empty collection asserts nothing while passing. Pin that
    // it ran. NOTE: the plan text pasted `toBeGreaterThan(20)`, but the real
    // ALIASES in vocabulary.ts (committed, not touched by this task) has 13
    // entries — a threshold of 20 could never pass regardless of
    // implementation. Lowered to reflect the real vocabulary's actual size.
    expect(targets.length).toBeGreaterThan(10);
    for (const target of targets) {
      expect(facetOf(target)).not.toBeNull();
    }
  });

  it('runs over the real harvested fixture, and produces genres for most of it', () => {
    const rows = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    // Pin that the fixture actually loaded: a missing or empty file would make
    // the loop below assert nothing while staying green.
    expect(rows.length).toBe(55);
    let withGenres = 0;
    for (const row of rows) {
      const out = filterTags(row.tags, row.name, null);
      if (Object.keys(out.genres).length > 0) withGenres += 1;
    }
    // Not "does not throw" -- that passes for a function returning empties for
    // everything. The filter has to actually find genres in real harvested tags.
    expect(withGenres).toBeGreaterThan(35);
  });
});

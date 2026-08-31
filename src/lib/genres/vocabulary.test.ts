import { describe, expect, it } from 'vitest';

import { ALIASES, ERAS, GENRES, ORIGINS, facetOf, normaliseGenre } from './vocabulary';

describe('vocabulary', () => {
  it('includes Israeli genres no international taxonomy carries', () => {
    for (const g of ['mizrahi', 'israeli pop', 'israeli rock', 'hafla']) {
      expect(GENRES).toContain(g);
    }
  });

  it('is all lowercase, so matching never depends on case', () => {
    expect(GENRES.every((g) => g === g.toLowerCase())).toBe(true);
  });

  it('has no duplicates', () => {
    expect(new Set(GENRES).size).toBe(GENRES.length);
  });

  it('collapses the Israeli-adjacent aliases to one token', () => {
    for (const a of ['israel', 'hebrew', 'jewish', 'isr']) {
      expect(normaliseGenre(a)).toBe('israeli');
    }
  });

  it('files origin and era as facets, not as genres', () => {
    expect(facetOf('israeli')).toBe('origin');
    expect(facetOf('80s')).toBe('era');
    expect(facetOf('disco')).toBe('genre');
  });

  it('matches whole tokens: roots is noise, roots reggae is a genre', () => {
    expect(facetOf('roots')).toBeNull();
    expect(facetOf('roots reggae')).toBe('genre');
  });

  it('returns null for noise rather than guessing', () => {
    for (const junk of ['hairy chest', 'spotify', 'female vocalists', 'seen live']) {
      expect(facetOf(normaliseGenre(junk))).toBeNull();
    }
  });

  it('collapses rnb spellings', () => {
    expect(normaliseGenre('r&b')).toBe('rnb');
    expect(normaliseGenre('rhythm and blues')).toBe('rnb');
  });

  it('leaves an unknown tag alone rather than guessing', () => {
    expect(normaliseGenre('shoegaze')).toBe('shoegaze');
  });

  it('EVERY alias target resolves to a real bucket', () => {
    for (const target of Object.values(ALIASES)) {
      expect(facetOf(target)).not.toBeNull();
    }
  });

  it('ORIGINS and ERAS are also all lowercase, with no duplicates', () => {
    expect(ORIGINS.every((o) => o === o.toLowerCase())).toBe(true);
    expect(new Set(ORIGINS).size).toBe(ORIGINS.length);
    expect(ERAS.every((e) => e === e.toLowerCase())).toBe(true);
    expect(new Set(ERAS).size).toBe(ERAS.length);
  });
});

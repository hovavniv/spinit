import type { Reason } from './liveTypes';

/**
 * Rendering lives here, separate from rank.ts, so a copy edit to the English
 * never turns a ranking test red and a ranking change never passes just
 * because the sentence happens to still read plausibly (design §6.3).
 */
function clause(reason: Reason): string {
  switch (reason.kind) {
    case 'requesters':
      return `${reason.count} people asked for it`;
    case 'must-play-unplayed':
      return "it's still an unplayed must-play";
    case 'artist-repeat':
      return `${reason.artist} repeated ${reason.songsAgo} song${reason.songsAgo === 1 ? '' : 's'} ago`;
    case 'blocked-song':
      return `"${reason.title}" is on the do-not-play list`;
    case 'blocked-artist':
      return `${reason.artist} is on the do-not-play list`;
    case 'blocked-genre':
      return `it matches the blocked genre "${reason.genre}"`;
    case 'phase-fit':
      return reason.fits ? `it fits the ${reason.phase} phase` : `it doesn't fit the ${reason.phase} phase`;
    case 'phase-ending':
      return `only ${reason.minutesLeft} minutes left in ${reason.phase}`;
    case 'genre-pending':
      return "its genre hasn't been checked yet";
    case 'unresolvable':
      return 'this track could not be found on Spotify';
    default: {
      const exhaustive: never = reason;
      throw new Error(`Unhandled reason kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Renders at most the first three reasons -- capping so a row's why line
 * never grows into a paragraph. Ordering (by weight) is rank.ts's job; this
 * module only ever takes the first three of whatever order it's handed.
 */
export function renderReasons(reasons: Reason[]): string {
  const clauses = reasons.slice(0, 3).map(clause);

  if (clauses.length === 0) return '';
  if (clauses.length === 1) return `${clauses[0]}.`;
  if (clauses.length === 2) return `${clauses[0]}, and ${clauses[1]}.`;

  const last = clauses[clauses.length - 1];
  const rest = clauses.slice(0, -1);
  return `${rest.join(', ')}, and ${last}.`;
}

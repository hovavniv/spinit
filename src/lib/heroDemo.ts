export interface Song {
  id: number;
  title: string;
  artist: string;
  votes: number;
}

export interface HotRequest {
  id: number;
  title: string;
  requests: number;
  why: string;
}

export const seedSongs: Song[] = [
  { id: 1, title: 'Uptown Funk', artist: 'Bruno Mars', votes: 24 },
  { id: 2, title: 'September', artist: 'Earth, Wind & Fire', votes: 19 },
  { id: 3, title: 'Levitating', artist: 'Dua Lipa', votes: 12 },
  { id: 4, title: "Don't Stop Believin'", artist: 'Journey', votes: 7 },
];

export const hotRequests: HotRequest[] = [
  {
    id: 1,
    title: 'Uptown Funk',
    requests: 24,
    why: "Most requested tonight, and it's on the couple's must-play list.",
  },
  {
    id: 2,
    title: 'September',
    requests: 19,
    why: 'High demand, but held one more song — Earth, Wind & Fire played three tracks ago.',
  },
  {
    id: 3,
    title: 'Levitating',
    requests: 12,
    why: "Fits the room's energy right now, and nothing of hers has played yet.",
  },
];

export function sortByVotes(songs: Song[]): Song[] {
  return [...songs].sort((a, b) => b.votes - a.votes);
}

export function toggleExpanded(current: number | null, id: number): number | null {
  return current === id ? null : id;
}

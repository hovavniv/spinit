/* ---------------------------------------------------------------------------
   Spotify image arrays -> one URL.

   Extracted from search.ts so artwork.ts can reuse the SAME size rule rather
   than grow a second one: the search dropdown and the saved rows draw the same
   thumbnail at the same size, and two independently-written "pick an image"
   helpers is how they end up requesting different files for the same picture.

   No `import 'server-only'`: this is pure and has no credentials in it, so a
   test (or, later, a Client Component) can import it anywhere.
   --------------------------------------------------------------------------- */

export interface RawImage {
  url: string;
  width: number;
}

/**
 * Smallest image at least 64px wide, else the last image, else null.
 *
 * 64 is the floor because every thumbnail this app draws is 28-34 CSS px, so
 * a 64px source covers a 2x display exactly and anything larger is bytes the
 * page pays for and then scales away. Spotify orders `images` largest-first
 * and the small end is typically 64 for artists and 64 for album art -- but
 * that ordering is not promised, which is why this filters and reduces rather
 * than indexing the last element.
 */
export function pickArtwork(images: RawImage[] | undefined): string | null {
  if (!images || images.length === 0) return null;
  const eligible = images.filter((i) => i.width >= 64);
  if (eligible.length === 0) return images[images.length - 1].url;
  return eligible.reduce((smallest, i) => (i.width < smallest.width ? i : smallest)).url;
}

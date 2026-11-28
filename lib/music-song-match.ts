const normalized = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}]/gu, "");

/** Without an artist, retain search ranking among exact titles. */
export function matchesSharedSong(item: { title: string; artist: string }, title: string, artist?: string): boolean {
    if (!normalized(title) || normalized(item.title) !== normalized(title)) return false;
    if (!artist?.trim()) return true;
    return normalized(item.artist) === normalized(artist)
        || item.artist.split(/\s*[/、,;&]\s*/).some(name => normalized(name) === normalized(artist));
}

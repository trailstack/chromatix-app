// Tests for the track-array data pipeline that useGetTrackArray implements.
// Tracks now load in pages, so the pipeline sorts whatever has arrived instead
// of waiting for the whole library, while still filtering by library and
// excluding missing tracks.

import { sortList } from 'js/utils';

type Track = {
  trackId: string;
  libraryId: string;
  title: string;
  artist: string;
  error404?: boolean;
};

const makeTrack = (overrides: Partial<Track> = {}): Track => ({
  trackId: overrides.trackId || 'track-x',
  libraryId: 'lib-1',
  title: overrides.title || 'Track X',
  artist: 'Artist A',
  ...overrides,
});

// Simulates the data pipeline that useGetTrackArray runs:
// filter → guard → sortList
const runPipeline = (
  allTracks: Track[] | null,
  haveGotAllTracks: boolean,
  currentLibraryId: string,
  sortKey = 'title',
  direction: 'asc' | 'desc' = 'asc'
) => {
  if (!allTracks) return null;

  const filteredTracks = allTracks.filter((track) => track.libraryId === currentLibraryId && !track.error404);

  // No tracks for this library yet: keep loading unless the load has finished.
  if (!filteredTracks.length) return haveGotAllTracks ? [] : null;

  return sortList({
    entries: filteredTracks,
    options: sortKey,
    direction,
    sortNumbersFirst: false,
    ignoreLeadingArticles: true,
  });
};

describe('Testing "useGetTrackArray" data pipeline', () => {
  test('Returns null before any tracks have loaded', () => {
    expect(runPipeline(null, false, 'lib-1')).toBeNull();
  });

  test('Returns null when another library is showing and this one has not loaded', () => {
    const tracks = [makeTrack({ title: 'Other', libraryId: 'lib-2' })];
    expect(runPipeline(tracks, false, 'lib-1')).toBeNull();
  });

  test('Returns an empty list once loading finishes with no tracks for the library', () => {
    const tracks = [makeTrack({ title: 'Other', libraryId: 'lib-2' })];
    expect(runPipeline(tracks, true, 'lib-1')).toEqual([]);
  });

  test('Sorts partial data before the full library has loaded', () => {
    const tracks = [makeTrack({ title: 'Cherry' }), makeTrack({ title: 'Apple' })];
    const result = runPipeline(tracks, false, 'lib-1');
    expect(result).toHaveLength(2);
    expect(result?.[0].title).toBe('Apple');
    expect(result?.[1].title).toBe('Cherry');
  });

  test('Filters tracks to current library only', () => {
    const tracks = [makeTrack({ title: 'Same Lib' }), makeTrack({ title: 'Other Lib', libraryId: 'lib-2' })];
    const result = runPipeline(tracks, true, 'lib-1');
    expect(result).toHaveLength(1);
    expect(result?.[0].title).toBe('Same Lib');
  });

  test('Excludes tracks with error404', () => {
    const tracks = [makeTrack({ title: 'Good' }), makeTrack({ title: 'Missing', error404: true })];
    const result = runPipeline(tracks, true, 'lib-1');
    expect(result).toHaveLength(1);
    expect(result?.[0].title).toBe('Good');
  });

  test('Respects sort direction (descending)', () => {
    const tracks = [makeTrack({ title: 'A' }), makeTrack({ title: 'B' })];
    const result = runPipeline(tracks, true, 'lib-1', 'title', 'desc');
    expect(result?.[0].title).toBe('B');
    expect(result?.[1].title).toBe('A');
  });
});

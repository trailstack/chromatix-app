// Generated using Claude Code

// Scope: playback controls, queue navigation (next/prev/repeat/shuffle),
// volume handling, and the loadTrack error contract — driven through a real
// Rematch store with only the service boundaries mocked. Deliberately out of
// scope (candidates for a future suite): the LOAD TRACKS family
// (playerLoadArtist/Album/Playlist/Folder/TrackItem/TrackList — async
// bridge-fetch flows), the error effects (playerError/playerErrorPlayback/
// playerErrorNext — setTimeout + MediaError dependent), playerRefresh's
// credential retry loop, and playerLogQuit.

import { init } from '@rematch/core';

import { appModel } from './models.app';
import { playerModel } from './models.player';
import { sessionModel } from './models.session';
import { basePlayingSession, TRACKS } from './__fixtures__/playerSession';
import * as playerX from 'js/services/player';
import * as bridge from 'js/services/bridge';
import { analyticsEvent } from 'js/utils';

// ======================================================================
// MOCKS
// ======================================================================

// models.player.js drives playback through the playerX service — mocked so
// tests can assert the calls without touching audio elements.
vi.mock('js/services/player', () => ({
  init: vi.fn(),
  unload: vi.fn(),
  loadTrack: vi.fn(() => true),
  pause: vi.fn(),
  resume: vi.fn(),
  restart: vi.fn(),
  setProgress: vi.fn(),
  getCurrentProgress: vi.fn(() => 0),
  setVolume: vi.fn(),
  setGaplessEnabled: vi.fn(),
  isGaplessSupported: vi.fn(() => true),
  syncGaplessQueue: vi.fn(),
}));

// Every bridge function referenced by the three models under test, so no
// effect can accidentally hit the network.
vi.mock('js/services/bridge', () => ({
  // models.player.js
  logPlaybackPlay: vi.fn(),
  logPlaybackProgress: vi.fn(),
  logPlaybackPause: vi.fn(),
  logPlaybackStop: vi.fn(),
  logPlaybackQuit: vi.fn(),
  getAllArtistTracks: vi.fn(),
  getAlbumTracks: vi.fn(),
  getPlaylistTracks: vi.fn(),
  getFolderItems: vi.fn(),
  getAllTracks: vi.fn(),
  // models.app.js
  init: vi.fn(),
  plexLogin: vi.fn(),
  logout: vi.fn(),
  getAllUsers: vi.fn(),
  getAllServers: vi.fn(),
  getUserInfo: vi.fn(),
  getAllPlaylists: vi.fn(),
  // models.session.js
  switchUser: vi.fn(),
  abortAllRequests: vi.fn(),
  getAllLibraries: vi.fn(),
}));

// The components barrel pulls in JSX and SCSS that cannot be imported in a
// test run — only PlaybackErrorMessage is used by models.player.js.
vi.mock('js/components', () => ({
  PlaybackErrorMessage: vi.fn(() => 'error message'),
}));

// Mock the Web Notifications API. Uses a plain function with a closure
// array so we never rely on vi.fn() lifecycle — beforeEach/afterEach
// interleaving and vi.clearAllMocks() calls make vi.fn() unreliable here.
const _notificationCalls: Array<[string, NotificationOptions]> = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let MockNotificationClass: any;
let savedNotification: unknown;

// Keep the real utils (getTrackKeys, requiresTranscoding, sortList, etc.) but
// stub the analytics call so tests can assert the tracked event names.
vi.mock('js/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('js/utils')>();
  return {
    ...actual,
    analyticsEvent: vi.fn(),
  };
});

// ======================================================================
// SETUP
// ======================================================================

// Mirrors store.ts, which types the store as `any` until the models are
// converted to TypeScript.
type Store = any;

let store: Store;

// Seeds the playing session state; overrides are merged over the baseline.
const seedSession = (overrides: Record<string, unknown> = {}) => {
  store.dispatch.sessionModel.setSessionState({ ...basePlayingSession, ...overrides });
};

beforeEach(() => {
  _notificationCalls.length = 0;

  MockNotificationClass = function (title: string, options?: NotificationOptions) {
    _notificationCalls.push([title, options ?? {}]);
  } as unknown as typeof Notification;
  Object.defineProperty(MockNotificationClass.prototype, 'close', {
    value: vi.fn(),
    writable: true,
    configurable: true,
  });
  let _perm: NotificationPermission = 'granted';
  Object.defineProperty(MockNotificationClass, 'permission', {
    get: () => _perm,
    set: (val: NotificationPermission) => {
      _perm = val;
    },
    configurable: true,
  });
  savedNotification = (globalThis as any).Notification;
  Object.defineProperty(globalThis, 'Notification', {
    value: MockNotificationClass,
    writable: true,
    configurable: true,
  });
  // Also set on window in case the code checks window.Notification
  (window as any).Notification = MockNotificationClass;

  (globalThis as any).Notification.permission = 'granted';

  vi.mocked(playerX.loadTrack).mockClear().mockReturnValue(true);
  vi.mocked(playerX.getCurrentProgress).mockClear().mockReturnValue(0);
  vi.mocked(analyticsEvent).mockClear();
  // A real Rematch store with the real models, so effects dispatch into real
  // reducers and cross-model state transitions can be asserted.
  store = init({ models: { appModel, playerModel, sessionModel } });
  store.dispatch.appModel.setAppState({ currentService: 'plex' });
  // Reset dedup state — previous tests may have set _lastNotifiedTrackId
  // which would block notifications in subsequent tests.
  const playerState = store.getState().playerModel;
  playerState._lastNotifiedTrackId = null;
  playerState._lastNotificationTime = 0;
  seedSession();
});

afterAll(() => {
  Object.defineProperty(globalThis, 'Notification', {
    value: savedNotification,
    writable: true,
    configurable: true,
  });
});

// ======================================================================
// TESTS
// ======================================================================

describe('Testing "playerModel" store effects', () => {
  //
  // INITIALISE
  //

  describe('playerInit', () => {
    // playerInit registers a window beforeunload listener bound to the store
    // created for that test — swallow the registrations so listeners don't
    // accumulate on the shared jsdom window across tests.
    let addEventListenerSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      addEventListenerSpy = vi.spyOn(window, 'addEventListener').mockImplementation(() => undefined);
    });
    afterEach(() => {
      addEventListenerSpy.mockRestore();
    });

    test('Initialises the player with the saved volume state and marks it inited', () => {
      seedSession({ volumeLevel: 40, volumeMuted: true });
      store.dispatch.playerModel.playerInit();

      expect(playerX.init).toHaveBeenCalledTimes(1);
      expect(playerX.init).toHaveBeenCalledWith(
        expect.objectContaining({
          volumeLevel: 40,
          volumeMuted: true,
          onLoadStart: expect.any(Function),
          onCanPlay: expect.any(Function),
          onEnded: expect.any(Function),
          onError: expect.any(Function),
        })
      );
      expect(store.getState().playerModel.playerInited).toBe(true);
    });

    test('Auto-advances to the next track when the player reports the track has ended', () => {
      seedSession({ playingTrackIndex: 1 });
      store.dispatch.playerModel.playerInit();

      const { onEnded } = vi.mocked(playerX.init).mock.calls[0][0];
      onEnded();

      // ended -> playerNext(true) -> load the next track and play it
      expect(playerX.loadTrack).toHaveBeenCalledWith(TRACKS[2], undefined, true, 2);
      expect(store.getState().sessionModel.playingTrackIndex).toBe(2);
      expect(analyticsEvent).toHaveBeenCalledWith('Plex / Music / Next Track (Auto)');
    });
  });

  describe('playerUnload', () => {
    test('Stops playback, clears the loaded track, and unloads the player', () => {
      store.dispatch.playerModel.setPlayerState({ playerPlaying: true, playerTrackLoaded: true });
      store.dispatch.playerModel.playerUnload();

      const state = store.getState().playerModel;
      expect(state.playerPlaying).toBe(false);
      expect(state.playerTrackLoaded).toBe(false);
      expect(playerX.unload).toHaveBeenCalledTimes(1);
    });
  });

  //
  // LOAD TRACKS
  //

  describe('playerLoadIndex', () => {
    test('Loads the track at the given index and starts playback', () => {
      store.dispatch.playerModel.playerLoadIndex({ index: 1, play: true, progress: 30 });

      expect(playerX.loadTrack).toHaveBeenCalledWith(TRACKS[1], 30, true, 1);
      const state = store.getState();
      expect(state.playerModel.playerPlaying).toBe(true);
      expect(state.playerModel.playerTrackLoaded).toBe(true);
      expect(state.playerModel.playerTrackError).toBe(false);
      expect(state.sessionModel.playingTrackIndex).toBe(1);
      expect(bridge.logPlaybackPlay).toHaveBeenCalledWith(TRACKS[1], 30);
      expect(analyticsEvent).toHaveBeenCalledWith('Plex / Music / Play (Track)');
    });

    test('Loads without playing when play is false', () => {
      store.dispatch.playerModel.playerLoadIndex({ index: 1, play: false });

      expect(playerX.loadTrack).toHaveBeenCalledWith(TRACKS[1], undefined, false, 1);
      const state = store.getState();
      expect(state.playerModel.playerPlaying).toBe(false);
      expect(state.playerModel.playerTrackLoaded).toBe(true);
      expect(state.playerModel.playerTrackError).toBe(false);
      expect(state.sessionModel.playingTrackIndex).toBe(1);
      expect(bridge.logPlaybackPlay).not.toHaveBeenCalled();
    });

    test('Flags a track error when the player cannot load the track', () => {
      vi.mocked(playerX.loadTrack).mockReturnValue(false);
      store.dispatch.playerModel.playerLoadIndex({ index: 1, play: true });

      const state = store.getState();
      expect(state.playerModel.playerPlaying).toBe(false);
      expect(state.playerModel.playerTrackLoaded).toBe(true);
      expect(state.playerModel.playerTrackError).toBe(true);
      expect(state.sessionModel.playingTrackIndex).toBe(1);
    });

    test('Unloads the playing state when the queue cannot be read (legacy pre-shuffle state)', () => {
      seedSession({ playingTrackKeys: null });
      store.dispatch.playerModel.playerLoadIndex({ index: 1, play: true });

      // the catch path resets the playing session state entirely
      expect(playerX.loadTrack).not.toHaveBeenCalled();
      const state = store.getState().sessionModel;
      expect(state.playingTrackList).toBe(null);
      expect(state.playingTrackIndex).toBe(null);
    });
  });

  //
  // LOAD ALL TRACKS (tracks variant)
  //

  describe('playerLoadTracks', () => {
    // Seeds the app model with the raw (server-order) track list. The view
    // passes its own sorted entries separately, mirroring the list view.
    const seedAllTracks = (tracks: typeof TRACKS, libraryId = 'lib-1') => {
      store.dispatch.appModel.setAppState({
        currentService: 'plex',
        allTracks: tracks.map((t) => ({ ...t, libraryId })),
        haveGotAllTracks: true,
      });
      seedSession({ currentLibrary: { libraryId } });
    };

    test('Falls back to the raw track list when no sorted view list is given', async () => {
      seedAllTracks(TRACKS);

      await store.dispatch.playerModel.playerLoadTracks({
        trackIndex: 2,
        isTrack: true,
      });

      expect(playerX.loadTrack).toHaveBeenCalledWith(
        expect.objectContaining({ trackId: 'track-3', title: 'Track Three' }),
        0,
        true,
        2
      );
      expect(store.getState().sessionModel.playingVariant).toBe('tracks');
      expect(store.getState().sessionModel.playingTrackIndex).toBe(2);
    });

    test('Plays the clicked row from the sorted view list, not the raw server order', async () => {
      // Raw server order is TRACKS, but the view is sorted descending. Clicking
      // row 0 must play the first track in the sorted list (track-5) — the
      // regression where the raw order was indexed instead played track-1.
      seedAllTracks(TRACKS);
      const sortedDesc = [...TRACKS].reverse();

      await store.dispatch.playerModel.playerLoadTracks({
        playingTracks: sortedDesc,
        trackIndex: 0,
        isTrack: true,
      });

      expect(playerX.loadTrack).toHaveBeenCalledWith(
        expect.objectContaining({ trackId: 'track-5', title: 'Track Five' }),
        0,
        true,
        0
      );
      expect(store.getState().sessionModel.playingTrackIndex).toBe(0);
    });

    test('Plays the clicked row from a partially reordered view list', async () => {
      // View sorted alphabetically by title while the raw order differs.
      seedAllTracks(TRACKS);
      const sortedByTitle = [TRACKS[3], TRACKS[0], TRACKS[4], TRACKS[2], TRACKS[1]];

      await store.dispatch.playerModel.playerLoadTracks({
        playingTracks: sortedByTitle,
        trackIndex: 3,
        isTrack: true,
      });

      expect(playerX.loadTrack).toHaveBeenCalledWith(expect.objectContaining({ trackId: 'track-3' }), 0, true, 3);
      expect(store.getState().sessionModel.playingTrackIndex).toBe(3);
    });

    test('Stores the provided sorted list and sequential keys in session state', async () => {
      seedAllTracks(TRACKS);
      const sortedDesc = [...TRACKS].reverse();

      await store.dispatch.playerModel.playerLoadTracks({
        playingTracks: sortedDesc,
        trackIndex: 0,
        isTrack: true,
      });

      const state = store.getState().sessionModel;
      expect(state.playingTrackList?.map((t: { trackId: string }) => t.trackId)).toEqual([
        'track-5',
        'track-4',
        'track-3',
        'track-2',
        'track-1',
      ]);
      expect(state.playingTrackCount).toBe(5);
      expect(state.playingTrackKeys).toEqual([0, 1, 2, 3, 4]);
    });

    test('Falls back to the raw list filtered to the current library', async () => {
      store.dispatch.appModel.setAppState({
        currentService: 'plex',
        haveGotAllTracks: true,
        allTracks: [
          ...TRACKS.slice(0, 3).map((t) => ({ ...t, libraryId: 'lib-1' })),
          { ...TRACKS[3], libraryId: 'lib-2' },
        ],
      });
      seedSession({ currentLibrary: { libraryId: 'lib-1' } });

      await store.dispatch.playerModel.playerLoadTracks({
        trackIndex: 1,
        isTrack: true,
      });

      const state = store.getState().sessionModel;
      expect(state.playingTrackList).toHaveLength(3);
      expect(state.playingTrackList?.map((t: { trackId: string }) => t.trackId)).toEqual([
        'track-1',
        'track-2',
        'track-3',
      ]);
    });

    test('Passes shuffle flag to session state and starts with the clicked track', async () => {
      seedAllTracks(TRACKS);
      store.dispatch.sessionModel.setSessionState({ playingShuffle: true });

      await store.dispatch.playerModel.playerLoadTracks({
        playingTracks: TRACKS,
        trackIndex: 2,
        isTrack: true,
      });

      const state = store.getState().sessionModel;
      expect(state.playingShuffle).toBe(true);
      // Shuffle puts the clicked track first, so the loaded track is the clicked one.
      expect(playerX.loadTrack).toHaveBeenCalledWith(expect.objectContaining({ trackId: 'track-3' }), 0, true, 0);
    });
  });

  //
  // EXTEND THE QUEUE AS TRACK PAGES LOAD (tracks variant)
  //

  describe('playerSyncTrackList', () => {
    // Seeds a tracks-view queue for server-1 / lib-1 with the given rows.
    const seedPlayingQueue = (tracks: typeof TRACKS, overrides: Record<string, unknown> = {}) => {
      seedSession({
        playingVariant: 'tracks',
        playingServerId: 'server-1',
        playingLibraryId: 'lib-1',
        currentServer: { serverId: 'server-1' },
        currentLibrary: { libraryId: 'lib-1' },
        playingTrackList: tracks,
        playingTrackKeys: tracks.map((_track, index) => index),
        playingTrackIndex: 0,
        playingTrackCount: tracks.length,
        ...overrides,
      });
    };

    test('Extends the queue with newly loaded tracks, keeping the current one', () => {
      seedPlayingQueue(TRACKS.slice(0, 2), { playingTrackIndex: 1 });

      store.dispatch.playerModel.playerSyncTrackList({ playingTracks: TRACKS });

      const state = store.getState().sessionModel;
      expect(state.playingTrackList.map((t: { trackId: string }) => t.trackId)).toEqual([
        'track-1',
        'track-2',
        'track-3',
        'track-4',
        'track-5',
      ]);
      expect(state.playingTrackKeys).toEqual([0, 1, 2, 3, 4]);
      expect(state.playingTrackIndex).toBe(1);
      expect(state.playingTrackCount).toBe(5);
      expect(playerX.loadTrack).not.toHaveBeenCalled();
    });

    test('Re-maps the current position when new tracks sort before it', () => {
      // Partial view: sorted rows so far put track-4 at row 1.
      seedPlayingQueue([TRACKS[1], TRACKS[3]], { playingTrackIndex: 1 });

      store.dispatch.playerModel.playerSyncTrackList({ playingTracks: TRACKS });

      const state = store.getState().sessionModel;
      expect(state.playingTrackIndex).toBe(3);
      expect(state.playingTrackList[state.playingTrackKeys[state.playingTrackIndex]].trackId).toBe('track-4');
    });

    test('Preserves the shuffled order and appends new tracks at the end', () => {
      // Shuffle started on track-2, then track-1.
      seedPlayingQueue(TRACKS.slice(0, 2), {
        playingShuffle: true,
        playingTrackKeys: [1, 0],
        playingTrackIndex: 0,
      });

      store.dispatch.playerModel.playerSyncTrackList({ playingTracks: TRACKS.slice(0, 3) });

      const state = store.getState().sessionModel;
      expect(state.playingTrackKeys).toEqual([1, 0, 2]);
      expect(state.playingTrackIndex).toBe(0);
    });

    test('Ignores lists that have not grown', () => {
      seedPlayingQueue(TRACKS);

      store.dispatch.playerModel.playerSyncTrackList({ playingTracks: TRACKS });

      expect(store.getState().sessionModel.playingTrackList).toBe(TRACKS);
    });

    test('Ignores queues from another source variant', () => {
      seedPlayingQueue(TRACKS.slice(0, 2), { playingVariant: 'album' });

      store.dispatch.playerModel.playerSyncTrackList({ playingTracks: TRACKS });

      expect(store.getState().sessionModel.playingTrackList).toHaveLength(2);
    });

    test('Ignores a queue belonging to another library', () => {
      seedPlayingQueue(TRACKS.slice(0, 2), {
        currentLibrary: { libraryId: 'lib-2' },
      });

      store.dispatch.playerModel.playerSyncTrackList({ playingTracks: TRACKS });

      expect(store.getState().sessionModel.playingTrackList).toHaveLength(2);
    });

    test('Leaves the queue alone when the current track is no longer in the list', () => {
      seedPlayingQueue([TRACKS[1], TRACKS[3]], { playingTrackIndex: 1 });

      store.dispatch.playerModel.playerSyncTrackList({
        playingTracks: TRACKS.filter((track) => track.trackId !== 'track-4'),
      });

      const state = store.getState().sessionModel;
      expect(state.playingTrackList).toHaveLength(2);
      expect(state.playingTrackIndex).toBe(1);
    });
  });

  //
  // PLAYER CONTROLS
  //

  describe('playerResume', () => {
    test('Resumes playback and logs the resume to the server', () => {
      seedSession({ playingTrackIndex: 1, playingTrackProgress: 30 });
      store.dispatch.playerModel.playerResume();

      expect(playerX.resume).toHaveBeenCalledTimes(1);
      expect(store.getState().playerModel.playerPlaying).toBe(true);
      expect(bridge.logPlaybackPlay).toHaveBeenCalledWith(TRACKS[1], 30);
      expect(analyticsEvent).toHaveBeenCalledWith('Plex / Music / Play (Resume)');
    });

    test('Reloads the current track instead of resuming after a track error', () => {
      seedSession({ playingTrackIndex: 1 });
      store.dispatch.playerModel.setPlayerState({ playerTrackError: true });
      store.dispatch.playerModel.playerResume();

      expect(playerX.resume).not.toHaveBeenCalled();
      expect(playerX.loadTrack).toHaveBeenCalledWith(TRACKS[1], undefined, true, 1);
      const state = store.getState().playerModel;
      expect(state.playerPlaying).toBe(true);
      expect(state.playerTrackError).toBe(false);
    });
  });

  describe('playerPause', () => {
    test('Pauses the player and logs the pause when playing', () => {
      seedSession({ playingTrackIndex: 1, playingTrackProgress: 30 });
      store.dispatch.playerModel.setPlayerState({ playerPlaying: true });
      store.dispatch.playerModel.playerPause();

      expect(playerX.pause).toHaveBeenCalledTimes(1);
      expect(store.getState().playerModel.playerPlaying).toBe(false);
      expect(bridge.logPlaybackPause).toHaveBeenCalledWith(TRACKS[1], 30);
      expect(analyticsEvent).toHaveBeenCalledWith('Plex / Music / Pause');
    });

    test('Still pauses the player but does not log when already paused', () => {
      store.dispatch.playerModel.playerPause();

      expect(playerX.pause).toHaveBeenCalledTimes(1);
      expect(bridge.logPlaybackPause).not.toHaveBeenCalled();
      expect(analyticsEvent).not.toHaveBeenCalled();
    });
  });

  describe('playerProgress', () => {
    test('Stores progress and logs it to the server while playing', () => {
      seedSession({ playingTrackIndex: 1 });
      store.dispatch.playerModel.setPlayerState({ playerPlaying: true });
      store.dispatch.playerModel.playerProgress(120);

      expect(store.getState().sessionModel.playingTrackProgress).toBe(120);
      expect(bridge.logPlaybackProgress).toHaveBeenCalledWith(TRACKS[1], 120);
    });

    test('Ignores progress updates while paused', () => {
      store.dispatch.playerModel.playerProgress(120);

      expect(store.getState().sessionModel.playingTrackProgress).toBe(0);
      expect(bridge.logPlaybackProgress).not.toHaveBeenCalled();
    });
  });

  describe('playerPrev', () => {
    test('Restarts the current track when progress is greater than 5 seconds', () => {
      seedSession({ playingTrackIndex: 2 });
      vi.mocked(playerX.getCurrentProgress).mockReturnValue(42);
      store.dispatch.playerModel.playerPrev();

      expect(playerX.restart).toHaveBeenCalledTimes(1);
      expect(playerX.loadTrack).not.toHaveBeenCalled();
      const state = store.getState();
      expect(state.sessionModel.playingTrackIndex).toBe(2);
      expect(state.playerModel.playerPlaying).toBe(true);
      expect(state.playerModel.playerInteractionCount).toBe(1);
      expect(analyticsEvent).toHaveBeenCalledWith('Plex / Music / Restart Track');
    });

    test('Loads the previous track when progress is 5 seconds or less', () => {
      seedSession({ playingTrackIndex: 2 });
      vi.mocked(playerX.getCurrentProgress).mockReturnValue(3);
      store.dispatch.playerModel.playerPrev();

      expect(playerX.restart).not.toHaveBeenCalled();
      expect(playerX.loadTrack).toHaveBeenCalledWith(TRACKS[1], undefined, true, 1);
      expect(store.getState().sessionModel.playingTrackIndex).toBe(1);
      expect(analyticsEvent).toHaveBeenCalledWith('Plex / Music / Previous Track');
    });

    test('Wraps to the last track when at track 0 with repeat all', () => {
      seedSession({ playingTrackIndex: 0, playingRepeatAll: true });
      store.dispatch.playerModel.playerPrev();

      expect(playerX.loadTrack).toHaveBeenCalledWith(TRACKS[4], undefined, true, 4);
      expect(store.getState().sessionModel.playingTrackIndex).toBe(4);
      expect(store.getState().playerModel.playerPlaying).toBe(true);
    });

    test('Restarts the current track when at track 0 without repeat all', () => {
      seedSession({ playingTrackIndex: 0 });
      store.dispatch.playerModel.playerPrev();

      expect(playerX.restart).toHaveBeenCalledTimes(1);
      expect(playerX.loadTrack).not.toHaveBeenCalled();
      expect(store.getState().sessionModel.playingTrackIndex).toBe(0);
    });
  });

  describe('playerNext', () => {
    test('Manual next advances to the next track and plays it', () => {
      seedSession({ playingTrackIndex: 1 });
      store.dispatch.playerModel.playerNext();

      expect(playerX.loadTrack).toHaveBeenCalledTimes(1);
      expect(playerX.loadTrack).toHaveBeenCalledWith(TRACKS[2], undefined, true, 2);
      const state = store.getState();
      expect(state.sessionModel.playingTrackIndex).toBe(2);
      expect(state.playerModel.playerPlaying).toBe(true);
      expect(state.playerModel.playerTrackLoaded).toBe(true);
      expect(state.playerModel.playerTrackError).toBe(false);
      expect(bridge.logPlaybackPlay).toHaveBeenCalledWith(TRACKS[2], undefined);
      expect(analyticsEvent).toHaveBeenCalledWith('Plex / Music / Next Track');
    });

    test('Manual next at the last track without repeat loads track 0 without playing and logs a stop', () => {
      seedSession({ playingTrackIndex: 4 });
      store.dispatch.playerModel.playerNext();

      expect(playerX.loadTrack).toHaveBeenCalledWith(TRACKS[0], undefined, false, 0);
      const state = store.getState();
      expect(state.sessionModel.playingTrackIndex).toBe(0);
      expect(state.playerModel.playerPlaying).toBe(false);
      expect(bridge.logPlaybackStop).toHaveBeenCalledWith(TRACKS[4]);
      expect(bridge.logPlaybackPlay).not.toHaveBeenCalled();
    });

    test('Manual next at the last track with repeat all wraps to track 0 and plays it', () => {
      seedSession({ playingTrackIndex: 4, playingRepeatAll: true });
      store.dispatch.playerModel.playerNext();

      expect(playerX.loadTrack).toHaveBeenCalledWith(TRACKS[0], undefined, true, 0);
      const state = store.getState();
      expect(state.sessionModel.playingTrackIndex).toBe(0);
      expect(state.playerModel.playerPlaying).toBe(true);
      expect(bridge.logPlaybackStop).not.toHaveBeenCalled();
      expect(analyticsEvent).toHaveBeenCalledWith('Plex / Music / Next Track (Restart)');
    });

    test('Auto next (track ended) with repeat once reloads the same track', () => {
      seedSession({ playingTrackIndex: 2, playingRepeatOnce: true });
      store.dispatch.playerModel.playerNext(true);

      expect(playerX.loadTrack).toHaveBeenCalledWith(TRACKS[2], undefined, true, 2);
      const state = store.getState().sessionModel;
      expect(state.playingTrackIndex).toBe(2);
      // repeat once is only cleared when the track index actually changes
      expect(state.playingRepeatOnce).toBe(true);
      expect(analyticsEvent).toHaveBeenCalledWith('Plex / Music / Next Track (Repeat Once) (Auto)');
    });

    test('Manual next with repeat once skips to the next track and reverts repeat once to repeat all', () => {
      seedSession({ playingTrackIndex: 1, playingRepeatOnce: true });
      store.dispatch.playerModel.playerNext();

      expect(playerX.loadTrack).toHaveBeenCalledWith(TRACKS[2], undefined, true, 2);
      const state = store.getState().sessionModel;
      expect(state.playingTrackIndex).toBe(2);
      // disableRepeatOnceOnTrackChange (default on) clears repeat once, and
      // revertRepeatOnceToRepeatAll (default on) re-enables repeat all
      expect(state.playingRepeatOnce).toBe(false);
      expect(state.playingRepeatAll).toBe(true);
    });
  });

  describe('playerRepeatToggle', () => {
    test('Cycles repeat from off to all to once to off', () => {
      // off -> repeat all
      store.dispatch.playerModel.playerRepeatToggle();
      let state = store.getState().sessionModel;
      expect(state.playingRepeatAll).toBe(true);
      expect(state.playingRepeatOnce).toBe(false);
      expect(analyticsEvent).toHaveBeenLastCalledWith('Plex / Music / Repeat All');

      // repeat all -> repeat once
      store.dispatch.playerModel.playerRepeatToggle();
      state = store.getState().sessionModel;
      expect(state.playingRepeatAll).toBe(false);
      expect(state.playingRepeatOnce).toBe(true);
      expect(analyticsEvent).toHaveBeenLastCalledWith('Plex / Music / Repeat Once');

      // repeat once -> off
      store.dispatch.playerModel.playerRepeatToggle();
      state = store.getState().sessionModel;
      expect(state.playingRepeatAll).toBe(false);
      expect(state.playingRepeatOnce).toBe(false);
      expect(analyticsEvent).toHaveBeenLastCalledWith('Plex / Music / Repeat Off');
    });
  });

  describe('playerShuffleToggle', () => {
    test('Shuffle on recomputes the track keys keeping the playing track at the new index', () => {
      seedSession({ playingTrackIndex: 2 });
      store.dispatch.playerModel.playerShuffleToggle();

      const state = store.getState().sessionModel;
      expect(state.playingShuffle).toBe(true);
      // the new keys are a permutation of all five tracks
      expect([...state.playingTrackKeys].sort((a: number, b: number) => a - b)).toEqual([0, 1, 2, 3, 4]);
      // the entry at the new index is still the real track that was playing (real index 2)
      expect(state.playingTrackKeys[state.playingTrackIndex]).toBe(2);
      // getTrackKeys pins the playing track to the front of a fresh shuffle
      expect(state.playingTrackIndex).toBe(0);
      expect(analyticsEvent).toHaveBeenCalledWith('Plex / Music / Shuffle On');
    });

    test('Shuffle off restores sequential keys and repositions the playing track', () => {
      seedSession({ playingShuffle: true, playingTrackKeys: [3, 0, 2, 4, 1], playingTrackIndex: 2 });
      store.dispatch.playerModel.playerShuffleToggle();

      const state = store.getState().sessionModel;
      expect(state.playingShuffle).toBe(false);
      expect(state.playingTrackKeys).toEqual([0, 1, 2, 3, 4]);
      // real track 2 was playing (keys[2] of the shuffled order) and remains selected
      expect(state.playingTrackIndex).toBe(2);
      expect(analyticsEvent).toHaveBeenCalledWith('Plex / Music / Shuffle Off');
    });
  });

  //
  // VOLUME CONTROLS
  //

  describe('volumeRefresh', () => {
    test('Applies the saved volume level to the player', () => {
      seedSession({ volumeLevel: 60, volumeMuted: false });
      store.dispatch.playerModel.volumeRefresh();

      expect(playerX.setVolume).toHaveBeenCalledWith(60);
    });

    test('Applies a volume of 0 to the player when muted', () => {
      seedSession({ volumeLevel: 60, volumeMuted: true });
      store.dispatch.playerModel.volumeRefresh();

      expect(playerX.setVolume).toHaveBeenCalledWith(0);
    });
  });

  describe('volumeLevelSet', () => {
    test('Sets the volume level, unmutes, and updates the player volume', () => {
      seedSession({ volumeLevel: 10, volumeMuted: true });
      store.dispatch.playerModel.volumeLevelSet(30);

      const state = store.getState().sessionModel;
      expect(state.volumeLevel).toBe(30);
      expect(state.volumeMuted).toBe(false);
      expect(playerX.setVolume).toHaveBeenCalledWith(30);
    });
  });

  describe('volumeMuteToggle', () => {
    test('Unmutes and restores the default volume when muted at volume 0', () => {
      seedSession({ volumeMuted: true, volumeLevel: 0 });
      store.dispatch.playerModel.volumeMuteToggle();

      const state = store.getState().sessionModel;
      expect(state.volumeLevel).toBe(75);
      expect(state.volumeMuted).toBe(false);
      expect(playerX.setVolume).toHaveBeenCalledWith(75);
      expect(analyticsEvent).toHaveBeenCalledWith('Plex / Music / Mute Off');
    });

    test('Unmutes and keeps the saved volume when muted at a non-zero volume', () => {
      seedSession({ volumeMuted: true, volumeLevel: 60 });
      store.dispatch.playerModel.volumeMuteToggle();

      const state = store.getState().sessionModel;
      expect(state.volumeLevel).toBe(60);
      expect(state.volumeMuted).toBe(false);
      expect(playerX.setVolume).toHaveBeenCalledWith(60);
      expect(analyticsEvent).toHaveBeenCalledWith('Plex / Music / Mute Off');
    });

    test('Unmutes and restores the default volume when unmuted at volume 0', () => {
      seedSession({ volumeMuted: false, volumeLevel: 0 });
      store.dispatch.playerModel.volumeMuteToggle();

      const state = store.getState().sessionModel;
      expect(state.volumeLevel).toBe(75);
      expect(state.volumeMuted).toBe(false);
      expect(playerX.setVolume).toHaveBeenCalledWith(75);
      expect(analyticsEvent).toHaveBeenCalledWith('Plex / Music / Mute Off');
    });

    test('Mutes when unmuted at a non-zero volume', () => {
      seedSession({ volumeMuted: false, volumeLevel: 60 });
      store.dispatch.playerModel.volumeMuteToggle();

      const state = store.getState().sessionModel;
      expect(state.volumeLevel).toBe(60);
      expect(state.volumeMuted).toBe(true);
      expect(playerX.setVolume).toHaveBeenCalledWith(0);
      expect(analyticsEvent).toHaveBeenCalledWith('Plex / Music / Mute On');
    });
  });

  //
  // TRACK NOTIFICATIONS
  //

  describe('playerShowNotification', () => {
    test('Fires a notification when the setting is enabled and the track changes', () => {
      seedSession({
        optionShowTrackNotification: true,
        playingTrackIndex: 0,
        playingTrackList: TRACKS,
        playingTrackKeys: [0, 1],
      });

      store.dispatch.playerModel.playerShowNotification({ track: TRACKS[1] });

      expect(_notificationCalls).toHaveLength(1);
      expect(_notificationCalls[0]).toEqual([
        'Track Two',
        { body: 'Artist One', icon: undefined, tag: 'chromatix-track-notification' },
      ]);
    });

    test('Does not fire when the setting is disabled', () => {
      seedSession({
        optionShowTrackNotification: false,
      });

      store.dispatch.playerModel.playerShowNotification({ track: TRACKS[0] });

      expect(_notificationCalls).toHaveLength(0);
    });

    test('Does not fire when no track is provided', () => {
      seedSession({ optionShowTrackNotification: true });

      store.dispatch.playerModel.playerShowNotification({});

      expect(_notificationCalls).toHaveLength(0);
    });

    test('Does not fire for the same track within the cooldown window', () => {
      seedSession({ optionShowTrackNotification: true });

      store.dispatch.playerModel.playerShowNotification({ track: TRACKS[0] });
      store.dispatch.playerModel.playerShowNotification({ track: TRACKS[0] });

      expect(_notificationCalls).toHaveLength(1);
    });

    test('Fires for the same track after the cooldown expires', () => {
      seedSession({ optionShowTrackNotification: true });

      vi.useFakeTimers();
      store.dispatch.playerModel.playerShowNotification({ track: TRACKS[0] });
      vi.advanceTimersByTime(3001);
      store.dispatch.playerModel.playerShowNotification({ track: TRACKS[0] });
      vi.useRealTimers();

      expect(_notificationCalls).toHaveLength(2);
    });

    test('Uses trackId for deduplication', () => {
      seedSession({ optionShowTrackNotification: true });

      store.dispatch.playerModel.playerShowNotification({ track: { id: 'x', trackId: '123', title: 'T1' } });
      store.dispatch.playerModel.playerShowNotification({ track: { id: 'y', trackId: '123', title: 'T2' } });

      expect(_notificationCalls).toHaveLength(1);
    });

    test('Does not fire when Notification permission is denied', () => {
      seedSession({ optionShowTrackNotification: true });
      (globalThis as any).Notification.permission = 'denied';

      store.dispatch.playerModel.playerShowNotification({ track: TRACKS[0] });

      expect(_notificationCalls).toHaveLength(0);
    });

    test('Does not fire when the Notification API is unavailable', () => {
      seedSession({ optionShowTrackNotification: true });
      const saved = (globalThis as any).Notification;
      const savedWindow = (window as any).Notification;
      delete (globalThis as any).Notification;
      delete (window as any).Notification;

      store.dispatch.playerModel.playerShowNotification({ track: TRACKS[0] });

      expect(_notificationCalls).toHaveLength(0);
      (globalThis as any).Notification = saved;
      (window as any).Notification = savedWindow;
    });

    test('Includes album artwork as the notification icon', () => {
      seedSession({ optionShowTrackNotification: true });

      const trackWithArt = { ...TRACKS[0], thumbMd: 'https://server.local/thumb.jpg' };
      store.dispatch.playerModel.playerShowNotification({ track: trackWithArt });

      expect(_notificationCalls).toHaveLength(1);
      expect(_notificationCalls[0]).toEqual([
        'Track One',
        { body: 'Artist One', icon: 'https://server.local/thumb.jpg', tag: 'chromatix-track-notification' },
      ]);
    });

    test('Uses track.id when trackId is missing', () => {
      seedSession({ optionShowTrackNotification: true });

      store.dispatch.playerModel.playerShowNotification({ track: { id: 'track-a', title: 'T1' } });
      store.dispatch.playerModel.playerShowNotification({ track: { id: 'track-a', title: 'T2' } });

      expect(_notificationCalls).toHaveLength(1);
    });

    test('Defaults title to "Unknown Track" when title is missing', () => {
      seedSession({ optionShowTrackNotification: true });

      store.dispatch.playerModel.playerShowNotification({ track: { trackId: 'x' } });

      expect(_notificationCalls[0]).toEqual([
        'Unknown Track',
        { body: undefined, icon: undefined, tag: 'chromatix-track-notification' },
      ]);
    });
  });

  describe('playerLoadTrackList notification', () => {
    test('Fires a notification when a new track list is loaded', () => {
      seedSession();

      store.dispatch.playerModel.playerLoadTrackList({
        playingVariant: 'tracks',
        playingTrackIndex: 0,
        playingTrackKeys: [0],
        playingTrackList: [TRACKS[0]],
        playingTrackCount: 1,
        playingTrackProgress: 0,
      });

      expect(_notificationCalls).toHaveLength(1);
    });

    test('Does not fire a second notification when playerLoadIndex is also called', () => {
      seedSession({
        optionShowTrackNotification: true,
        playingVariant: 'tracks',
        playingTrackIndex: 0,
        playingTrackKeys: [0],
        playingTrackList: [TRACKS[0]],
        playingTrackCount: 1,
      });

      // playerLoadTrackList fires first
      store.dispatch.playerModel.playerLoadTrackList({
        playingVariant: 'tracks',
        playingTrackIndex: 0,
        playingTrackKeys: [0],
        playingTrackList: [TRACKS[0]],
        playingTrackCount: 1,
        playingTrackProgress: 0,
      });

      // playerLoadIndex would normally fire again for the same track,
      // but the dedup cooldown prevents it
      store.dispatch.playerModel.playerLoadIndex({ index: 0, play: true });

      expect(_notificationCalls).toHaveLength(1);
    });
  });

  describe('playerPrev notification', () => {
    test('Fires a notification when going to the previous track', () => {
      seedSession({ playingTrackIndex: 2 });
      vi.mocked(playerX.getCurrentProgress).mockReturnValue(0);

      store.dispatch.playerModel.playerPrev();

      expect(_notificationCalls).toHaveLength(1);
    });

    test('Fires a notification when wrapping to the last track with repeat all', () => {
      seedSession({ playingTrackIndex: 0, playingRepeatAll: true });
      vi.mocked(playerX.getCurrentProgress).mockReturnValue(0);

      store.dispatch.playerModel.playerPrev();

      expect(_notificationCalls).toHaveLength(1);
    });
  });

  describe('playerNext notification', () => {
    test('Fires a notification when advancing to the next track', () => {
      seedSession({ playingTrackIndex: 1 });

      store.dispatch.playerModel.playerNext();

      expect(_notificationCalls).toHaveLength(1);
    });

    test('Fires a notification when wrapping to the first track with repeat all', () => {
      seedSession({ playingTrackIndex: 4, playingRepeatAll: true });

      store.dispatch.playerModel.playerNext();

      expect(_notificationCalls).toHaveLength(1);
    });

    test('Does not fire a notification for repeat-once (same track)', () => {
      seedSession({ playingTrackIndex: 2, playingRepeatOnce: true });

      store.dispatch.playerModel.playerNext(true);

      expect(_notificationCalls).toHaveLength(0);
    });

    test('Does not fire a notification when loading without playing', () => {
      seedSession({ playingTrackIndex: 4 });

      store.dispatch.playerModel.playerNext();

      // The "no playing" branch doesn't call playerShowNotification
      expect(_notificationCalls).toHaveLength(0);
    });
  });

  describe('playerSeamAdvance notification', () => {
    test('Fires a notification when the gapless engine advances', () => {
      seedSession({
        playingTrackIndex: 0,
        playingTrackList: TRACKS,
        playingTrackKeys: [0, 1, 2],
      });

      store.dispatch.playerModel.playerSeamAdvance({ index: 1 });

      expect(_notificationCalls).toHaveLength(1);
    });
  });
});

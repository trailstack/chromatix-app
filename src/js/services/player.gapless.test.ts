import { vi } from 'vitest';
import type { GaplessQueueEntry, GaplessQueueFlags } from 'types/player';

// Shared mock state — survives vi.resetModules() because hoisted in the test
// file's scope. vi.doMock('gapless', ...) in beforeEach re-establishes the
// mock factory to point to this same Queue class.
const gaplessShared = vi.hoisted(() => {
  const instances: any[] = [];
  class FakeQueue {
    options: any;
    currentTrack: any;
    constructor(options: any) {
      this.options = options;
      this.currentTrack = null;
      instances.push(this);
    }
    play = vi.fn();
    pause = vi.fn();
    seek = vi.fn();
    gotoTrack = vi.fn();
    setVolume = vi.fn();
    addTrack = vi.fn();
    removeTrack = vi.fn();
    destroy = vi.fn();
    resumeAudioContext = vi.fn(() => Promise.resolve());
  }
  return { instances, FakeQueue };
});

async function freshGapless() {
  const mod = await import('./player.gapless');
  return mod;
}
type Gapless = Awaited<ReturnType<typeof freshGapless>>;

const nativeAudioProto = Object.getPrototypeOf(document.createElement('audio')) as HTMLAudioElement;
const mockCanPlayType = () => {
  vi.spyOn(nativeAudioProto, 'canPlayType').mockImplementation((mime: string) =>
    mime === 'audio/x-ms-wma' ? '' : 'probably'
  );
};
const makeEntry = (qi: number, codec = 'flac'): GaplessQueueEntry => ({
  src: `http://example.com/track${qi}.${codec}`,
  codec,
  queueIndex: qi,
  title: `Track ${qi}`,
  artist: `Artist ${qi}`,
  album: `Album ${qi}`,
  thumbMd: `http://example.com/thumb${qi}.jpg`,
});
const makeEntries = (n: number) => Array.from({ length: n }, (_, i) => makeEntry(i));
const trackFromEntry = (e: GaplessQueueEntry) => ({ src: e.src, codec: e.codec, title: e.title });
const noRepeat: GaplessQueueFlags = { repeatOnce: false, repeatAll: false };
const expectedMetadata = (e: GaplessQueueEntry) => ({
  title: e.title,
  artist: e.artist,
  album: e.album,
  ...(e.thumbMd ? { artwork: [{ src: e.thumbMd }] } : {}),
});
const createCallbacks = () => ({
  volumeLevel: 100,
  volumeMuted: false,
  onLoadStart: vi.fn(),
  onCanPlay: vi.fn(),
  onEnded: vi.fn(),
  onError: vi.fn(),
  onGaplessSeamAdvance: vi.fn(),
  onGaplessError: vi.fn(),
  onGaplessPlayBlocked: vi.fn(),
});

describe('Gapless Player Service', () => {
  let gapless: Gapless;
  let callbacks: ReturnType<typeof createCallbacks>;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('gapless', () => ({ Queue: gaplessShared.FakeQueue }));
    gaplessShared.instances.length = 0;
    (window as any).AudioContext = class {};
    mockCanPlayType();
    gapless = await freshGapless();
    callbacks = createCallbacks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as any).AudioContext;
  });

  const setupQueue = (entries: GaplessQueueEntry[], flags: GaplessQueueFlags = noRepeat) => {
    gapless.init(callbacks);
    gapless.setEnabled(true);
    gapless.syncQueue(entries, flags);
    return entries;
  };

  describe('isSupported()', () => {
    test('Returns false when the Web Audio API is unavailable', () => {
      delete (window as any).AudioContext;
      expect(gapless.isSupported()).toBe(false);
    });
    test('Returns true when AudioContext exists and the platform is not iOS', () => {
      expect(gapless.isSupported()).toBe(true);
    });
  });

  describe('canPlay()', () => {
    test('Returns false while the gapless setting is disabled', () => {
      const entries = makeEntries(3);
      gapless.init(callbacks);
      gapless.syncQueue(entries, noRepeat);
      expect(gapless.canPlay(trackFromEntry(entries[0]), 0)).toBe(false);
    });
    test('Returns false when no queueIndex is provided', () => {
      const entries = setupQueue(makeEntries(3));
      expect(gapless.canPlay(trackFromEntry(entries[0]))).toBe(false);
      expect(gapless.canPlay(trackFromEntry(entries[0]), undefined)).toBe(false);
    });
    test('Returns false for a codec that requires transcoding', () => {
      const entries = [makeEntry(0), makeEntry(1, 'wma'), makeEntry(2)];
      setupQueue(entries);
      expect(gapless.canPlay(trackFromEntry(entries[1]), 1)).toBe(false);
    });
    test('Returns false when the track does not match the queue position', () => {
      const entries = setupQueue(makeEntries(3));
      expect(gapless.canPlay(trackFromEntry(entries[0]), 1)).toBe(false);
      expect(gapless.canPlay({ src: 'http://example.com/other.flac', codec: 'flac' }, 0)).toBe(false);
    });
    test('Returns true for a direct-play track at its mirrored queue position', () => {
      const entries = setupQueue(makeEntries(3));
      expect(gapless.canPlay(trackFromEntry(entries[0]), 0)).toBe(true);
      expect(gapless.canPlay(trackFromEntry(entries[2]), 2)).toBe(true);
    });
  });

  describe('loadTrack() window construction', () => {
    test('Builds a Queue with the [current, next, next2] window in queue order', () => {
      const entries = setupQueue(makeEntries(4));
      const loaded = gapless.loadTrack(trackFromEntry(entries[0]), 0, true, 0);
      expect(loaded).toBe(true);
      expect(gaplessShared.instances).toHaveLength(1);
      const o = gaplessShared.instances[0].options;
      expect(o.tracks).toEqual([entries[0].src, entries[1].src, entries[2].src]);
      expect(o.trackMetadata).toEqual([
        expectedMetadata(entries[0]),
        expectedMetadata(entries[1]),
        expectedMetadata(entries[2]),
      ]);
    });
    test('Passes preloadNumTracks 1, playbackMethod HYBRID and volume / 100', () => {
      const entries = setupQueue(makeEntries(3));
      gapless.setVolume(50);
      gapless.loadTrack(trackFromEntry(entries[0]), 0, true, 0);
      const o = gaplessShared.instances[0].options;
      expect(o.preloadNumTracks).toBe(1);
      expect(o.playbackMethod).toBe('HYBRID');
      expect(o.volume).toBe(0.5);
    });
    test('Uses the init() volume when setVolume has not been called', () => {
      callbacks.volumeLevel = 80;
      const entries = setupQueue(makeEntries(3));
      gapless.loadTrack(trackFromEntry(entries[0]), 0, true, 0);
      expect(gaplessShared.instances[0].options.volume).toBe(0.8);
    });
    test('Calls gotoTrack(0, false) then play() when play is true', () => {
      const entries = setupQueue(makeEntries(3));
      gapless.loadTrack(trackFromEntry(entries[0]), 0, true, 0);
      expect(gaplessShared.instances[0].gotoTrack).toHaveBeenCalledWith(0, false);
      expect(gaplessShared.instances[0].resumeAudioContext).toHaveBeenCalledTimes(1);
      expect(gaplessShared.instances[0].play).toHaveBeenCalledTimes(1);
      expect(callbacks.onLoadStart).toHaveBeenCalledTimes(1);
      expect(callbacks.onCanPlay).toHaveBeenCalledTimes(1);
    });
    test('Does not play when play is false', () => {
      const entries = setupQueue(makeEntries(3));
      gapless.loadTrack(trackFromEntry(entries[0]), 0, false, 0);
      expect(gaplessShared.instances[0].play).not.toHaveBeenCalled();
    });
    test('Seeks to progress / 1000 seconds when progress is given', () => {
      const entries = setupQueue(makeEntries(3));
      gapless.loadTrack(trackFromEntry(entries[0]), 30000, true, 0);
      expect(gaplessShared.instances[0].seek).toHaveBeenCalledWith(30);
    });
    test('Does not seek when progress is 0', () => {
      const entries = setupQueue(makeEntries(3));
      gapless.loadTrack(trackFromEntry(entries[0]), 0, true, 0);
      expect(gaplessShared.instances[0].seek).not.toHaveBeenCalled();
    });
    test('Returns false without building a Queue when canPlay fails', () => {
      const entries = setupQueue(makeEntries(3));
      expect(gapless.loadTrack(trackFromEntry(entries[0]), 0, true, 1)).toBe(false);
      expect(gapless.loadTrack(trackFromEntry(entries[0]), 0, true)).toBe(false);
      expect(gaplessShared.instances).toHaveLength(0);
    });
    test('Window chain stops at a transcode-needed entry', () => {
      const entries = [makeEntry(0), makeEntry(1), makeEntry(2, 'wma'), makeEntry(3)];
      setupQueue(entries);
      gapless.loadTrack(trackFromEntry(entries[0]), 0, true, 0);
      const o = gaplessShared.instances[0].options;
      expect(o.tracks).toEqual([entries[0].src, entries[1].src]);
      expect(o.tracks).toHaveLength(2);
    });
    test('Window contains at most WINDOW_AHEAD (2) tracks beyond the current one', () => {
      const entries = setupQueue(makeEntries(6));
      gapless.loadTrack(trackFromEntry(entries[0]), 0, true, 0);
      expect(gaplessShared.instances[0].options.tracks).toEqual([entries[0].src, entries[1].src, entries[2].src]);
    });
  });

  describe('loadTrack() repeat flags', () => {
    test('repeatOnce repeats the current track throughout the window', () => {
      const entries = setupQueue(makeEntries(3), { repeatOnce: true, repeatAll: false });
      gapless.loadTrack(trackFromEntry(entries[1]), 0, true, 1);
      expect(gaplessShared.instances[0].options.tracks).toEqual([entries[1].src, entries[1].src, entries[1].src]);
    });
    test('repeatAll wraps the window to the start of the queue at the end', () => {
      const entries = setupQueue(makeEntries(3), { repeatOnce: false, repeatAll: true });
      gapless.loadTrack(trackFromEntry(entries[2]), 0, true, 2);
      expect(gaplessShared.instances[0].options.tracks).toEqual([entries[2].src, entries[0].src, entries[1].src]);
    });
    test('Without repeat the window ends at the last queue entry', () => {
      const entries = setupQueue(makeEntries(3));
      gapless.loadTrack(trackFromEntry(entries[2]), 0, true, 2);
      expect(gaplessShared.instances[0].options.tracks).toEqual([entries[2].src]);
    });
  });

  describe('Seam advances (onStartNewTrack)', () => {
    test('An engine boundary crossing fires onGaplessSeamAdvance', () => {
      const entries = setupQueue(makeEntries(5));
      gapless.loadTrack(trackFromEntry(entries[0]), 0, true, 0);
      gaplessShared.instances[0].options.onStartNewTrack({ index: 1 });
      expect(callbacks.onGaplessSeamAdvance).toHaveBeenCalledWith({ index: 1 });
    });
    test('An echo of the current engine index does NOT fire onGaplessSeamAdvance', () => {
      const entries = setupQueue(makeEntries(5));
      gapless.loadTrack(trackFromEntry(entries[0]), 0, true, 0);
      gaplessShared.instances[0].options.onStartNewTrack({ index: 0 });
      expect(callbacks.onGaplessSeamAdvance).not.toHaveBeenCalled();
    });
    test('Engine indexes are mapped through engineToQueueIndex (repeatAll wrap)', () => {
      const entries = setupQueue(makeEntries(3), { repeatOnce: false, repeatAll: true });
      gapless.loadTrack(trackFromEntry(entries[2]), 0, true, 2);
      gaplessShared.instances[0].options.onStartNewTrack({ index: 1 });
      expect(callbacks.onGaplessSeamAdvance).toHaveBeenCalledWith({ index: 0 });
    });
    test('Re-syncing after a seam extends the window tail via addTrack', () => {
      const entries = setupQueue(makeEntries(5));
      gapless.loadTrack(trackFromEntry(entries[0]), 0, true, 0);
      gaplessShared.instances[0].options.onStartNewTrack({ index: 1 });
      gapless.syncQueue(entries, noRepeat);
      expect(gaplessShared.instances[0].removeTrack).not.toHaveBeenCalled();
      expect(gaplessShared.instances[0].addTrack).toHaveBeenCalledTimes(1);
      expect(gaplessShared.instances[0].addTrack).toHaveBeenCalledWith(entries[3].src, {
        skipHEAD: true,
        metadata: expectedMetadata(entries[3]),
      });
    });
  });

  describe('reconcileTail()', () => {
    test('Switching repeatOnce on mid-play swaps the stale tail for the current track', () => {
      const entries = setupQueue(makeEntries(3));
      gapless.loadTrack(trackFromEntry(entries[0]), 0, true, 0);
      gapless.syncQueue(entries, { repeatOnce: true, repeatAll: false });
      expect(gaplessShared.instances[0].removeTrack.mock.calls).toEqual([[2], [1]]);
      expect(gaplessShared.instances[0].addTrack).toHaveBeenCalledTimes(2);
      expect(gaplessShared.instances[0].addTrack.mock.calls[0][0]).toBe(entries[0].src);
      expect(gaplessShared.instances[0].addTrack.mock.calls[1][0]).toBe(entries[0].src);
    });
    test('Re-syncing an unchanged queue leaves the engine window untouched', () => {
      const entries = setupQueue(makeEntries(3));
      gapless.loadTrack(trackFromEntry(entries[0]), 0, true, 0);
      gapless.syncQueue(entries, noRepeat);
      expect(gaplessShared.instances[0].removeTrack).not.toHaveBeenCalled();
      expect(gaplessShared.instances[0].addTrack).not.toHaveBeenCalled();
    });
  });

  describe('loadTrack() same-track reuse', () => {
    test('Reloading the current track reuses the existing Queue', () => {
      const entries = setupQueue(makeEntries(3));
      gapless.loadTrack(trackFromEntry(entries[0]), 0, true, 0);
      const first = gaplessShared.instances[0];
      gapless.loadTrack(trackFromEntry(entries[0]), 45000, true, 0);
      expect(gaplessShared.instances).toHaveLength(1);
      expect(first.destroy).not.toHaveBeenCalled();
      expect(first.seek).toHaveBeenCalledWith(45);
      expect(first.play).toHaveBeenCalledTimes(2);
      expect(callbacks.onCanPlay).toHaveBeenCalledTimes(2);
    });
    test('Reloading the current track with play=false pauses it', () => {
      const entries = setupQueue(makeEntries(3));
      gapless.loadTrack(trackFromEntry(entries[0]), 0, true, 0);
      const first = gaplessShared.instances[0];
      gapless.loadTrack(trackFromEntry(entries[0]), 0, false, 0);
      expect(gaplessShared.instances).toHaveLength(1);
      expect(first.pause).toHaveBeenCalledTimes(1);
    });
    test('Loading a different queue position builds a new Queue', () => {
      const entries = setupQueue(makeEntries(3));
      gapless.loadTrack(trackFromEntry(entries[0]), 0, true, 0);
      const first = gaplessShared.instances[0];
      gapless.loadTrack(trackFromEntry(entries[1]), 0, true, 1);
      expect(gaplessShared.instances).toHaveLength(2);
      expect(first.destroy).toHaveBeenCalledTimes(1);
      expect(gaplessShared.instances[1].options.tracks[0]).toBe(entries[1].src);
    });
  });

  describe('Playback controls', () => {
    const loadDefault = () => {
      const entries = setupQueue(makeEntries(3));
      gapless.loadTrack(trackFromEntry(entries[0]), 0, true, 0);
      return gaplessShared.instances[0];
    };
    test('pause() routes to the queue instance', () => {
      loadDefault();
      gapless.pause();
      expect(gaplessShared.instances[0].pause).toHaveBeenCalledTimes(1);
    });
    test('resume() resumes the AudioContext and plays', () => {
      const inst = loadDefault();
      inst.resumeAudioContext.mockClear();
      inst.play.mockClear();
      gapless.resume();
      expect(inst.resumeAudioContext).toHaveBeenCalledTimes(1);
      expect(inst.play).toHaveBeenCalledTimes(1);
    });
    test('restart() seeks to 0 and plays', () => {
      const inst = loadDefault();
      inst.play.mockClear();
      gapless.restart();
      expect(inst.seek).toHaveBeenCalledWith(0);
      expect(inst.play).toHaveBeenCalledTimes(1);
    });
    test('setProgress() converts ms to seconds', () => {
      const inst = loadDefault();
      gapless.setProgress(45000);
      expect(inst.seek).toHaveBeenCalledWith(45);
    });
    test('getCurrentProgress() returns the current track time in seconds', () => {
      const inst = loadDefault();
      inst.currentTrack = { currentTime: 33 };
      expect(gapless.getCurrentProgress()).toBe(33);
    });
    test('getCurrentProgress() returns 0 when no queue exists', () => {
      expect(gapless.getCurrentProgress()).toBe(0);
    });
    test('setVolume() stores the level and applies it to the queue as a fraction', () => {
      const inst = loadDefault();
      gapless.setVolume(50);
      expect(inst.setVolume).toHaveBeenCalledWith(0.5);
    });
    test('unload() destroys the queue', () => {
      const inst = loadDefault();
      gapless.unload();
      expect(inst.destroy).toHaveBeenCalledTimes(1);
      expect(gapless.getCurrentProgress()).toBe(0);
    });
    test('setEnabled(false) destroys the queue', () => {
      const inst = loadDefault();
      gapless.setEnabled(false);
      expect(inst.destroy).toHaveBeenCalledTimes(1);
    });
    test('Controls are safe to call before any track is loaded', () => {
      gapless.init(callbacks);
      expect(() => gapless.pause()).not.toThrow();
      expect(() => gapless.resume()).not.toThrow();
      expect(() => gapless.restart()).not.toThrow();
      expect(() => gapless.setProgress(1000)).not.toThrow();
      expect(() => gapless.setVolume(50)).not.toThrow();
      expect(() => gapless.unload()).not.toThrow();
    });
  });

  describe('Engine callback forwarding', () => {
    const loadDefault = () => {
      const entries = setupQueue(makeEntries(3));
      gapless.loadTrack(trackFromEntry(entries[0]), 0, true, 0);
      return gaplessShared.instances[0];
    };
    test('onEnded forwards to the init onEnded callback', () => {
      loadDefault();
      gaplessShared.instances[0].options.onEnded();
      expect(callbacks.onEnded).toHaveBeenCalledTimes(1);
    });
    test('onError maps to onGaplessError with the GAPLESS_MEDIA_ERROR code', () => {
      loadDefault();
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      gaplessShared.instances[0].options.onError(new Error('decode failed'));
      expect(callbacks.onGaplessError).toHaveBeenCalledWith({
        errorCode: 'GAPLESS_MEDIA_ERROR',
        errorMessage: 'decode failed',
      });
    });
    test('onError falls back to a default message when the error has none', () => {
      loadDefault();
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      gaplessShared.instances[0].options.onError(new Error(''));
      expect(callbacks.onGaplessError).toHaveBeenCalledWith({
        errorCode: 'GAPLESS_MEDIA_ERROR',
        errorMessage: 'The gapless engine could not play the track',
      });
    });
    test('onPlayBlocked forwards to onGaplessPlayBlocked', () => {
      loadDefault();
      gaplessShared.instances[0].options.onPlayBlocked();
      expect(callbacks.onGaplessPlayBlocked).toHaveBeenCalledTimes(1);
    });
  });
});

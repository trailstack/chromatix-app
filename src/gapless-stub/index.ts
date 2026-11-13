// Stub for the 'gapless' npm package — used for TypeScript resolution only.
// At runtime the package is either installed (production) or mocked via
// vi.doMock (tests).
export class Queue {
  options: any;
  currentTrack: any;
  constructor(_options: any) {
    this.options = _options;
    this.currentTrack = null;
  }
  play() {}
  pause() {}
  seek(_position: number) {}
  gotoTrack(_index: number, _seek: boolean) {}
  setVolume(_volume: number) {}
  addTrack(_src: string, _opts: any) {}
  removeTrack(_index: number) {}
  destroy() {}
  resumeAudioContext() {
    return Promise.resolve();
  }
}

import chroma from 'chroma-js';

import extractDominantColor from './extractDominantColor';

// A solid, vivid colour for the fake canvas to "contain"
const RED = [200, 30, 40];

const makePixelData = (size: number, [red, green, blue]: number[]) => {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = red;
    data[i + 1] = green;
    data[i + 2] = blue;
    data[i + 3] = 255;
  }
  return data;
};

// Fills the image with the given colours, each covering the proportion of its share
const makeMixedPixelData = (size: number, segments: { color: number[]; share: number }[]) => {
  const total = size * size;
  const data = new Uint8ClampedArray(total * 4);
  let index = 0;

  for (const { color, share } of segments) {
    const count = Math.round(total * share);
    for (let pixel = 0; pixel < count && index < total; pixel++, index++) {
      const offset = index * 4;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = 255;
    }
  }

  return data;
};

const mockCanvas = (data: Uint8ClampedArray) => {
  const getContext = vi.fn().mockReturnValue({
    drawImage: vi.fn(),
    getImageData: vi.fn().mockReturnValue({ data }),
  });
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = getContext as any;
  return () => {
    HTMLCanvasElement.prototype.getContext = original;
  };
};

const mockImage = ({ fails = false, width = 64, height = 64 } = {}) => {
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    width = width;
    height = height;
    src = '';

    constructor() {
      // Resolve on the next microtask, once the caller has attached its handlers
      queueMicrotask(() => (fails ? this.onerror?.() : this.onload?.()));
    }
  }
  vi.stubGlobal('Image', FakeImage as any);
};

const mockFetch = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob()),
    })
  );

describe('Testing "extractDominantColor" function', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn().mockReturnValue('blob:artwork');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('returns null for an empty URL', async () => {
    expect(await extractDominantColor('')).toBeNull();
  });

  test('returns null for a null URL', async () => {
    expect(await extractDominantColor(null as any)).toBeNull();
  });

  test('returns null when the artwork fails to load', async () => {
    mockImage({ fails: true });
    expect(await extractDominantColor('https://example.test/broken.jpg')).toBeNull();
  });

  test('returns null when the image is too small to analyse', async () => {
    mockImage({ width: 8, height: 8 });
    mockFetch();
    expect(await extractDominantColor('https://example.test/tiny.jpg')).toBeNull();
  });

  test('returns null when the image has no opaque pixels', async () => {
    mockImage();
    mockFetch();
    const restore = mockCanvas(new Uint8ClampedArray(48 * 48 * 4));
    try {
      expect(await extractDominantColor('https://example.test/transparent.jpg')).toBeNull();
    } finally {
      restore();
    }
  });

  test('returns a neutral colour for black-and-white artwork', async () => {
    mockImage();
    mockFetch();
    const restore = mockCanvas(makePixelData(48, [0, 0, 0]));
    try {
      const color = await extractDominantColor('https://example.test/black-white.jpg');
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
      expect(chroma(color!).get('hsl.s')).toBeCloseTo(0, 1);
    } finally {
      restore();
    }
  });

  test('stays neutral when a vivid accent covers only a small part of the artwork', async () => {
    mockImage();
    mockFetch();
    const restore = mockCanvas(
      makeMixedPixelData(48, [
        { color: [120, 120, 120], share: 0.8 },
        { color: [230, 120, 30], share: 0.2 },
      ])
    );
    try {
      const color = await extractDominantColor('https://example.test/small-accent.jpg');
      expect(chroma(color!).get('hsl.s')).toBeLessThan(0.1);
    } finally {
      restore();
    }
  });

  test('uses a vivid colour that covers a large part of the artwork', async () => {
    mockImage();
    mockFetch();
    const restore = mockCanvas(
      makeMixedPixelData(48, [
        { color: [120, 120, 120], share: 0.6 },
        { color: [230, 120, 30], share: 0.4 },
      ])
    );
    try {
      const color = await extractDominantColor('https://example.test/large-accent.jpg');
      expect(chroma(color!).get('hsl.h')).toBeCloseTo(27, 0);
    } finally {
      restore();
    }
  });

  test('groups a textured gradient of shades into one vivid region', async () => {
    mockImage();
    mockFetch();
    // No single orange shade clears the vivid share on its own, but together they clearly define the artwork
    const restore = mockCanvas(
      makeMixedPixelData(48, [
        { color: [120, 120, 120], share: 0.55 },
        { color: [220, 110, 30], share: 0.15 },
        { color: [235, 125, 40], share: 0.15 },
        { color: [210, 100, 25], share: 0.15 },
      ])
    );
    try {
      const color = await extractDominantColor('https://example.test/gradient.jpg');
      const hue = chroma(color!).get('hsl.h');
      expect(hue).toBeGreaterThan(15);
      expect(hue).toBeLessThan(40);
    } finally {
      restore();
    }
  });

  test('returns the dominant colour of the artwork', async () => {
    mockImage();
    mockFetch();
    const restore = mockCanvas(makePixelData(48, RED));
    try {
      const color = await extractDominantColor('https://example.test/red.jpg');
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
      // Keeps the artwork's hue rather than falling back to the default accent
      expect(chroma(color!).get('hsl.h')).toBeCloseTo(chroma(...(RED as [number, number, number])).get('hsl.h'), 0);
    } finally {
      restore();
    }
  });

  test('bypasses the HTTP cache, since a cached no-cors response fails the CORS check', async () => {
    mockImage();
    mockFetch();
    const restore = mockCanvas(makePixelData(48, RED));
    try {
      await extractDominantColor('https://example.test/uncached.jpg');
      expect(fetch).toHaveBeenCalledWith('https://example.test/uncached.jpg', { cache: 'no-store' });
    } finally {
      restore();
    }
  });

  test('caches the result, so the artwork is only fetched once', async () => {
    mockImage();
    mockFetch();
    const restore = mockCanvas(makePixelData(48, RED));
    try {
      const first = await extractDominantColor('https://example.test/cached.jpg');
      const second = await extractDominantColor('https://example.test/cached.jpg');
      expect(first).toBe(second);
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });
});

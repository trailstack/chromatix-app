import chroma from 'chroma-js';

// Resolved colours are cached by artwork URL, so replaying a track doesn't re-fetch or re-analyse its image
const colorCache = new Map<string, string>();

// Small enough to analyse quickly, large enough to keep the dominant colour meaningful
const SAMPLE_SIZE = 48;

const loadImage = (src: string, anonymous = false): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    if (anonymous) image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Artwork failed to load'));
    image.src = src;
  });

// Loads artwork without tainting the canvas. Artwork is served from the Plex/Jellyfin origin, and drawing a
// cross-origin <img> straight to a canvas makes getImageData throw a security error, so the image is fetched as a
// blob first (blob URLs are same-origin). Falls back to a CORS-enabled <img> when fetch isn't available.
// The request bypasses the HTTP cache: the same artwork URL is already cached as a no-cors <img> response (from the
// player's artwork), and replaying that cached entry to a CORS fetch fails the access check even though a fresh
// request would be allowed, so the image is refetched from the network.
const loadArtwork = async (url: string): Promise<HTMLImageElement | null> => {
  if (typeof fetch === 'function') {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok) {
        const objectUrl = URL.createObjectURL(await response.blob());
        try {
          return await loadImage(objectUrl);
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      }
    } catch {
      // Fall through to a direct image load below
    }
  }

  try {
    // A CORS-enabled load can still be read back from the canvas, unlike a plain one
    return await loadImage(url, true);
  } catch {
    return null;
  }
};

interface Sample {
  lab: [number, number, number];
  rgb: [number, number, number];
}

interface Cluster {
  color: chroma.Color;
  count: number;
}

// Number of colour clusters to reduce the artwork to, and the cap on Lloyd's iterations
const CLUSTER_COUNT = 6;
const MAX_ITERATIONS = 12;

const distanceSquared = (a: number[], b: number[]): number => {
  const deltaL = a[0] - b[0];
  const deltaA = a[1] - b[1];
  const deltaB = a[2] - b[2];
  return deltaL * deltaL + deltaA * deltaA + deltaB * deltaB;
};

// Reduces the sampled pixels to a handful of representative colours with k-means in CIELAB, so perceptually similar
// shades (including gradients and textured artwork) group together instead of being split across fixed buckets.
// The initial centroids use farthest-point sampling rather than randomness, so results are stable across runs.
const clusterSamples = (samples: Sample[]): Cluster[] => {
  const clusterCount = Math.min(CLUSTER_COUNT, samples.length);

  const mean: [number, number, number] = [0, 0, 0];
  for (const sample of samples) {
    mean[0] += sample.lab[0];
    mean[1] += sample.lab[1];
    mean[2] += sample.lab[2];
  }
  mean[0] /= samples.length;
  mean[1] /= samples.length;
  mean[2] /= samples.length;

  const centroids: [number, number, number][] = [];
  let seed = samples[0];
  let seedDistance = Infinity;
  for (const sample of samples) {
    const distance = distanceSquared(sample.lab, mean);
    if (distance < seedDistance) {
      seedDistance = distance;
      seed = sample;
    }
  }
  centroids.push([...seed.lab]);

  // Each further centroid is the sample furthest from every centroid chosen so far
  while (centroids.length < clusterCount) {
    let farthest = samples[0];
    let farthestDistance = -1;
    for (const sample of samples) {
      let nearestDistance = Infinity;
      for (const centroid of centroids) {
        const distance = distanceSquared(sample.lab, centroid);
        if (distance < nearestDistance) nearestDistance = distance;
      }
      if (nearestDistance > farthestDistance) {
        farthestDistance = nearestDistance;
        farthest = sample;
      }
    }
    centroids.push([...farthest.lab]);
  }

  const assignments = new Array<number>(samples.length).fill(-1);

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    let changed = false;

    for (let index = 0; index < samples.length; index++) {
      let bestCluster = 0;
      let bestDistance = Infinity;
      for (let cluster = 0; cluster < centroids.length; cluster++) {
        const distance = distanceSquared(samples[index].lab, centroids[cluster]);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestCluster = cluster;
        }
      }
      if (assignments[index] !== bestCluster) {
        assignments[index] = bestCluster;
        changed = true;
      }
    }

    const sums = centroids.map(() => [0, 0, 0, 0]);
    for (let index = 0; index < samples.length; index++) {
      const sum = sums[assignments[index]];
      const lab = samples[index].lab;
      sum[0] += lab[0];
      sum[1] += lab[1];
      sum[2] += lab[2];
      sum[3]++;
    }
    for (let cluster = 0; cluster < centroids.length; cluster++) {
      const sum = sums[cluster];
      if (sum[3] > 0) centroids[cluster] = [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]];
    }

    if (!changed) break;
  }

  // Average the original RGB values per cluster, so colours stay inside the sRGB gamut
  const sums = centroids.map(() => ({ red: 0, green: 0, blue: 0, count: 0 }));
  for (let index = 0; index < samples.length; index++) {
    const sum = sums[assignments[index]];
    const [red, green, blue] = samples[index].rgb;
    sum.red += red;
    sum.green += green;
    sum.blue += blue;
    sum.count++;
  }

  return sums
    .filter((sum) => sum.count > 0)
    .map((sum) => ({
      color: chroma(
        Math.round(sum.red / sum.count),
        Math.round(sum.green / sum.count),
        Math.round(sum.blue / sum.count)
      ),
      count: sum.count,
    }));
};

interface Candidate {
  color: chroma.Color;
  count: number;
  // Perceptual colourfulness (CIELAB chroma), which reads pale colours better than HSL saturation does
  chroma: number;
  // Lab hue angle in degrees, used to group shades of the same colour together
  hue: number;
}

// A cluster is colourful enough to define the theme above this CIELAB chroma, below which it reads as a tinted grey
const VIVID_CHROMA = 10;

// Vivid clusters must cover at least this share of the artwork before they can define the theme, so a small orange
// detail on an otherwise black-and-white cover doesn't recolour the whole app
const VIVID_SHARE = 0.25;

// Vivid clusters within this many degrees of hue are treated as one colour region (e.g. a gradient or a textured area)
const HUE_GROUP_GAP = 40;

// Splits the candidates into groups of similar hue. The circle is cut at its widest gap, so shades either side of the
// red boundary aren't split apart.
const groupByHue = (candidates: Candidate[]): Candidate[][] => {
  if (candidates.length < 2) return candidates.length > 0 ? [candidates] : [];

  const sorted = [...candidates].sort((first, second) => first.hue - second.hue);
  const gaps = sorted.map((candidate, index) => {
    const next = sorted[(index + 1) % sorted.length];
    const nextHue = index === sorted.length - 1 ? next.hue + 360 : next.hue;
    return nextHue - candidate.hue;
  });
  const start = (gaps.indexOf(Math.max(...gaps)) + 1) % sorted.length;

  const groups: Candidate[][] = [];
  let group: Candidate[] = [];

  for (let step = 0; step < sorted.length; step++) {
    const index = (start + step) % sorted.length;
    group.push(sorted[index]);
    if (gaps[index] >= HUE_GROUP_GAP) {
      groups.push(group);
      group = [];
    }
  }

  if (group.length > 0) groups.push(group);
  return groups;
};

// Averages the group's clusters in Lab, weighted by how much of the artwork each covers
const blendCandidates = (candidates: Candidate[]): chroma.Color => {
  const total = candidates.reduce((sum, candidate) => sum + candidate.count, 0);
  const lab: [number, number, number] = [0, 0, 0];

  for (const candidate of candidates) {
    const [lightness, a, b] = candidate.color.lab();
    lab[0] += lightness * candidate.count;
    lab[1] += a * candidate.count;
    lab[2] += b * candidate.count;
  }

  return chroma.lab(lab[0] / total, lab[1] / total, lab[2] / total);
};

// Clusters the artwork's pixels, then picks the colour that covers the most area. Vivid colours only take over when
// they cover a meaningful share of the artwork, and are grouped by hue first, so a small orange detail on an otherwise
// black-and-white cover doesn't recolour the whole app while a large warm region does. Transparent pixels are ignored.
const getDominantColor = (image: HTMLImageElement): string | null => {
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;

  const context = canvas.getContext('2d');
  if (!context) return null;

  let pixels: Uint8ClampedArray;

  try {
    context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    pixels = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
  } catch {
    // Reading pixels throws when the canvas is tainted by cross-origin artwork
    return null;
  }

  const samples: Sample[] = [];

  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 128) continue;

    const rgb: [number, number, number] = [pixels[index], pixels[index + 1], pixels[index + 2]];
    const [lightness, a, b] = chroma(...rgb).lab();
    samples.push({ lab: [lightness, a, b], rgb });
  }

  if (samples.length === 0) return null;

  const clusters = clusterSamples(samples);
  if (clusters.length === 0) return null;

  const candidates: Candidate[] = clusters.map((cluster) => {
    const [, a, b] = cluster.color.lab();
    return {
      ...cluster,
      chroma: Math.hypot(a, b),
      hue: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360,
    };
  });

  const dominant = candidates.reduce<Candidate | null>(
    (best, candidate) => (!best || candidate.count > best.count ? candidate : best),
    null
  );
  if (!dominant) return null;

  // Ignore shades too close to black or white to read as an accent
  const vivid = candidates.filter((candidate) => {
    const lightness = candidate.color.get('hsl.l');
    return candidate.chroma >= VIVID_CHROMA && lightness >= 0.12 && lightness <= 0.88;
  });
  const vividTotal = vivid.reduce((sum, candidate) => sum + candidate.count, 0);

  // A roughly neutral dominant colour (e.g. a black-and-white cover) only gives way to a vivid region when that region
  // is large enough to be a defining part of the artwork
  let chosen: chroma.Color | null = null;

  if (dominant.chroma >= VIVID_CHROMA) {
    chosen = dominant.color;
  } else if (vivid.length > 0 && vividTotal >= samples.length * VIVID_SHARE) {
    // The largest hue group wins, so a colour split across several shades isn't beaten by a smaller, purer patch
    const groups = groupByHue(vivid);
    const largest = groups.reduce((best, group) => (group.length > best.length ? group : best));
    chosen = blendCandidates(largest);
  }

  if (!chosen) {
    const neutral = dominant.color.set('hsl.s', 0);
    const lightness = Math.min(Math.max(neutral.get('hsl.l'), 0.45), 0.65);
    return neutral.set('hsl.l', lightness).hex();
  }

  // Nudge the result into a usable accent range: saturated enough to read as a colour, and mid-toned enough to work
  // on both light and dark backgrounds (the theme tokens shift it further for contrast where needed)
  const accent = chosen;
  const saturation = Math.max(accent.get('hsl.s'), 0.5);
  const lightness = Math.min(Math.max(accent.get('hsl.l'), 0.42), 0.68);

  return accent.set('hsl.s', saturation).set('hsl.l', lightness).hex();
};

/**
 * Extracts the dominant colour from an artwork image, for use as the theme's accent colour.
 * Returns a neutral colour for black-and-white artwork, and `null` when the image can't be loaded
 * or has no opaque pixels, so callers can keep their existing accent.
 * @param imageUrl - URL of the artwork image.
 * @returns Promise resolving to a hex colour string, or `null` when nothing could be extracted.
 */

const extractDominantColor = async (imageUrl: string): Promise<string | null> => {
  if (!imageUrl) return null;

  const cached = colorCache.get(imageUrl);
  if (cached) return cached;

  const image = await loadArtwork(imageUrl);
  if (!image) return null;

  // Images too small to hold a meaningful palette aren't worth analysing
  if (image.width < 16 || image.height < 16) return null;

  const color = getDominantColor(image);
  if (!color) return null;

  colorCache.set(imageUrl, color);
  return color;
};

export default extractDominantColor;

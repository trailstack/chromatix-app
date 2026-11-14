import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import chroma from 'chroma-js';

import { themes } from 'js/_config/themes';
import { extractDominantColor, getColorTokens, sendToElectron } from 'js/utils';

// Tints the theme's background towards the album colour, so every screen picks up the current artwork's hue.
// Dark backgrounds need a stronger mix to read as colourful; light ones only need a hint.
const tintBackground = (background: string, albumColor: string): string => {
  const amount = chroma(background).luminance() > 0.4 ? 0.18 : 0.42;
  return chroma.mix(background, albumColor, amount, 'lab').hex();
};

// Keeps the album accent vivid and readable against the tinted background. Saturation is raised to a lively level,
// then lightness is moved just far enough to reach a usable contrast for links and active items (4:1); the exact
// contrast needed for accents and fills is still solved by getColorTokens. Neutral artwork stays neutral, since
// forcing saturation onto a grey would tint it with an arbitrary hue.
const readableCore = (albumColor: string, background: string): string => {
  const isLightBackground = chroma(background).luminance() > 0.4;
  const target = 4;
  const sourceSaturation = chroma(albumColor).get('hsl.s');
  const saturation = sourceSaturation < 0.08 ? sourceSaturation : Math.max(sourceSaturation, 0.7);
  const base = chroma(albumColor).set('hsl.s', saturation);

  if (chroma.contrast(base, background) >= target) return base.hex();

  const adjust = (lightness: number) => base.set('hsl.l', lightness);
  let low: number;
  let high: number;

  if (isLightBackground) {
    // Darken the accent until it reads against the light background
    low = 0;
    high = base.get('hsl.l');
    for (let step = 0; step < 16; step++) {
      const middle = (low + high) / 2;
      if (chroma.contrast(adjust(middle), background) >= target) low = middle;
      else high = middle;
    }
    return adjust(low).hex();
  }

  // Lighten the accent until it reads against the dark background
  low = base.get('hsl.l');
  high = 1;
  for (let step = 0; step < 16; step++) {
    const middle = (low + high) / 2;
    if (chroma.contrast(adjust(middle), background) >= target) high = middle;
    else low = middle;
  }
  return adjust(high).hex();
};

/**
 * Custom hook that manages dynamic color theming for the application.
 * Applies the CSS custom properties from `getColorTokens` for the selected theme and accessibility settings.
 * When theme matching is enabled, extracts the dominant color from the current track's album art and
 * uses it as the core accent color and background tint across all screens.
 */

function useColorTheme(): void {
  const defaultTheme = 'chromatix-magenta';

  const dispatch = useDispatch();

  const fullPageMode = useSelector(({ appModel }: any) => appModel.fullPageMode);
  const fullPageTheme = useSelector(({ sessionModel }: any) => sessionModel.fullPageTheme);
  const fullPageThemeColor = useSelector(({ sessionModel }: any) => sessionModel.fullPageThemeColor);
  const extractedTrackId = useSelector(({ sessionModel }: any) => sessionModel._extractedTrackId);

  const currentServer = useSelector(({ sessionModel }: any) => sessionModel.currentServer);
  const currentLibrary = useSelector(({ sessionModel }: any) => sessionModel.currentLibrary);
  const queueIsVisible = useSelector(({ sessionModel }: any) => sessionModel.queueIsVisible);

  const hasSelectedLibrary = currentServer && currentLibrary;
  const hasQueueVisible = queueIsVisible && hasSelectedLibrary;

  const currentTheme = useSelector(({ sessionModel }: any) => sessionModel.currentTheme);
  const currentColorBackground = useSelector(({ sessionModel }: any) => sessionModel.currentColorBackground);
  const currentColorPrimary = useSelector(({ sessionModel }: any) => sessionModel.currentColorPrimary);
  const currentColorText = useSelector(({ sessionModel }: any) => sessionModel.currentColorText);
  const currentUiTinting = useSelector(({ sessionModel }: any) => sessionModel.currentUiTinting);
  const currentContrast = useSelector(({ sessionModel }: any) => sessionModel.currentContrast);

  // Playing track data for color extraction
  const playingTrackList = useSelector(({ sessionModel }: any) => sessionModel.playingTrackList);
  const playingTrackIndex = useSelector(({ sessionModel }: any) => sessionModel.playingTrackIndex);
  const playingTrackKeys = useSelector(({ sessionModel }: any) => sessionModel.playingTrackKeys);
  const trackCurrent = playingTrackList?.[(playingTrackKeys as any[])?.[playingTrackIndex]];
  const trackThumb = trackCurrent?.thumbMd || trackCurrent?.thumbSm;
  const trackId = trackCurrent?.trackId;

  // Extract dominant color from album artwork when theme matching is enabled and a new track plays
  useEffect(() => {
    if (!fullPageTheme || !trackThumb || !trackId) return;

    // Only extract if we don't already have a color for this track
    if (fullPageThemeColor && extractedTrackId === trackId) return;

    let cancelled = false;

    extractDominantColor(trackThumb)
      .then((color) => {
        // Leave the current accent in place when the artwork can't be analysed
        if (cancelled || !color) return;

        console.log('%c--- extractDominantColor ---', 'color:#439c08', trackId, color);

        dispatch.sessionModel.setSessionState({
          fullPageThemeColor: color,
          _extractedTrackId: trackId,
        });
      })
      .catch(() => {
        // Keep the current accent if extraction fails for any reason
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullPageTheme, trackThumb, trackId, playingTrackKeys, dispatch]);

  // The album artwork accent applies on every screen while theme matching is enabled. When it's disabled, the
  // full-page player keeps its fixed dark theme and the rest of the app keeps the selected theme.
  useEffect(() => {
    const actualTheme =
      fullPageMode && !fullPageTheme
        ? 'full-page'
        : themes[currentTheme as keyof typeof themes]
          ? currentTheme
          : defaultTheme;

    const theme = themes[actualTheme as keyof typeof themes];
    const isCustom = currentTheme === 'custom';

    // The album artwork drives the whole palette while theme matching is enabled: its dominant colour is used as
    // the core accent, and the background is tinted towards it so every screen reflects the current album
    const albumColor = fullPageTheme ? fullPageThemeColor : null;

    const baseBackground = isCustom ? currentColorBackground : theme.background;
    const background = albumColor ? tintBackground(baseBackground, albumColor) : baseBackground;

    const baseCore = isCustom ? currentColorPrimary : theme.primary;
    const core = albumColor ? readableCore(albumColor, background) : baseCore;

    const { tokens, isLightTheme, isLightText } = getColorTokens({
      background,
      text: isCustom ? currentColorText : theme.text,
      core,
      contrast: currentContrast,
      tinting: isCustom ? currentUiTinting : 'auto',
    });

    // Get or create the style element for dynamic theme variables
    let styleElement = document.getElementById('dynamic-theme-props') as HTMLStyleElement;
    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = 'dynamic-theme-props';
      document.head.appendChild(styleElement);
    }

    // Update the style element with the new CSS variables
    const cssText = `:root {\n${Object.entries(tokens)
      .map(([key, value]) => `  ${key}: ${value};`)
      .join('\n')}\n}`;
    styleElement.textContent = cssText;

    // Send updated colors to Electron main process
    sendToElectron(['win', 'lin'], 'color-theme', {
      background: tokens[hasQueueVisible && !fullPageMode ? '--color-secondary-bg' : '--color-primary-bg'],
      text: tokens['--color-text'],
      primary: tokens['--color-core-main'],
    });

    // Save whether the theme is light or dark in the session state
    dispatch.sessionModel.setSessionState({
      isLightTheme,
      isLightText,
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentContrast,
    currentUiTinting,
    hasQueueVisible,
    currentTheme,
    currentColorBackground,
    currentColorText,
    currentColorPrimary,
    fullPageMode,
    fullPageTheme,
    fullPageThemeColor,
  ]);
}

export default useColorTheme;

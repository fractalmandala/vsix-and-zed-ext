'use strict';

const { buildGroups, buildPalette, indexTheme } = require('./themeIndex');
const { assignRoles, buildContrastReport } = require('./palette');
const { parseThemeText } = require('./themeExport');

/**
 * The single view model the webview renders. Kept free of any VS Code API so it
 * can be exercised directly in tests; the host only supplies document facts.
 */
function buildStudioState({ text, fileName = '', dirty = false, previewing = false }) {
  const { occurrences } = indexTheme(text);
  const theme = parseThemeText(text);
  const palette = assignRoles(buildPalette(occurrences));

  return {
    type: 'state',
    fileName,
    themeName: theme.name || 'Untitled theme',
    themeType: theme.type || 'dark',
    occurrenceCount: occurrences.length,
    palette,
    groups: buildGroups(occurrences, theme),
    contrast: buildContrastReport(palette),
    previewing: Boolean(previewing),
    dirty: Boolean(dirty)
  };
}

module.exports = { buildStudioState };

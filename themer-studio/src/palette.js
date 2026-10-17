'use strict';

/**
 * Role assignment turns the statistical palette (base colors ranked by usage)
 * into something a person can reason about. Rules are checked in order and the
 * first one whose key list matches a base color's occurrences wins, so the
 * earliest entries are the most specific.
 */
const ROLE_RULES = [
  {
    role: 'danger',
    label: 'Error / danger',
    keys: [
      'errorForeground',
      'editorError.foreground',
      'editorGutter.deletedBackground',
      'editorOverviewRuler.errorForeground',
      'inputValidation.errorBorder',
      'gitDecoration.deletedResourceForeground',
      'list.errorForeground',
      'statusBarItem.errorBackground',
      'charts.red',
      'minimap.errorHighlight',
      'editorBracketHighlight.unexpectedBracket.foreground'
    ]
  },
  {
    role: 'warning',
    label: 'Warning',
    keys: [
      'editorWarning.foreground',
      'editorGutter.modifiedBackground',
      'inputValidation.warningBorder',
      'gitDecoration.modifiedResourceForeground',
      'list.warningForeground',
      'statusBarItem.warningBackground',
      'charts.yellow',
      'editorOverviewRuler.warningForeground'
    ]
  },
  {
    role: 'success',
    label: 'Success / added',
    keys: [
      'editorGutter.addedBackground',
      'gitDecoration.addedResourceForeground',
      'gitDecoration.untrackedResourceForeground',
      'charts.green',
      'diffEditor.insertedTextBackground',
      'terminal.ansiGreen',
      'editorOverviewRuler.addedForeground'
    ]
  },
  {
    role: 'info',
    label: 'Info / links',
    keys: [
      'editorInfo.foreground',
      'inputValidation.infoBorder',
      'notificationsInfoIcon.foreground',
      'charts.blue',
      'terminal.ansiBlue'
    ]
  },
  {
    role: 'accent',
    label: 'Accent',
    keys: [
      'focusBorder',
      'button.background',
      'activityBarBadge.background',
      'activityBar.activeBorder',
      'progressBar.background',
      'badge.background',
      'textLink.foreground',
      'textLink.activeForeground',
      'editorCursor.foreground',
      'terminalCursor.foreground',
      'tab.activeBorderTop',
      'panelTitle.activeBorder',
      'statusBar.debuggingBackground',
      'statusBarItem.remoteBackground',
      'list.highlightForeground',
      'editorLineNumber.activeForeground',
      'editorLink.activeForeground',
      'inputOption.activeBorder',
      'settings.modifiedItemIndicator',
      'notificationLink.foreground',
      'peekView.border',
      'breadcrumb.activeSelectionForeground',
      'listFilterWidget.outline'
    ]
  },
  {
    role: 'surface',
    label: 'Primary surface',
    keys: ['editor.background', 'editorGutter.background']
  },
  {
    role: 'surfaceAlt',
    label: 'Secondary surface',
    keys: [
      'sideBar.background',
      'activityBar.background',
      'titleBar.activeBackground',
      'statusBar.background',
      'panel.background',
      'editorGroupHeader.tabsBackground',
      'tab.inactiveBackground',
      'textBlockQuote.background',
      'textCodeBlock.background',
      'editorMarkerNavigation.background'
    ]
  },
  {
    role: 'overlay',
    label: 'Overlay / widget',
    keys: [
      'editorWidget.background',
      'menu.background',
      'dropdown.background',
      'input.background',
      'quickInput.background',
      'notifications.background',
      'editorHoverWidget.background',
      'editorSuggestWidget.background',
      'breadcrumb.background',
      'tab.activeBackground',
      'checkbox.background'
    ]
  },
  {
    role: 'border',
    label: 'Border',
    keys: [
      'widget.border',
      'panel.border',
      'sideBar.border',
      'editorGroup.border',
      'tab.border',
      'menu.border',
      'dropdown.border',
      'input.border',
      'activityBar.border',
      'titleBar.border',
      'statusBar.border',
      'editorWidget.border',
      'checkbox.border',
      'charts.lines',
      'pickerGroup.border'
    ]
  },
  {
    role: 'text',
    label: 'Body text',
    keys: [
      'editor.foreground',
      'foreground',
      'sideBar.foreground',
      'tab.activeForeground',
      'panelTitle.activeForeground',
      'menu.foreground',
      'dropdown.foreground',
      'input.foreground',
      'quickInput.foreground',
      'chart.foreground',
      'charts.foreground'
    ]
  },
  {
    role: 'textMuted',
    label: 'Muted text',
    keys: [
      'descriptionForeground',
      'editorLineNumber.foreground',
      'sideBarTitle.foreground',
      'sideBarSectionHeader.foreground',
      'tab.inactiveForeground',
      'activityBar.inactiveForeground',
      'statusBar.foreground',
      'breadcrumb.foreground',
      'pickerGroup.foreground',
      'panelTitle.inactiveForeground',
      'editorCodeLens.foreground',
      'editorHint.foreground'
    ]
  },
  {
    role: 'selection',
    label: 'Selection',
    keys: [
      'editor.selectionBackground',
      'editor.inactiveSelectionBackground',
      'editorSuggestWidget.selectedBackground',
      'list.activeSelectionBackground',
      'list.focusBackground',
      'menu.selectionBackground',
      'quickInputList.focusBackground',
      'peekViewResult.selectionBackground',
      'minimap.selectionHighlight'
    ]
  },
  {
    role: 'onAccent',
    label: 'Text on accent',
    keys: ['button.foreground', 'badge.foreground', 'activityBarBadge.foreground', 'statusBar.debuggingForeground']
  }
];

const HUE_NAMES = [
  { max: 15, name: 'red' },
  { max: 45, name: 'orange' },
  { max: 70, name: 'yellow' },
  { max: 160, name: 'green' },
  { max: 200, name: 'cyan' },
  { max: 255, name: 'blue' },
  { max: 290, name: 'violet' },
  { max: 335, name: 'magenta' },
  { max: 360, name: 'red' }
];

function stripPrefix(path) {
  return path.startsWith('colors.') ? path.slice('colors.'.length) : path;
}

function toRgb(base) {
  return {
    r: parseInt(base.slice(1, 3), 16),
    g: parseInt(base.slice(3, 5), 16),
    b: parseInt(base.slice(5, 7), 16)
  };
}

function toHsl(base) {
  const { r, g, b } = toRgb(base);
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  let hue = 0;
  let saturation = 0;

  if (delta !== 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
    if (max === red) {
      hue = 60 * (((green - blue) / delta) % 6);
    } else if (max === green) {
      hue = 60 * ((blue - red) / delta + 2);
    } else {
      hue = 60 * ((red - green) / delta + 4);
    }
  }

  return {
    h: Math.round((hue + 360) % 360),
    s: Math.round(saturation * 100),
    l: Math.round(lightness * 100)
  };
}

function relativeLuminance(base) {
  const channel = (value) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  const { r, g, b } = toRgb(base);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(baseA, baseB) {
  const luminanceA = relativeLuminance(baseA);
  const luminanceB = relativeLuminance(baseB);
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

/**
 * A stable, human-readable name for a color that matched no role, based on its
 * hue and lightness — e.g. "#F0873A" -> "orange (60%)".
 */
function describeColor(base) {
  const { h, s, l } = toHsl(base);

  if (s <= 8) {
    return l >= 90 ? 'near white' : l >= 60 ? 'light grey' : l >= 30 ? 'grey' : 'near black';
  }

  const hue = HUE_NAMES.find((entry) => h <= entry.max);
  return `${hue.name} (${l}% light)`;
}

function roleForPaths(paths, rules = ROLE_RULES) {
  const stripped = paths.map(stripPrefix);
  const strippedSet = new Set(stripped);

  for (const rule of rules) {
    for (const key of rule.keys) {
      if (strippedSet.has(key)) {
        return { role: rule.role, label: rule.label };
      }
    }
  }

  return null;
}

/**
 * Annotate every palette entry with a role (when one matches), a display name,
 * and the single path it is most likely edited through.
 */
function assignRoles(palette, rules = ROLE_RULES) {
  return palette.map((entry) => {
    const match = roleForPaths(entry.paths, rules);
    const primaryPath = entry.paths.find((path) => path.startsWith('colors.')) || entry.paths[0] || '';

    return {
      ...entry,
      role: match ? match.role : 'unassigned',
      roleLabel: match ? match.label : 'Unassigned',
      name: match ? match.label : describeColor(entry.base),
      hsl: toHsl(entry.base),
      primaryPath
    };
  });
}

/**
 * Contrast of the theme's body text against its primary surface. Reported
 * against the accent too, since accent-on-surface is where themes usually fail.
 */
function buildContrastReport(palette) {
  const byRole = (role) => palette.find((entry) => entry.role === role);
  const surface = byRole('surface');
  const text = byRole('text');
  const muted = byRole('textMuted');
  const accent = byRole('accent');

  if (!surface) {
    return null;
  }

  const measure = (against) => (against ? contrastRatio(surface.base, against.base) : null);

  return {
    surface: surface.base,
    text: { base: text ? text.base : null, ratio: measure(text) },
    muted: { base: muted ? muted.base : null, ratio: measure(muted) },
    accent: { base: accent ? accent.base : null, ratio: measure(accent) }
  };
}

module.exports = {
  ROLE_RULES,
  assignRoles,
  buildContrastReport,
  contrastRatio,
  describeColor,
  relativeLuminance,
  roleForPaths,
  toHsl,
  toRgb
};

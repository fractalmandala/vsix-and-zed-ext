(function () {
  const vscode = acquireVsCodeApi();

  const dom = {
    themeName: document.getElementById('themeName'),
    fileName: document.getElementById('fileName'),
    contrast: document.getElementById('contrast'),
    palette: document.getElementById('palette'),
    paletteSummary: document.getElementById('paletteSummary'),
    groups: document.getElementById('groups'),
    tabs: document.getElementById('tabs'),
    load: document.getElementById('load'),
    preview: document.getElementById('preview'),
    save: document.getElementById('save'),
    export: document.getElementById('export'),
    install: document.getElementById('install'),
    popover: document.getElementById('popover'),
    popoverTitle: document.getElementById('popoverTitle'),
    popoverMeta: document.getElementById('popoverMeta'),
    popoverContrast: document.getElementById('popoverContrast'),
    popoverApply: document.getElementById('popoverApply'),
    popoverReset: document.getElementById('popoverReset'),
    popoverCancel: document.getElementById('popoverCancel'),
    popoverClose: document.getElementById('popoverClose'),
    picker: document.getElementById('picker'),
    hex: document.getElementById('hex'),
    alpha: document.getElementById('alpha'),
    alphaValue: document.getElementById('alphaValue')
  };

  const HEX_PATTERN = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

  let state = null;
  let activeTab = 'workbench';
  let target = null;

  function post(message) {
    vscode.postMessage(message);
  }

  function expandShorthand(hex) {
    return hex.split('').map((character) => character + character).join('');
  }

  function parseHex(value) {
    if (!HEX_PATTERN.test(String(value || ''))) {
      return null;
    }

    const digits = value.slice(1);
    const expanded = digits.length === 3 || digits.length === 4 ? expandShorthand(digits) : digits;

    return {
      rgb: `#${expanded.slice(0, 6)}`,
      alpha: expanded.length === 8 ? parseInt(expanded.slice(6), 16) : 255
    };
  }

  function toHex(value) {
    return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0').toUpperCase();
  }

  function buildHex(rgb, alpha) {
    return alpha >= 255 ? rgb.toUpperCase() : `${rgb.toUpperCase()}${toHex(alpha)}`;
  }

  function luminance(rgb) {
    const channel = (offset) => {
      const scaled = parseInt(rgb.slice(offset, offset + 2), 16) / 255;
      return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  }

  function contrastRatio(colorA, colorB) {
    const a = luminance(colorA);
    const b = luminance(colorB);
    return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
  }

  function chipStyle(node, rgb, alpha) {
    node.style.background = rgb;
    node.style.opacity = alpha >= 255 ? '1' : String(Math.max(alpha, 0) / 255);
    node.classList.toggle('translucent', alpha < 255);
  }

  function renderContrast(report) {
    dom.contrast.textContent = '';

    if (!report) {
      return;
    }

    const entries = [
      ['text', report.text],
      ['muted', report.muted],
      ['accent', report.accent]
    ];

    for (const [label, entry] of entries) {
      if (!entry || entry.ratio === null || entry.ratio === undefined) {
        continue;
      }

      const chip = document.createElement('span');
      const grade = entry.ratio >= 7 ? 'aaa' : entry.ratio >= 4.5 ? 'aa' : 'fail';
      chip.className = `grade ${grade}`;
      chip.textContent = `${label} ${entry.ratio}:1`;
      chip.title = `${label} against the surface (${report.surface})`;
      dom.contrast.appendChild(chip);
    }
  }

  function renderPalette() {
    dom.palette.textContent = '';
    dom.paletteSummary.textContent = `${state.palette.length} base colors driving ${state.groups.workbench
      .concat(state.groups.syntax)
      .concat(state.groups.semantic)
      .reduce((total, group) => total + group.entries.length, 0)} tokens`;

    for (const entry of state.palette) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'swatch-card';

      const chip = document.createElement('span');
      chip.className = 'chip';
      chipStyle(chip, entry.base, 255);

      const name = document.createElement('span');
      name.className = 'card-name';
      name.textContent = entry.name;

      const hex = document.createElement('span');
      hex.className = 'card-hex';
      hex.textContent = entry.base;

      const meta = document.createElement('span');
      meta.className = 'card-meta';
      meta.textContent = entry.alphaCount > 1
        ? `${entry.uses} uses \u00b7 ${entry.alphaCount} alpha variants`
        : `${entry.uses} uses`;

      card.append(chip, name, hex, meta);
      card.addEventListener('click', (event) => {
        event.stopPropagation();
        openPopover(card, { mode: 'base', entry });
      });
      dom.palette.appendChild(card);
    }
  }

  function buildRow(entry) {
    const card = document.createElement('div');
    card.className = 'swatch-card token-card';

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.path = entry.pathString;
    chip.setAttribute('aria-label', `Edit ${entry.label}`);
    const parsed = parseHex(entry.color) || { rgb: entry.base, alpha: 255 };
    chipStyle(chip, parsed.rgb, parsed.alpha);

    const name = document.createElement('span');
    name.className = 'card-name';
    name.textContent = entry.label;
    name.title = entry.pathString;

    const hex = document.createElement('span');
    hex.className = 'card-hex';
    hex.textContent = entry.color;

    const meta = document.createElement('span');
    meta.className = 'card-meta';

    const goto = document.createElement('button');
    goto.type = 'button';
    goto.className = 'ghost tiny source';
    goto.textContent = 'Source';
    goto.title = `Reveal ${entry.pathString}`;
    goto.addEventListener('click', (event) => {
      event.stopPropagation();
      post({ type: 'reveal', start: entry.start });
    });

    meta.appendChild(goto);
    card.append(chip, name, hex, meta);

    card.addEventListener('click', (event) => {
      event.stopPropagation();
      openPopover(card, { mode: 'token', entry });
    });

    return card;
  }

  function buildTokenGrid(entries) {
    const grid = document.createElement('div');
    grid.className = 'token-grid';

    for (const entry of entries) {
      grid.appendChild(buildRow(entry));
    }

    return grid;
  }

  function renderGroups() {
    dom.groups.textContent = '';
    const groups = (state.groups[activeTab] || []).filter((group) => group.entries.length > 0);

    if (groups.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'Nothing in this section.';
      dom.groups.appendChild(empty);
      return;
    }

    for (const group of groups) {
      const section = document.createElement('section');
      section.className = 'token-section';

      // A lone group (Semantic) needs no heading — the tab is the heading.
      if (groups.length > 1) {
        const head = document.createElement('h3');
        head.className = 'group-title';
        const title = document.createElement('span');
        title.textContent = group.name;
        const count = document.createElement('span');
        count.className = 'count';
        count.textContent = String(group.entries.length);
        head.append(title, count);
        section.appendChild(head);
      }

      section.appendChild(buildTokenGrid(group.entries));
      dom.groups.appendChild(section);
    }
  }

  function render() {
    if (!state) {
      return;
    }

    if (state.missing) {
      dom.themeName.textContent = 'Theme file is no longer open';
      return;
    }

    dom.themeName.textContent = state.themeName;
    dom.fileName.textContent = `${state.fileName} \u00b7 ${state.themeType}${state.dirty ? ' \u00b7 unsaved' : ''}`;
    dom.preview.textContent = state.previewing ? 'Stop Preview' : 'Preview in IDE';
    dom.preview.classList.toggle('active', Boolean(state.previewing));

    renderContrast(state.contrast);
    renderPalette();
    renderGroups();
  }

  function openPopover(anchor, nextTarget) {
    target = { ...nextTarget, anchor };
    target.original = target.mode === 'base' ? target.entry.base : target.entry.color;
    const rect = anchor.getBoundingClientRect();

    if (target.mode === 'base') {
      dom.popoverTitle.textContent = target.entry.name;
      dom.popoverMeta.textContent = `${target.entry.base} \u00b7 ${target.entry.uses} uses \u00b7 ${target.entry.alphaCount} alpha variants \u00b7 editing the base color updates all of them`;
      dom.picker.value = target.entry.base;
      dom.hex.value = target.entry.base;
      dom.alpha.value = '255';
      dom.alpha.disabled = true;
    } else {
      const parsed = parseHex(target.entry.color) || { rgb: target.entry.base, alpha: 255 };
      dom.popoverTitle.textContent = target.entry.label;
      dom.popoverMeta.textContent = target.entry.pathString;
      dom.picker.value = parsed.rgb;
      dom.hex.value = target.entry.color;
      dom.alpha.value = String(parsed.alpha);
      dom.alpha.disabled = false;
    }

    dom.alphaValue.textContent = target.mode === 'base' ? 'preserved' : dom.alpha.value;
    updatePopoverContrast();
    updateResetState();

    dom.popover.classList.remove('hidden');
    const width = dom.popover.offsetWidth;
    const left = Math.min(rect.left, Math.max(8, window.innerWidth - width - 8));
    dom.popover.style.left = `${Math.max(8, left)}px`;
    dom.popover.style.top = `${Math.min(rect.bottom + 8, Math.max(8, window.innerHeight - dom.popover.offsetHeight - 8))}px`;
  }

  function closePopover() {
    dom.popover.classList.add('hidden');
    target = null;
  }

  function currentCandidate() {
    const parsed = parseHex(dom.hex.value);
    if (!parsed) {
      return null;
    }
    return buildHex(parsed.rgb, target && target.mode === 'token' ? Number(dom.alpha.value) : parsed.alpha);
  }

  function updatePopoverContrast() {
    const candidate = currentCandidate();
    dom.popoverContrast.textContent = '';

    if (!candidate || !state || !state.contrast || !state.contrast.surface) {
      return;
    }

    const parsed = parseHex(candidate);
    const ratio = contrastRatio(parsed.rgb, state.contrast.surface);
    const grade = ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : 'below AA';

    dom.popoverContrast.textContent = `${ratio}:1 against the surface (${state.contrast.surface}) \u2014 ${grade}`;
  }

  function updateResetState() {
    if (!target) {
      return;
    }

    const candidate = currentCandidate();
    const unchanged = candidate && target.original
      ? candidate.toUpperCase() === target.original.toUpperCase()
      : true;

    dom.popoverReset.disabled = unchanged;
  }

  function apply() {
    const value = currentCandidate();

    if (!value) {
      dom.hex.classList.add('invalid');
      return;
    }

    dom.hex.classList.remove('invalid');

    if (target.mode === 'base') {
      post({ type: 'setBase', from: target.entry.base, to: value });
    } else {
      post({ type: 'setToken', pathString: target.entry.pathString, color: value });
    }

    // Live preview: keep the popover open on Apply so the change can be watched
    // and fine-tuned; closing it (or Escape) ends the editing session.
    if (state && state.previewing) {
      target.original = value;
      updateResetState();
      return;
    }

    closePopover();
  }

  function reset() {
    if (!target || !target.original) {
      return;
    }

    if (target.mode === 'base') {
      post({ type: 'setBase', from: target.entry.base, to: target.original });
    } else {
      post({ type: 'setToken', pathString: target.entry.pathString, color: target.original });
    }

    const parsed = parseHex(target.original) || { rgb: target.entry.base, alpha: 255 };
    dom.picker.value = parsed.rgb;
    dom.hex.value = target.original;
    if (target.mode === 'token') {
      dom.alpha.value = String(parsed.alpha);
      dom.alphaValue.textContent = String(parsed.alpha);
    }
    dom.hex.classList.remove('invalid');
    updatePopoverContrast();
    updateResetState();
  }

  dom.picker.addEventListener('input', () => {
    const parsed = parseHex(dom.picker.value);
    if (!parsed) {
      return;
    }
    dom.hex.value = buildHex(parsed.rgb, Number(dom.alpha.value));
    updatePopoverContrast();
    updateResetState();
  });

  dom.hex.addEventListener('input', () => {
    const parsed = parseHex(dom.hex.value);
    dom.hex.classList.toggle('invalid', !parsed);
    if (parsed) {
      dom.picker.value = parsed.rgb;
    }
    updatePopoverContrast();
    updateResetState();
  });

  dom.hex.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      apply();
    }
    if (event.key === 'Escape') {
      closePopover();
    }
  });

  dom.alpha.addEventListener('input', () => {
    dom.alphaValue.textContent = dom.alpha.value;
    const parsed = parseHex(dom.picker.value);
    if (parsed) {
      dom.hex.value = buildHex(parsed.rgb, Number(dom.alpha.value));
    }
    updatePopoverContrast();
    updateResetState();
  });

  dom.popoverApply.addEventListener('click', apply);
  dom.popoverReset.addEventListener('click', reset);
  dom.popoverCancel.addEventListener('click', closePopover);
  dom.popoverClose.addEventListener('click', closePopover);

  dom.load.addEventListener('click', () => post({ type: 'loadTheme' }));
  dom.preview.addEventListener('click', () => post({ type: 'togglePreview' }));
  dom.save.addEventListener('click', () => post({ type: 'save' }));
  dom.export.addEventListener('click', () => post({ type: 'export' }));
  dom.install.addEventListener('click', () => post({ type: 'install' }));

  dom.tabs.addEventListener('click', (event) => {
    const button = event.target.closest('.tab');
    if (!button) {
      return;
    }

    activeTab = button.dataset.tab;
    for (const tab of dom.tabs.querySelectorAll('.tab')) {
      tab.classList.toggle('active', tab === button);
    }
    renderGroups();
  });

  document.addEventListener('click', (event) => {
    if (!target) {
      return;
    }
    // The click that opened the popover bubbles to the document too; ignore it
    // instead of treating it as a click on the backdrop.
    if (target.anchor && target.anchor.contains(event.target)) {
      return;
    }
    if (!dom.popover.contains(event.target)) {
      closePopover();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && target) {
      closePopover();
      return;
    }

    const undoChord = (event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z';
    const inField = event.target instanceof Element && event.target.closest('input, textarea');
    if (undoChord && !inField) {
      event.preventDefault();
      post({ type: 'undo' });
    }
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message && message.type === 'state') {
      state = message;
      render();
    }
  });

  post({ type: 'ready' });
})();

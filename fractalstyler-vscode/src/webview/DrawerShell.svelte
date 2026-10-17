<script lang="ts">
	import type { Snippet } from 'svelte'

	type FileItem = { filename: string; title?: string }

	let {
		files = [],
		current = $bindable(''),
		open = $bindable(false),
		title = 'FRACTALSTYLER',
		onselect,
		actions,
		children
	}: {
		files?: FileItem[]
		current?: string
		open?: boolean
		title?: string
		onselect?: (filename: string) => void
		actions?: Snippet
		children?: Snippet
	} = $props()

	function toggle() {
		open = !open
	}

	function pick(filename: string) {
		current = filename
		open = false
		onselect?.(filename)
	}
</script>

<div class="shell">
	<div class="header" data-ext-region="header">
		<div class="header-left">
			<div class="brand">
				<svg class="brand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
					<path d="M14.15 13.91C15.84 12.22 14.77 8.42 11.78 5.43C8.78 2.43 4.98 1.36 3.29 3.05C1.6 4.74 2.67 8.54 5.67 11.54C8.67 14.53 12.46 15.6 14.15 13.91Z" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
					<path d="M14.15 9.63C15.84 11.31 14.77 15.11 11.78 18.11C8.78 21.11 4.98 22.17 3.29 20.49C1.6 18.8 2.67 15 5.67 12C8.67 9 12.46 7.94 14.15 9.63Z" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
					<path d="M9.84 13.91C8.15 12.22 9.22 8.42 12.22 5.43C15.21 2.43 19.01 1.36 20.7 3.05C22.39 4.74 21.32 8.54 18.32 11.54C15.33 14.53 11.53 15.6 9.84 13.91Z" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
					<path d="M9.84 9.63C8.15 11.31 9.22 15.11 12.22 18.11C15.21 21.11 19.01 22.17 20.7 20.49C22.39 18.8 21.32 15 18.32 12C15.33 9 11.53 7.94 9.84 9.63Z" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
				<span class="brand-title">{title}</span>
				{#if current}
					<span class="brand-sep">/</span>
					<span class="file-badge">{current}</span>
				{/if}
			</div>
		</div>

		<div class="header-right">
			{@render actions?.()}
			<button
				class="header-btn"
				class:active={open}
				type="button"
				title={open ? 'Close Files List' : 'Toggle Files List'}
				aria-label="Toggle files list"
				aria-expanded={open}
				aria-controls="drawer-view"
				data-ext-id="btn-drawer-toggle"
				data-ext-title="Toggle Files List"
				onclick={toggle}
			>
				☰
			</button>
		</div>
	</div>

	<div class="view-content" data-ext-region="view-content">
		<!-- Kept mounted (just hidden) so editor state survives the toggle -->
		<div class="editor-wrapper" class:hidden={open} data-ext-id="editor-wrapper">
			{@render children?.()}
		</div>

		<div id="drawer-view" class="drawer-view" class:active={open}>
			<div class="doc-list" data-ext-id="doc-list">
				{#each files as file (file.filename)}
					<button
						class="doc-item"
						class:selected={file.filename === current}
						type="button"
						onclick={() => pick(file.filename)}
					>
						{file.title ?? file.filename}
					</button>
				{:else}
					<div class="empty">No styles found</div>
				{/each}
			</div>
		</div>
	</div>
</div>

<style>
	/* Theme tokens. Inside VS Code the --vscode-* values win; elsewhere the fallbacks apply.
	   Override any --fs-* var on a parent to restyle. */
	.shell {
		--bg: var(--fs-bg, var(--vscode-sideBar-background, var(--vscode-editor-background, #ffffff)));
		--fg: var(--fs-fg, var(--vscode-sideBar-foreground, var(--vscode-editor-foreground, #1e1e1e)));
		--editor-bg: var(--fs-editor-bg, var(--vscode-editor-background, #ffffff));
		--gutter-fg: var(--fs-muted, var(--vscode-editorLineNumber-foreground, #999999));
		--line-color: var(--fs-line, var(--vscode-editorWidget-border, rgba(128, 128, 128, 0.18)));
		--hover-bg: var(--fs-hover, var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.08)));
		--active-bg: var(--fs-active, var(--vscode-list-activeSelectionBackground, rgba(128, 128, 128, 0.14)));
		--active-fg: var(--vscode-list-activeSelectionForeground, var(--fg));
		--icon-color: var(--fs-icon, var(--vscode-icon-foreground, var(--vscode-foreground, #444444)));
		--input-border: var(--vscode-input-border, rgba(128, 128, 128, 0.22));
		--mono: var(--vscode-editor-font-family, Menlo, Monaco, 'Courier New', monospace);

		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		position: relative;
		box-sizing: border-box;
		background: var(--bg);
		color: var(--fg);
		font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
		font-size: 12px;
	}

	.shell *,
	.shell *::before,
	.shell *::after {
		box-sizing: border-box;
	}

	/* Header */
	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 36px;
		padding: 0 10px;
		gap: 8px;
		flex-shrink: 0;
		background: var(--bg);
		border-bottom: 1px solid var(--line-color);
	}

	.header-left {
		display: flex;
		align-items: center;
		min-width: 0;
		overflow: hidden;
		flex: 1;
	}

	.header-right {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		overflow: hidden;
	}

	.brand-icon {
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		opacity: 0.85;
	}

	.brand-title {
		font-size: 10px;
		letter-spacing: 0.08em;
		text-transform: capitalize;
		opacity: 0.85;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.brand-sep {
		color: var(--gutter-fg);
		opacity: 0.6;
		font-size: 11px;
		flex-shrink: 0;
	}

	.file-badge {
		padding: 2px 6px;
		border-radius: 4px;
		background: var(--hover-bg);
		border: 1px solid var(--line-color);
		font-family: var(--mono);
		font-size: 10px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.header-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		flex-shrink: 0;
		padding: 0;
		border: none;
		border-radius: 4px;
		outline: none;
		background: transparent;
		color: var(--icon-color);
		font-size: 11px;
		cursor: pointer;
		transition: background-color 0.15s ease, opacity 0.15s ease;
	}

	.header-btn:hover {
		background: var(--hover-bg);
		opacity: 0.9;
	}

	.header-btn:focus-visible {
		outline: 1px solid var(--vscode-focusBorder, #007acc);
	}

	.header-btn.active {
		background: var(--active-bg);
		color: var(--active-fg);
	}

	/* Content area: editor and drawer swap places */
	.view-content {
		position: relative;
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		width: 100%;
	}

	.editor-wrapper {
		position: relative;
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		width: 100%;
		background: var(--editor-bg);
	}

	.editor-wrapper.hidden {
		display: none;
	}

	.drawer-view {
		display: none;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		width: 100%;
		padding: 8px 12px;
		overflow-y: auto;
	}

	.drawer-view.active {
		display: flex;
	}

	.doc-list {
		display: flex;
		flex-direction: column;
		width: 100%;
	}

	.doc-item {
		display: block;
		width: 100%;
		padding: 10px 8px;
		border: none;
		border-bottom: 1px solid var(--line-color);
		background: transparent;
		color: var(--fg);
		font-family: var(--mono);
		font-size: 12px;
		letter-spacing: -0.01em;
		text-align: left;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		cursor: pointer;
		transition: background-color 0.15s ease;
	}

	.doc-item:first-child {
		border-top: 1px solid var(--line-color);
	}

	.doc-item:hover {
		background: var(--hover-bg);
	}

	.doc-item.selected {
		background: var(--active-bg);
	}

	.doc-item:focus-visible {
		outline: 1px solid var(--vscode-focusBorder, #007acc);
		outline-offset: -1px;
	}

	.empty {
		padding: 30px;
		text-align: center;
		opacity: 0.5;
	}
</style>

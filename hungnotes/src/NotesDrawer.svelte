<script lang="ts">
	import type { Snippet } from 'svelte'

	type NoteItem = { filename: string; title: string }

	let {
		notes = [],
		open = $bindable(false),
		brand = 'HUNGNOTES',
		onselect,
		actions,
		children
	}: {
		notes?: NoteItem[]
		open?: boolean
		brand?: string
		onselect?: (filename: string) => void
		actions?: Snippet
		children?: Snippet
	} = $props()

	function pick(filename: string) {
		open = false
		onselect?.(filename)
	}
</script>

<div class="container">
	<div class="header" data-ext-region="header">
		<div class="brand">{brand}</div>
		<div class="actions">
			{@render actions?.()}

			<button
				data-ext-id="btn-drawer"
				class="icon-btn"
				type="button"
				title={open ? 'Close Drawer' : 'View Previous Docs'}
				aria-label={open ? 'Close drawer' : 'View previous docs'}
				aria-expanded={open}
				aria-controls="notes-drawer"
				data-ext-title="View Previous Docs"
				data-ext-aria-controls="drawer-view"
				onclick={() => (open = !open)}
			>
				{#if open}
					<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path fill="currentColor" d="M9.15 16.25L12 13.4l2.85 2.85l1.4-1.4L13.4 12l2.85-2.85l-1.4-1.4L12 10.6L9.15 7.75l-1.4 1.4L10.6 12l-2.85 2.85zM5 19V5zm-2 2V3h18v10.35q-.475-.175-.975-.262T19 13V5H5v14h8q0 .525.088 1.025t.262.975zm16 2l-1.4-1.4l1.575-1.6H15v-2h4.175L17.6 16.4L19 15l4 4z" />
					</svg>
				{:else}
					<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path fill="currentColor" d="M11.5 16V8l-4 4zm4.5 3h3V5h-3zM5 19h9V5H5zm11 0h3zM3 21V3h18v18z" />
					</svg>
				{/if}
			</button>
		</div>
	</div>

	<div class="view-content" data-ext-region="view-content">
		<!-- Kept mounted (just hidden) so the editor keeps its text, cursor and scroll -->
		<div class="editor-wrapper" class:hidden={open} data-ext-id="editor-wrapper">
			{@render children?.()}
		</div>

		<div id="notes-drawer" class="drawer-view" class:active={open} data-ext-id="drawer-view">
			<div class="doc-list" data-ext-id="doc-list">
				{#each notes as note (note.filename)}
					<button class="doc-item" type="button" onclick={() => pick(note.filename)}>
						<span class="doc-item-title">{note.title}</span>
					</button>
				{:else}
					<div class="empty-state">No previous notes found</div>
				{/each}
			</div>
		</div>
	</div>
</div>

<style>
	/* Inside VS Code the --vscode-* values win; elsewhere the fallbacks apply.
	   Override any --hn-* var on a parent to restyle. */
	.container {
		--bg: var(--hn-bg, var(--vscode-sideBar-background, var(--vscode-editor-background, #1e1e1e)));
		--fg: var(--hn-fg, var(--vscode-sideBar-foreground, var(--vscode-editor-foreground, #cccccc)));
		--editor-bg: var(--hn-editor-bg, var(--vscode-editor-background, #1e1e1e));
		--card-border: var(--hn-border, var(--vscode-editorWidget-border, var(--vscode-widget-border, rgba(128, 128, 128, 0.22))));
		--line-color: var(--hn-line, var(--vscode-editorWidget-border, var(--vscode-widget-border, rgba(128, 128, 128, 0.18))));
		--hover-bg: var(--hn-hover, var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.08)));
		--icon-color: var(--hn-icon, var(--vscode-icon-foreground, var(--vscode-foreground, #cccccc)));

		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		padding: 10px 14px 14px 14px;
		box-sizing: border-box;
		background: var(--bg);
		color: var(--fg);
		font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
		font-size: 13px;
	}

	.container *,
	.container *::before,
	.container *::after {
		box-sizing: border-box;
	}

	/* Header */
	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 32px;
		margin-bottom: 12px;
		user-select: none;
	}

	.brand {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		opacity: 0.9;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2px;
		border: none;
		border-radius: 4px;
		outline: none;
		background: transparent;
		color: var(--icon-color);
		cursor: pointer;
		transition: opacity 0.15s ease, background-color 0.15s ease;
	}

	.icon-btn:hover {
		opacity: 0.8;
		background: var(--hover-bg);
	}

	.icon-btn:active {
		transform: scale(0.96);
	}

	.icon-btn:focus-visible {
		outline: 1px solid var(--vscode-focusBorder, #007acc);
	}

	.icon-btn svg {
		display: block;
		width: 19px;
		height: 19px;
	}

	/* Content area: editor card and drawer swap places */
	.view-content {
		position: relative;
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		width: 100%;
	}

	.editor-wrapper {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		width: 100%;
		padding: 22px 20px 20px 20px;
		border: 1px solid var(--card-border);
		border-radius: 14px;
		background: var(--editor-bg);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
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
		padding-top: 4px;
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
		display: flex;
		align-items: center;
		justify-content: flex-end;
		width: 100%;
		padding: 18px 6px;
		border: none;
		border-bottom: 1px solid var(--line-color);
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
		user-select: none;
		transition: background-color 0.15s ease;
	}

	.doc-item:first-child {
		border-top: 1px solid var(--line-color);
	}

	.doc-item:hover {
		background-color: var(--hover-bg);
	}

	.doc-item:focus-visible {
		outline: 1px solid var(--vscode-focusBorder, #007acc);
		outline-offset: -1px;
	}

	.doc-item-title {
		font-size: 17px;
		font-weight: 700;
		letter-spacing: -0.01em;
		text-align: right;
	}

	.empty-state {
		padding: 40px 10px;
		text-align: center;
		font-size: 14px;
		opacity: 0.5;
	}
</style>

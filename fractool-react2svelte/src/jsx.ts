/**
 * JSX (Babel AST) → Svelte 5 template markup.
 *
 * Walks the JSX tree, not strings. Control flow becomes blocks: `a && <x/>` and
 * `c ? <a/> : <b/>` → {#if}/{:else if}, `a || <x/>` / `a ?? <x/>` → {#if}{:else},
 * `arr.map(i => …)` → {#each … (key)} with the callback's statements as {@const}.
 * Ternaries between plain values stay inline; `null`/`false` branches vanish.
 * Snippets: `children`, ReactNode props and render props → {@render}; JSX passed to
 * a component (as a prop or a function child) → {#snippet}. DOM-only React-isms
 * (className, htmlFor, onClick, onChange, style objects, ref) are normalized on DOM
 * elements only; component props keep their names.
 */

import * as t from '@babel/types';
import { gen_inline, gen_pattern } from './gen.ts';

export type MarkupBody = t.Node | t.Statement[] | null;

export interface JsxCtx {
	warnings: string[];
	/** Names rendered with {@render}: snippet props and the component's own snippets. */
	snippets: Set<string>;
	/** Snippets that may be absent (props): rendered as `x?.()`. */
	optional: Set<string>;
	/** Identifiers bound to DOM elements through `ref`. */
	dom_refs: Set<string>;
	/** Identifiers bound to a child component's `ref` prop. */
	component_refs: Set<string>;
	/** Ref identifiers backed by useRef/useState and safe for bind:this. */
	ref_names: Set<string>;
	/** `<X.Provider value>` seen: becomes setContext in the script. */
	provides: { key: string; value: t.Expression }[];
	/** styled-components converted to a tag plus a scoped class. */
	styled: Map<string, { tag: string; cls: string }>;
	/** The `props` identifier when the component takes props whole. */
	props_id: string | null;
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

// React attribute spellings → HTML. Only applied to DOM elements.
const ATTR_MAP: Record<string, string> = {
	className: 'class',
	htmlFor: 'for',
	readOnly: 'readonly',
	tabIndex: 'tabindex',
	autoFocus: 'autofocus',
	autoComplete: 'autocomplete',
	autoPlay: 'autoplay',
	autoCapitalize: 'autocapitalize',
	spellCheck: 'spellcheck',
	contentEditable: 'contenteditable',
	crossOrigin: 'crossorigin',
	noValidate: 'novalidate',
	maxLength: 'maxlength',
	minLength: 'minlength',
	colSpan: 'colspan',
	rowSpan: 'rowspan',
	encType: 'enctype',
	formAction: 'formaction',
	srcSet: 'srcset',
	inputMode: 'inputmode',
	enterKeyHint: 'enterkeyhint',
	accessKey: 'accesskey',
	referrerPolicy: 'referrerpolicy',
	defaultValue: 'value',
	defaultChecked: 'checked',
	// SVG presentation attributes React spells in camelCase
	strokeWidth: 'stroke-width',
	strokeLinecap: 'stroke-linecap',
	strokeLinejoin: 'stroke-linejoin',
	strokeDasharray: 'stroke-dasharray',
	strokeDashoffset: 'stroke-dashoffset',
	strokeOpacity: 'stroke-opacity',
	strokeMiterlimit: 'stroke-miterlimit',
	fillOpacity: 'fill-opacity',
	fillRule: 'fill-rule',
	clipRule: 'clip-rule',
	clipPath: 'clip-path',
	stopColor: 'stop-color',
	stopOpacity: 'stop-opacity',
	textAnchor: 'text-anchor',
	dominantBaseline: 'dominant-baseline',
	fontFamily: 'font-family',
	fontSize: 'font-size',
	fontWeight: 'font-weight',
	xlinkHref: 'href'
};

const UNITLESS = new Set(['opacity', 'z-index', 'font-weight', 'line-height', 'flex', 'flex-grow', 'flex-shrink', 'order', 'zoom', 'scale', 'aspect-ratio', 'grid-row', 'grid-column', 'columns', 'column-count', 'tab-size', 'orphans', 'widows', 'animation-iteration-count', 'fill-opacity', 'stroke-opacity']);

export function jsx_name(node: t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName): string {
	if (t.isJSXIdentifier(node)) return node.name;
	if (t.isJSXMemberExpression(node)) return `${jsx_name(node.object)}.${node.property.name}`;
	return `${node.namespace.name}:${node.name.name}`;
}

const is_dom_tag = (tag: string) => /^[a-z]/.test(tag) && !tag.includes('.');

export function unwrap(node: t.Node): t.Node {
	if (t.isParenthesizedExpression(node) || t.isTSAsExpression(node) || t.isTSNonNullExpression(node) || t.isTSSatisfiesExpression(node)) return unwrap(node.expression);
	return node;
}

export const is_jsx = (n: t.Node): n is t.JSXElement | t.JSXFragment => t.isJSXElement(n) || t.isJSXFragment(n);

/** `null`, `undefined`, `false`, `true`: React renders nothing for these. */
export function is_empty(n: t.Node): boolean {
	const u = unwrap(n);
	return t.isNullLiteral(u) || t.isBooleanLiteral(u) || t.isIdentifier(u, { name: 'undefined' }) || (t.isUnaryExpression(u) && u.operator === 'void');
}

/** Markup-producing: JSX, or a branch/operand that is. */
export function is_jsxish(n: t.Node): boolean {
	const u = unwrap(n);
	if (is_jsx(u)) return true;
	if (t.isConditionalExpression(u)) return is_jsxish(u.consequent) || is_jsxish(u.alternate);
	if (t.isLogicalExpression(u)) return is_jsxish(u.right) || is_jsxish(u.left);
	if (is_map_call(u)) {
		const fn = u.arguments[0];
		return (t.isArrowFunctionExpression(fn) || t.isFunctionExpression(fn)) && fn_returns_jsx(fn);
	}
	const array_from = array_from_call(u);
	if (array_from) return fn_returns_jsx(array_from.arguments[1] as t.Function);
	return false;
}

/** Does a function (any nesting of returns) produce JSX? */
export function fn_returns_jsx(fn: t.Function): boolean {
	if (!t.isBlockStatement(fn.body)) return is_jsxish(fn.body);
	let found = false;
	const scan = (s: t.Statement) => {
		if (found) return;
		if (t.isReturnStatement(s) && s.argument && is_jsxish(s.argument)) found = true;
		else if (t.isIfStatement(s)) {
			scan(s.consequent);
			if (s.alternate) scan(s.alternate);
		} else if (t.isBlockStatement(s)) s.body.forEach(scan);
		else if (t.isSwitchStatement(s)) s.cases.forEach((c) => c.consequent.forEach(scan));
		else if (t.isTryStatement(s)) scan(s.block);
	};
	fn.body.body.forEach(scan);
	return found;
}

function is_map_call(n: t.Node): n is t.CallExpression & { callee: t.MemberExpression | t.OptionalMemberExpression } {
	return (t.isCallExpression(n) || t.isOptionalCallExpression(n)) && (t.isMemberExpression(n.callee) || t.isOptionalMemberExpression(n.callee)) && t.isIdentifier(n.callee.property, { name: 'map' }) && !n.callee.computed;
}

function array_from_call(n: t.Node): t.CallExpression | null {
	if (!t.isCallExpression(n) || !t.isMemberExpression(n.callee) || n.callee.computed || !t.isIdentifier(n.callee.object, { name: 'Array' }) || !t.isIdentifier(n.callee.property, { name: 'from' })) return null;
	const source = n.arguments[0];
	const callback = n.arguments[1];
	if (!t.isObjectExpression(source) || !(t.isArrowFunctionExpression(callback) || t.isFunctionExpression(callback))) return null;
	const length = source.properties.find((p) => t.isObjectProperty(p) && t.isIdentifier(p.key, { name: 'length' })) as t.ObjectProperty | undefined;
	return length && t.isExpression(length.value) ? n : null;
}

/** The name a call or reference renders as a snippet under, if it is one. */
function snippet_ref(n: t.Node, ctx: JsxCtx): { callee: string; args: string; optional: boolean } | null {
	const u = unwrap(n);
	// children / props.children / a snippet prop, referenced bare
	const ref_name = (e: t.Node): string | null => {
		if (t.isIdentifier(e) && ctx.snippets.has(e.name)) return e.name;
		if ((t.isMemberExpression(e) || t.isOptionalMemberExpression(e)) && !e.computed && t.isIdentifier(e.property)) {
			if (ctx.props_id && t.isIdentifier(e.object, { name: ctx.props_id }) && (e.property.name === 'children' || /^render[A-Z]/.test(e.property.name) || ctx.snippets.has(e.property.name))) return gen_inline(e);
			if (/^render([A-Z]|$)/.test(e.property.name)) return gen_inline(e);
		}
		return null;
	};
	const bare = ref_name(u);
	if (bare) return { callee: bare, args: '', optional: !ctx.snippets.has(bare) || ctx.optional.has(bare) };
	if (t.isCallExpression(u) || t.isOptionalCallExpression(u)) {
		const name = ref_name(u.callee);
		if (name) {
			const optional = t.isOptionalCallExpression(u) || ctx.optional.has(name);
			return { callee: name, args: u.arguments.map((a) => gen_inline(a)).join(', '), optional };
		}
	}
	return null;
}

function render_tag(s: { callee: string; args: string; optional: boolean }): string {
	return `{@render ${s.callee}${s.optional ? '?.' : ''}(${s.args})}`;
}

/** Markup-producing for the purposes of block conversion (JSX, or a snippet). */
function is_markup(n: t.Node, ctx: JsxCtx): boolean {
	const u = unwrap(n);
	if (is_jsxish(u) || snippet_ref(u, ctx)) return true;
	if (t.isConditionalExpression(u)) return is_markup(u.consequent, ctx) || is_markup(u.alternate, ctx);
	if (t.isLogicalExpression(u)) return is_markup(u.left, ctx) || is_markup(u.right, ctx);
	return false;
}

const NEGATE: Record<string, '===' | '!==' | '==' | '!='> = { '===': '!==', '!==': '===', '==': '!=', '!=': '==' };

/** `!test`, simplified: `a === b` → `a !== b`, `!x` → `x`. */
function not(test: t.Expression): string {
	const u = unwrap(test);
	if (t.isBinaryExpression(u) && NEGATE[u.operator] && t.isExpression(u.left)) return gen_inline(t.binaryExpression(NEGATE[u.operator], u.left, u.right));
	if (t.isUnaryExpression(u) && u.operator === '!') return gen_inline(u.argument);
	return gen_inline(t.unaryExpression('!', t.cloneNode(test, true)));
}

function kebab(s: string): string {
	if (s.startsWith('--')) return s;
	return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/^(ms|webkit|moz)-/, '-$1-').toLowerCase();
}

/** style={{ marginTop: 4, color: c }} → `margin-top: 4px; color: {c}` */
function style_object(expr: t.ObjectExpression, ctx: JsxCtx): string | null {
	const parts: string[] = [];
	for (const prop of expr.properties) {
		if (!t.isObjectProperty(prop) || prop.computed) {
			ctx.warnings.push('style object with a spread or computed key: convert it to a string or style: directives by hand');
			return null;
		}
		const key = t.isIdentifier(prop.key) ? prop.key.name : t.isStringLiteral(prop.key) ? prop.key.value : null;
		if (!key) return null;
		const p = kebab(key);
		const v = prop.value;
		if (t.isStringLiteral(v)) parts.push(`${p}: ${v.value}`);
		else if (t.isNumericLiteral(v)) parts.push(`${p}: ${v.value}${UNITLESS.has(p) || p.startsWith('--') || v.value === 0 ? '' : 'px'}`);
		else if (t.isExpression(v)) {
			// numbers get px in React; a dynamic value might be either, so say so once
			parts.push(`${p}: {${gen_inline(v)}}`);
		}
	}
	return parts.join('; ');
}

function attr_string(name: string, value: string): string {
	return /[{}"]/.test(value) ? `${name}={${JSON.stringify(value)}}` : `${name}="${value}"`;
}

function attr_type(node: t.JSXOpeningElement): string | null {
	for (const a of node.attributes) if (t.isJSXAttribute(a) && jsx_name(a.name) === 'type' && t.isStringLiteral(a.value)) return a.value.value;
	return null;
}

/** onChange on a DOM element: `input` for text fields, `change` where the DOM fires that (checkbox, radio, select, file). */
function dom_event(name: string, tag: string, node: t.JSXOpeningElement): string {
	if (name === 'onDoubleClick') return 'ondblclick';
	if (name === 'onChange') {
		const type = attr_type(node);
		if (tag === 'select' || (tag === 'input' && type && ['checkbox', 'radio', 'file', 'range', 'color', 'date'].includes(type))) return 'onchange';
		if (tag === 'input' || tag === 'textarea') return 'oninput';
		return 'onchange';
	}
	return name.toLowerCase();
}

/**
 * `value={v} onChange={e => (v = e.target.value)}` (the setter already rewritten to
 * an assignment) → `bind:value={v}`; the same for `checked`.
 */
function detect_bind(node: t.JSXOpeningElement): { attr: string; consumed: Set<t.Node> } | null {
	let value_attr: t.JSXAttribute | undefined;
	let change_attr: t.JSXAttribute | undefined;
	let kind: 'value' | 'checked' | null = null;
	let name: string | null = null;
	for (const a of node.attributes) {
		if (!t.isJSXAttribute(a) || !a.value || !t.isJSXExpressionContainer(a.value)) continue;
		const an = jsx_name(a.name);
		const e = a.value.expression;
		if ((an === 'value' || an === 'checked') && t.isIdentifier(e)) {
			value_attr = a;
			kind = an;
			name = e.name;
		} else if (an === 'onChange' || an === 'onInput') change_attr = a;
	}
	if (!value_attr || !change_attr || !kind || !name) return null;
	const handler = (change_attr.value as t.JSXExpressionContainer).expression;
	if (!t.isArrowFunctionExpression(handler) && !t.isFunctionExpression(handler)) return null;
	const body = t.isBlockStatement(handler.body) ? (handler.body.body.length === 1 && t.isExpressionStatement(handler.body.body[0]) ? handler.body.body[0].expression : null) : handler.body;
	const assign = body && unwrap(body);
	if (!assign || !t.isAssignmentExpression(assign) || assign.operator !== '=' || !t.isIdentifier(assign.left, { name })) return null;
	const rhs = assign.right;
	if (!t.isMemberExpression(rhs) || !t.isIdentifier(rhs.property, { name: kind })) return null;
	if (!t.isMemberExpression(rhs.object) || !t.isIdentifier(rhs.object.property) || !['target', 'currentTarget'].includes(rhs.object.property.name)) return null;
	return { attr: `bind:${kind}={${name}}`, consumed: new Set([value_attr, change_attr]) };
}

interface Attrs {
	attrs: string[];
	html: string | null;
	/** Snippets passed to a component as props: `name` + params + body. */
	snippets: { name: string; params: string; body: t.Node | t.Statement[] }[];
}

function attributes(node: t.JSXOpeningElement, tag: string, ctx: JsxCtx): Attrs {
	const dom = is_dom_tag(tag);
	const out: Attrs = { attrs: [], html: null, snippets: [] };
	const bind = dom ? detect_bind(node) : null;
	if (bind) out.attrs.push(bind.attr);
	for (const attr of node.attributes) {
		if (bind?.consumed.has(attr)) continue;
		if (t.isJSXSpreadAttribute(attr)) {
			out.attrs.push(`{...${gen_inline(attr.argument)}}`);
			continue;
		}
		const name = jsx_name(attr.name);
		const value = attr.value;
		if (name === 'key') continue; // consumed by {#each (key)}
		const expr = value && t.isJSXExpressionContainer(value) && !t.isJSXEmptyExpression(value.expression) ? value.expression : null;

		if (name === 'ref' && expr) {
			const e = unwrap(expr);
			if (t.isIdentifier(e)) {
				(dom ? ctx.dom_refs : ctx.component_refs).add(e.name);
				if (ctx.ref_names.has(e.name)) out.attrs.push(dom ? `bind:this={${e.name}}` : `bind:ref={${e.name}}`);
				else {
					ctx.warnings.push(`ref={${e.name}} is not backed by a converted useRef; review the generated ref manually`);
					out.attrs.push(`ref={${e.name}}`);
				}
				continue;
			}
			if (dom && (t.isArrowFunctionExpression(e) || t.isFunctionExpression(e))) {
				// (el) => (x = el)  →  bind:this={x}; anything else runs as an attachment
				const body = t.isBlockStatement(e.body) && e.body.body.length === 1 && t.isExpressionStatement(e.body.body[0]) ? e.body.body[0].expression : e.body;
				const b = unwrap(body as t.Node);
				const p = e.params[0];
				if (t.isAssignmentExpression(b) && t.isIdentifier(b.left) && t.isIdentifier(p) && t.isIdentifier(b.right, { name: p.name })) {
					ctx.dom_refs.add(b.left.name);
					out.attrs.push(`bind:this={${b.left.name}}`);
				} else {
					out.attrs.push(`{@attach ${gen_inline(e)}}`);
					ctx.warnings.push('callback ref → {@attach}: it runs with the element on mount and is not called with null on unmount (return a cleanup instead)');
				}
				continue;
			}
		}
		if (dom && name === 'dangerouslySetInnerHTML' && expr && t.isObjectExpression(expr)) {
			const html = expr.properties.find((p) => t.isObjectProperty(p) && t.isIdentifier(p.key, { name: '__html' })) as t.ObjectProperty | undefined;
			if (html) out.html = gen_inline(html.value);
			continue;
		}
		if (dom && (name === 'css' || name === 'sx')) {
			ctx.warnings.push(`CSS-in-JS: the \`${name}\` prop on <${tag}> has no Svelte equivalent; move those rules into the component's <style> block`);
		}

		// JSX handed to a component: a snippet prop
		if (!dom && expr) {
			const e = unwrap(expr);
			if (is_jsxish(e)) {
				out.snippets.push({ name, params: '', body: e });
				continue;
			}
			if ((t.isArrowFunctionExpression(e) || t.isFunctionExpression(e)) && fn_returns_jsx(e)) {
				out.snippets.push({ name, params: e.params.map(gen_pattern).join(', '), body: t.isBlockStatement(e.body) ? e.body.body : e.body });
				continue;
			}
		}

		const out_name = dom ? (ATTR_MAP[name] ?? (/^on[A-Z]/.test(name) ? dom_event(name, tag, node) : name)) : name;
		if (value == null) out.attrs.push(out_name);
		else if (t.isStringLiteral(value)) out.attrs.push(attr_string(out_name, value.value));
		else if (expr) {
			const e = unwrap(expr);
			if (dom && name === 'style' && t.isObjectExpression(e)) {
				const s = style_object(e, ctx);
				out.attrs.push(s == null ? `style={${gen_inline(e)}}` : attr_string_dynamic('style', s));
			} else if (dom && name === 'style') {
				ctx.warnings.push(`style={${gen_inline(e)}} is an object in React; Svelte wants a string (or style: directives)`);
				out.attrs.push(`style={${gen_inline(e)}}`);
			} else if (t.isBooleanLiteral(e)) {
				if (e.value) out.attrs.push(out_name);
				else if (!dom) out.attrs.push(`${out_name}={false}`);
			} else if (t.isStringLiteral(e)) out.attrs.push(attr_string(out_name, e.value));
			else if (t.isIdentifier(e) && e.name === out_name) out.attrs.push(`{${e.name}}`);
			else out.attrs.push(`${out_name}={${gen_inline(expr)}}`);
		}
	}
	return out;
}

/** A style string that may hold `{expr}` parts: quoted, so Svelte interpolates them. */
function attr_string_dynamic(name: string, value: string): string {
	return `${name}="${value.replace(/"/g, "'")}"`;
}

/** Text from JSX: React collapses whitespace runs with newlines, like this. */
function jsx_text(raw: string): string {
	const lines = raw.split(/\r\n|\n|\r/);
	if (lines.length === 1) return raw.replace(/[ \t]+/g, ' ');
	return lines
		.map((l, i) => {
			let s = l.replace(/\t/g, ' ');
			if (i > 0) s = s.replace(/^ +/, '');
			if (i < lines.length - 1) s = s.replace(/ +$/, '');
			return s;
		})
		.filter((l) => l)
		.join(' ');
}

const safe_text = (s: string) => !/[{}<>]/.test(s);

/** Serialize an expression in child position. */
function expression_child(expr: t.Node, ctx: JsxCtx, indent: string): string {
	const e = unwrap(expr);
	if (is_empty(e)) return '';
	if (is_jsx(e)) return render_node(e, ctx, indent);
	const snip = snippet_ref(e, ctx);
	if (snip) return `${indent}${render_tag(snip)}`;
	if (is_map_call(e) || array_from_call(e)) {
		const each = each_block(e as t.CallExpression & { callee: t.MemberExpression | t.OptionalMemberExpression }, ctx, indent);
		if (each) return each;
	}
	if (t.isConditionalExpression(e) && is_markup(e, ctx)) return if_chain(e, ctx, indent);
	if (t.isLogicalExpression(e) && e.operator === '&&') {
		if (is_empty(e.right)) return '';
		const body = child_block(e.right, ctx, indent + '\t');
		return `${indent}{#if ${gen_inline(e.left)}}\n${body}\n${indent}{/if}`;
	}
	if (t.isLogicalExpression(e) && (e.operator === '||' || e.operator === '??') && is_markup(e, ctx)) {
		const left = unwrap(e.left);
		const snipLeft = snippet_ref(left, ctx);
		// x ?? fallback: render x when present. For a snippet call, test the snippet itself.
		const test = snipLeft ? snipLeft.callee : e.operator === '??' ? `${gen_inline(left)} != null` : gen_inline(left);
		const first = snipLeft ? `${indent}\t${render_tag({ ...snipLeft, optional: false })}` : child_block(left, ctx, indent + '\t');
		const second = child_block(e.right, ctx, indent + '\t');
		return `${indent}{#if ${test}}\n${first}\n${indent}{:else}\n${second}\n${indent}{/if}`;
	}
	if (t.isStringLiteral(e) && safe_text(e.value) && e.value.trim() === e.value && e.value) return `${indent}${e.value}`;
	return `${indent}{${gen_inline(e)}}`;
}

/** A branch's markup, at `indent`. */
function child_block(n: t.Node, ctx: JsxCtx, indent: string): string {
	return render_node(unwrap(n), ctx, indent);
}

/** `a ? A : b ? B : C` → {#if a}A{:else if b}B{:else}C{/if}, dropping empty branches. */
function if_chain(e: t.ConditionalExpression, ctx: JsxCtx, indent: string): string {
	const branches: { test: t.Expression | null; body: t.Node }[] = [];
	let cur: t.Node = e;
	while (t.isConditionalExpression(unwrap(cur))) {
		const c = unwrap(cur) as t.ConditionalExpression;
		branches.push({ test: c.test, body: c.consequent });
		cur = c.alternate;
	}
	branches.push({ test: null, body: cur });
	return blocks(branches, ctx, indent);
}

/** Render a list of (test, body) branches as one {#if} chain. The last may have test null (else). */
function body_empty(body: MarkupBody): boolean {
	return body == null || (Array.isArray(body) ? body.length === 0 : is_empty(body));
}

function render_body(body: MarkupBody, ctx: JsxCtx, indent: string): string {
	if (body == null) return '';
	if (Array.isArray(body)) return statements_to_markup(body, ctx, indent).markup;
	return render_node(unwrap(body), ctx, indent);
}

export function blocks(branches: { test: t.Expression | null; body: MarkupBody }[], ctx: JsxCtx, indent: string): string {
	// trailing empty else: drop it
	const list = branches.slice();
	while (list.length && body_empty(list[list.length - 1].body) && list[list.length - 1].test == null) list.pop();
	if (!list.length) return '';
	if (list.length === 1 && list[0].test == null) return render_body(list[0].body, ctx, indent);
	// a single `c ? null : X` → {#if !c}X{/if}
	if (list.length === 2 && list[1].test == null && body_empty(list[0].body)) {
		return `${indent}{#if ${not(list[0].test!)}}\n${render_body(list[1].body, ctx, indent + '\t')}\n${indent}{/if}`;
	}
	let out = '';
	list.forEach((b, i) => {
		const head = i === 0 ? `{#if ${gen_inline(b.test!)}}` : b.test ? `{:else if ${gen_inline(b.test)}}` : '{:else}';
		const body = !body_empty(b.body) ? render_body(b.body, ctx, indent + '\t') : '';
		out += `${indent}${head}\n${body ? body + '\n' : ''}`;
	});
	return `${out}${indent}{/if}`;
}

/** arr.map((item, i) => { const x = …; if (c) return null; return <li key={item.id}>…</li> }) */
function each_block(call: t.CallExpression & { callee: t.MemberExpression | t.OptionalMemberExpression }, ctx: JsxCtx, indent: string): string | null {
	const from = array_from_call(call);
	const length_prop = from ? (from.arguments[0] as t.ObjectExpression).properties.find((p): p is t.ObjectProperty => t.isObjectProperty(p) && t.isIdentifier(p.key, { name: 'length' })) : null;
	const arr = from && length_prop ? gen_inline(length_prop.value) : gen_inline(call.callee.object);
	const fn = from ? call.arguments[1] : call.arguments[0];
	if (!from && t.isIdentifier(fn)) {
		// items.map(renderItem)
		const call_src = ctx.snippets.has(fn.name) ? `{@render ${fn.name}(item, index)}` : `{${fn.name}(item, index)}`;
		return `${indent}{#each ${arr} as item, index}\n${indent}\t${call_src}\n${indent}{/each}`;
	}
	if (!t.isArrowFunctionExpression(fn) && !t.isFunctionExpression(fn)) return null;
	const item = fn.params[0] ? gen_pattern(fn.params[0]) : '_';
	const idx = fn.params[1] && t.isIdentifier(fn.params[1]) ? fn.params[1].name : null;
	const extra = !from && fn.params[2] && t.isIdentifier(fn.params[2]) ? `{@const ${fn.params[2].name} = ${arr}}\n` : '';
	const inner = indent + '\t';
	let body: string;
	let key: string | null = null;
	if (t.isBlockStatement(fn.body)) {
		const r = statements_to_markup(fn.body.body, ctx, inner, true);
		body = r.markup;
		key = r.key;
	} else {
		const b = unwrap(fn.body);
		key = key_of(b);
		body = render_node(b, ctx, inner);
	}
	const head = `${arr} as ${item}${idx ? `, ${idx}` : ''}${key ? ` (${key})` : ''}`;
	return `${indent}{#each ${head}}\n${extra ? indent + '\t' + extra : ''}${body}\n${indent}{/each}`;
}

/**
 * A function body (in an each block, or a snippet) → markup: declarations become
 * {@const}, `if (c) return X` becomes an {#if} chain around the rest.
 */
export function statements_to_markup(stmts: t.Statement[], ctx: JsxCtx, indent: string, want_key = false): { markup: string; key: string | null } {
	const consts: string[] = [];
	const branches: { test: t.Expression | null; body: MarkupBody }[] = [];
	let key: string | null = null;
	for (const s of stmts) {
		if (t.isVariableDeclaration(s)) {
			for (const d of s.declarations) {
				if (!d.init) continue;
				consts.push(`${indent}{@const ${gen_pattern(d.id)} = ${gen_inline(d.init)}}`);
			}
			continue;
		}
		if (t.isIfStatement(s)) {
			const consequent = t.isBlockStatement(s.consequent) ? s.consequent.body : [s.consequent];
			const ret = sole_return(s.consequent);
			if (ret) {
				branches.push({ test: s.test, body: ret.argument ?? null });
				if (want_key && ret.argument) key = key ?? key_of(unwrap(ret.argument));
				if (s.alternate) {
					const alt = sole_return(s.alternate);
					if (alt) {
						branches.push({ test: null, body: alt.argument ?? null });
						break;
					}
				}
				continue;
			}
			if (consequent.some((item) => t.isReturnStatement(item) && item.argument && is_jsxish(item.argument))) {
				branches.push({ test: s.test, body: consequent });
				continue;
			}
		}
		if (t.isReturnStatement(s)) {
			branches.push({ test: null, body: s.argument ?? null });
			if (want_key && s.argument) key = key_of(unwrap(s.argument)) ?? key;
			break;
		}
		if (t.isEmptyStatement(s)) continue;
		ctx.warnings.push(`statement inside a render callback isn't converted: ${gen_inline(s).slice(0, 60)}`);
	}
	const markup = blocks(branches, ctx, indent);
	return { markup: [...consts, markup].filter(Boolean).join('\n'), key };
}

/** `return x` or `{ return x }` → the return statement. */
export function sole_return(s: t.Statement): t.ReturnStatement | null {
	if (t.isReturnStatement(s)) return s;
	if (t.isBlockStatement(s) && s.body.length === 1 && t.isReturnStatement(s.body[0])) return s.body[0];
	return null;
}

function key_of(el: t.Node): string | null {
	if (!t.isJSXElement(el)) return null;
	for (const attr of el.openingElement.attributes) {
		if (t.isJSXAttribute(attr) && jsx_name(attr.name) === 'key' && attr.value) {
			if (t.isStringLiteral(attr.value)) return JSON.stringify(attr.value.value);
			if (t.isJSXExpressionContainer(attr.value) && !t.isJSXEmptyExpression(attr.value.expression)) return gen_inline(attr.value.expression);
		}
	}
	return null;
}

/** Any node in markup position. */
export function render_node(node: t.Node, ctx: JsxCtx, indent: string): string {
	const n = unwrap(node);
	if (t.isJSXElement(n)) return element(n, ctx, indent);
	if (t.isJSXFragment(n)) return children(n.children, ctx, indent);
	if (t.isExpression(n)) return expression_child(n, ctx, indent);
	return '';
}

const FRAGMENTS = new Set(['Fragment', 'React.Fragment']);

function element(node: t.JSXElement, ctx: JsxCtx, indent: string): string {
	const open = node.openingElement;
	let tag = jsx_name(open.name);
	if (FRAGMENTS.has(tag)) return children(node.children, ctx, indent);

	// <Ctx.Provider value={v}>…</Ctx.Provider> → setContext(Ctx, v) + the children
	if (tag.endsWith('.Provider')) {
		const value = open.attributes.find((a) => t.isJSXAttribute(a) && jsx_name(a.name) === 'value') as t.JSXAttribute | undefined;
		const v = value?.value && t.isJSXExpressionContainer(value.value) && !t.isJSXEmptyExpression(value.value.expression) ? value.value.expression : t.identifier('undefined');
		ctx.provides.push({ key: tag.slice(0, -'.Provider'.length), value: v });
		return children(node.children, ctx, indent);
	}
	if (tag.endsWith('.Consumer')) ctx.warnings.push(`<${tag}> isn't converted: read the value with getContext(${tag.slice(0, -'.Consumer'.length)}) in the script`);

	const styled = ctx.styled.get(tag);
	if (styled) tag = styled.tag;
	const { attrs, html, snippets } = attributes(open, tag, ctx);
	if (styled) {
		const i = attrs.findIndex((a) => a.startsWith('class=') || a.startsWith('className='));
		if (i >= 0) {
			const v = attrs[i].replace(/^class(Name)?=/, '');
			attrs[i] = v.startsWith('"') ? `class="${styled.cls} ${v.slice(1, -1)}"` : `class={['${styled.cls}', ${v.slice(1, -1)}]}`;
		} else attrs.unshift(`class="${styled.cls}"`);
	}
	const attr_str = attrs.length ? ' ' + attrs.join(' ') : '';
	const dom = is_dom_tag(tag);

	const parts: string[] = [];
	for (const s of snippets) parts.push(snippet_block(s.name, s.params, s.body, ctx, indent + '\t'));
	if (html != null) parts.push(`${indent}\t{@html ${html}}`);
	else {
		// a function child: <List>{(item) => <b>{item}</b>}</List> → {#snippet children(item)}
		const fn_children = node.children.filter((c) => t.isJSXExpressionContainer(c) && (t.isArrowFunctionExpression(c.expression) || t.isFunctionExpression(c.expression)));
		if (!dom && fn_children.length === 1) {
			const fn = (fn_children[0] as t.JSXExpressionContainer).expression as t.ArrowFunctionExpression | t.FunctionExpression;
			parts.push(snippet_block('children', fn.params.map(gen_pattern).join(', '), t.isBlockStatement(fn.body) ? fn.body.body : fn.body, ctx, indent + '\t'));
			const rest = children(node.children.filter((c) => c !== fn_children[0]), ctx, indent + '\t');
			if (rest.trim()) ctx.warnings.push(`<${tag}> has a function child and other children; only the function became the children snippet`);
		} else {
			const kids = children(node.children, ctx, indent + '\t');
			if (kids.trim()) parts.push(kids);
		}
	}
	const kids = parts.join('\n');
	if (!kids.trim()) {
		if (VOID.has(tag) || !dom) return `${indent}<${tag}${attr_str} />`;
		return `${indent}<${tag}${attr_str}></${tag}>`;
	}
	// short single-line content stays on one line: <h1>{title}</h1>
	if (!kids.includes('\n') && kids.trim().length + tag.length + attr_str.length < 100) return `${indent}<${tag}${attr_str}>${kids.trim()}</${tag}>`;
	return `${indent}<${tag}${attr_str}>\n${kids}\n${indent}</${tag}>`;
}

/** {#snippet name(params)}…{/snippet} from an expression body or a statement list. */
export function snippet_block(name: string, params: string, body: t.Node | t.Statement[], ctx: JsxCtx, indent: string): string {
	const inner = Array.isArray(body) ? statements_to_markup(body, ctx, indent + '\t').markup : render_node(body, ctx, indent + '\t');
	return `${indent}{#snippet ${name}(${params})}\n${inner}\n${indent}{/snippet}`;
}

function children(nodes: t.Node[], ctx: JsxCtx, indent: string): string {
	const lines: string[] = [];
	let inline: string[] = [];
	const flush = () => {
		const joined = inline.join('').replace(/[ \t]+/g, ' ').trim();
		if (joined) lines.push(indent + joined);
		inline = [];
	};
	for (const child of nodes) {
		if (t.isJSXText(child)) {
			const text = jsx_text(child.value);
			if (!text.trim()) {
				// whitespace with a newline is layout between children, not content
				if (!/\n/.test(child.value) && text) inline.push(' ');
				else flush();
				continue;
			}
			inline.push(text);
		} else if (t.isJSXExpressionContainer(child)) {
			const e = child.expression;
			if (t.isJSXEmptyExpression(e)) continue;
			const u = unwrap(e);
			if (is_empty(u)) continue;
			if (t.isStringLiteral(u) && safe_text(u.value)) {
				inline.push(u.value);
				continue;
			}
			const snip = snippet_ref(u, ctx);
			if (snip) {
				inline.push(render_tag(snip));
				continue;
			}
			if (is_markup(u, ctx) || is_map_call(u) || (t.isLogicalExpression(u) && u.operator === '&&')) {
				flush();
				const block = expression_child(u, ctx, indent);
				if (block) lines.push(block);
			} else if (t.isConditionalExpression(u)) {
				inline.push(`{${gen_inline(u)}}`);
			} else inline.push(`{${gen_inline(u)}}`);
		} else if (t.isJSXElement(child) || t.isJSXFragment(child)) {
			const r = render_node(child, ctx, indent);
			// inline elements next to text stay in the run: Hello, <b>{name}</b>!
			// (JSX whitespace with a newline already ended the run, so adjacency is real)
			if (r && !r.includes('\n')) inline.push(r.trim());
			else {
				flush();
				if (r) lines.push(r);
			}
		} else if (t.isJSXSpreadChild(child)) {
			flush();
			lines.push(`${indent}{${gen_inline(child.expression)}}`);
		}
	}
	flush();
	return lines.join('\n');
}

/** Entry: the component's returned markup. */
export function jsx_to_svelte(node: t.Node, ctx: JsxCtx): string {
	return render_node(unwrap(node), ctx, '').replace(/\n{3,}/g, '\n\n');
}

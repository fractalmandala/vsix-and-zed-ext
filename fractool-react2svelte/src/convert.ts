/**
 * React (TSX/JSX) → Svelte 5 (runes), on the Babel AST.
 *
 * Parses with @babel/parser, finds every component in the file (plain functions,
 * arrows, `memo(…)`, `forwardRef(…)`, default-exported or not), and for each:
 *
 * - props → `$props()` with the original (mapped) types, defaults, rest, a forwarded
 *   `ref` as `$bindable()`, and `children` only when the component uses it;
 * - hooks → runes: useState → $state (setter calls → assignments), useMemo and any
 *   body value that reads reactive state → $derived, useEffect → $effect / onMount,
 *   useRef → bind:this state (DOM) or a plain `let` (anything else), useContext →
 *   getContext, Provider → setContext, useId → $props.id();
 * - early returns → an {#if}/{:else if} chain around the template; JSX held in
 *   variables or returned by inner functions → {#snippet}s;
 * - React types → Svelte types (types.ts), JSX → markup (jsx.ts).
 *
 * The first default-exported component (else the first one) is the main file; the
 * others become their own `.svelte` files, imported where they are used.
 */

import { parse } from '@babel/parser';
import _traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { gen, gen_inline } from './gen.ts';
import { blocks, fn_returns_jsx, is_jsxish, render_node, snippet_block, sole_return, statements_to_markup, unwrap, type JsxCtx, type MarkupBody } from './jsx.ts';
import { is_node_type, is_render_fn_type, map_react_types, new_type_use, type TypeUse } from './types.ts';
import { normalize_class_components } from './class-to-function.ts';

const traverse = ((_traverse as unknown as { default?: typeof _traverse }).default ?? _traverse) as typeof _traverse;

export interface ConvertedFile {
	/** `Name.svelte` */
	name: string;
	code: string;
	warnings: string[];
}

export interface ConversionResult {
	/** The main file's code (the default export, else the first component). */
	svelte: string;
	files: ConvertedFile[];
	/** Every file's warnings; prefixed with the file name when there are several files. */
	warnings: string[];
}

/** Input that does not parse, or has no component. `line` is 1-based when known. */
export class ReactConvertError extends Error {
	constructor(
		message: string,
		readonly line: number | null = null
	) {
		super(message);
	}
}

type Fn = t.FunctionDeclaration | t.ArrowFunctionExpression | t.FunctionExpression;

interface Found {
	name: string;
	fn: Fn;
	top: t.Statement;
	is_default: boolean;
	forward_ref: boolean;
	ref_type: t.TSType | null;
	/** From forwardRef<R, P> or `const C: FC<P>`. */
	props_type: t.TSType | null;
}

const CSS_IN_JS = new Set(['styled-components', '@emotion/styled', '@emotion/react', '@emotion/css', 'styled-jsx', '@stitches/react', '@vanilla-extract/css', 'goober', '@linaria/core', '@linaria/react', 'linaria']);
export const REACT_SOURCES = (s: string) => s === 'react' || s === 'react-dom' || s.startsWith('react/') || s.startsWith('react-dom/');
export const KNOWN_HOOKS = new Set(['useState', 'useEffect', 'useLayoutEffect', 'useInsertionEffect', 'useMemo', 'useRef', 'useCallback', 'useReducer', 'useContext', 'useId', 'useImperativeHandle', 'useTransition', 'useDeferredValue', 'useSyncExternalStore', 'useDebugValue', 'useOptimistic', 'useActionState']);

const is_component_name = (s: string) => /^[A-Z]/.test(s);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function callee_name(e: t.Node): string | null {
	if (t.isIdentifier(e)) return e.name;
	if (t.isMemberExpression(e) && t.isIdentifier(e.object, { name: 'React' }) && t.isIdentifier(e.property) && !e.computed) return e.property.name;
	return null;
}

export function hook_call(e: t.Node | null | undefined): { name: string; call: t.CallExpression } | null {
	if (!e) return null;
	const u = unwrap(e);
	if (!t.isCallExpression(u)) return null;
	const name = callee_name(u.callee);
	return name && /^use[A-Z]/.test(name) ? { name, call: u } : null;
}

export const type_args = (call: t.CallExpression): t.TSType[] => (call.typeArguments?.params ?? []) as t.TSType[];

/** Names an expression reads (approximate: identifiers that are not property keys). */
export function reads(node: t.Node): Set<string> {
	const out = new Set<string>();
	const visit = (n: t.Node, parent: t.Node | null) => {
		if (t.isIdentifier(n)) {
			if (parent && (t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) && parent.property === n && !parent.computed) return;
			if (parent && t.isObjectProperty(parent) && parent.key === n && !parent.computed && parent.value !== n) return;
			out.add(n.name);
			return;
		}
		if (t.isJSXIdentifier(n)) {
			out.add(n.name);
			return;
		}
		for (const k of t.VISITOR_KEYS[n.type] ?? []) {
			if (k === 'typeAnnotation' || k === 'typeArguments' || k === 'typeParameters' || k === 'returnType') continue;
			const c = (n as unknown as Record<string, unknown>)[k];
			if (Array.isArray(c)) c.forEach((x) => x && typeof x === 'object' && 'type' in x && visit(x as t.Node, n));
			else if (c && typeof c === 'object' && 'type' in c) visit(c as t.Node, n);
		}
	};
	visit(node, null);
	return out;
}

/** Names read synchronously (outside nested functions): what an $effect tracks. */
export function sync_reads(node: t.Node): Set<string> {
	const out = new Set<string>();
	const visit = (n: t.Node, parent: t.Node | null) => {
		if (t.isFunction(n)) return;
		if (t.isIdentifier(n)) {
			if (parent && (t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) && parent.property === n && !parent.computed) return;
			if (parent && t.isAssignmentExpression(parent) && parent.left === n && parent.operator === '=') return;
			out.add(n.name);
			return;
		}
		for (const k of t.VISITOR_KEYS[n.type] ?? []) {
			const c = (n as unknown as Record<string, unknown>)[k];
			if (Array.isArray(c)) c.forEach((x) => x && typeof x === 'object' && 'type' in x && visit(x as t.Node, n));
			else if (c && typeof c === 'object' && 'type' in c) visit(c as t.Node, n);
		}
	};
	visit(node, null);
	return out;
}

/** Names assigned in `node` outside nested functions (what runs during render). */
export function render_writes(node: t.Node): Set<string> {
	const out = new Set<string>();
	const visit = (n: t.Node) => {
		if (t.isFunction(n)) return;
		if (t.isAssignmentExpression(n) && t.isIdentifier(n.left)) out.add(n.left.name);
		if (t.isUpdateExpression(n) && t.isIdentifier(n.argument)) out.add(n.argument.name);
		for (const k of t.VISITOR_KEYS[n.type] ?? []) {
			const c = (n as unknown as Record<string, unknown>)[k];
			if (Array.isArray(c)) c.forEach((x) => x && typeof x === 'object' && 'type' in x && visit(x as t.Node));
			else if (c && typeof c === 'object' && 'type' in c) visit(c as t.Node);
		}
	};
	visit(node);
	return out;
}

export const has_jsx = (node: t.Node) => {
	let found = false;
	t.traverseFast(node, (n) => {
		if (t.isJSXElement(n) || t.isJSXFragment(n)) found = true;
	});
	return found;
};

export function indent(text: string, by = '\t'): string {
	return text
		.split('\n')
		.map((l) => (l.trim() ? by + l : ''))
		.join('\n');
}

// --- discovery -----------------------------------------------------------------

/** memo(…), forwardRef(…), React.memo(forwardRef(…)) → the function inside. */
function unwrap_component(e: t.Node, info: Partial<Found>): Fn | null {
	const u = unwrap(e);
	if (t.isArrowFunctionExpression(u) || t.isFunctionExpression(u)) return u;
	if (t.isCallExpression(u)) {
		const name = callee_name(u.callee);
		if (name === 'forwardRef') {
			info.forward_ref = true;
			const [r, p] = type_args(u);
			info.ref_type = r ?? null;
			info.props_type = p ?? null;
			return u.arguments[0] ? unwrap_component(u.arguments[0], info) : null;
		}
		if (name === 'memo') return u.arguments[0] ? unwrap_component(u.arguments[0], info) : null;
	}
	return null;
}

function fc_props_type(id: t.Node): t.TSType | null {
	if (!t.isIdentifier(id) || !id.typeAnnotation || !t.isTSTypeAnnotation(id.typeAnnotation)) return null;
	const ann = id.typeAnnotation.typeAnnotation;
	if (!t.isTSTypeReference(ann)) return null;
	const n = ann.typeName;
	const name = t.isIdentifier(n) ? n.name : t.isTSQualifiedName(n) ? n.right.name : '';
	if (['FC', 'FunctionComponent', 'VFC'].includes(name)) return ann.typeArguments?.params[0] ?? null;
	return null;
}

interface Discovery {
	components: Found[];
	/** displayName / defaultProps / propTypes assignments: not carried over. */
	dropped: Set<t.Statement>;
	default_props: Map<string, t.ObjectExpression>;
	warnings: string[];
}

function discover(ast: t.File): Discovery {
	const d: Discovery = { components: [], dropped: new Set(), default_props: new Map(), warnings: [] };
	const add = (name: string, fn: Fn, top: t.Statement, info: Partial<Found>, is_default = false) => {
		if (!info.forward_ref && !is_component_name(name)) return;
		if (!fn_returns_jsx(fn)) return;
		d.components.push({ name, fn, top, is_default, forward_ref: !!info.forward_ref, ref_type: info.ref_type ?? null, props_type: info.props_type ?? null });
	};
	let default_name: string | null = null;
	for (const stmt of ast.program.body) {
		const decl = t.isExportNamedDeclaration(stmt) ? stmt.declaration : stmt;
		if (t.isFunctionDeclaration(decl) && decl.id) add(decl.id.name, decl, stmt, {});
		else if (t.isVariableDeclaration(decl)) {
			for (const v of decl.declarations) {
				if (!t.isIdentifier(v.id) || !v.init) continue;
				const info: Partial<Found> = { props_type: fc_props_type(v.id) };
				const fn = unwrap_component(v.init, info);
				if (fn) add(v.id.name, fn, stmt, info);
			}
		} else if (t.isExportDefaultDeclaration(stmt)) {
			const dd = stmt.declaration;
			if (t.isFunctionDeclaration(dd)) add(dd.id?.name ?? 'Component', dd, stmt, {}, true);
			else if (t.isIdentifier(dd)) default_name = dd.name;
			else if (!t.isClassDeclaration(dd) && t.isExpression(dd)) {
				const inner = unwrap(dd);
				// export default memo(Foo)
				if (t.isCallExpression(inner) && t.isIdentifier(inner.arguments[0]) && ['memo', 'forwardRef'].includes(callee_name(inner.callee) ?? '')) default_name = inner.arguments[0].name;
				else {
					const info: Partial<Found> = {};
					const fn = unwrap_component(dd, info);
					if (fn) add((t.isFunctionExpression(fn) && fn.id?.name) || 'Component', fn, stmt, { ...info, forward_ref: info.forward_ref || true }, true);
				}
			}
		} else if (t.isExpressionStatement(stmt) && t.isAssignmentExpression(stmt.expression) && t.isMemberExpression(stmt.expression.left)) {
			const left = stmt.expression.left;
			if (t.isIdentifier(left.object) && t.isIdentifier(left.property) && !left.computed) {
				const prop = left.property.name;
				if (prop === 'displayName' || prop === 'propTypes' || prop === 'defaultProps') {
					d.dropped.add(stmt);
					if (prop === 'defaultProps' && t.isObjectExpression(stmt.expression.right)) d.default_props.set(left.object.name, stmt.expression.right);
					if (prop === 'propTypes') d.warnings.push(`${left.object.name}.propTypes dropped: use TypeScript prop types instead`);
				}
			}
		}
	}
	if (default_name) for (const c of d.components) if (c.name === default_name) c.is_default = true;
	// an anonymous default export that came through unwrap_component without forwardRef
	for (const c of d.components) if (c.is_default && t.isExportDefaultDeclaration(c.top) && !t.isFunctionDeclaration(c.top.declaration)) {
		// memo(forwardRef(fn)): walk the wrappers; any forwardRef in the chain counts.
		let inner = unwrap(c.top.declaration as t.Node);
		let forwards = false;
		while (t.isCallExpression(inner)) {
			if (callee_name(inner.callee) === 'forwardRef') forwards = true;
			inner = unwrap(inner.arguments[0] as t.Node);
		}
		c.forward_ref = forwards;
	}
	return d;
}

// --- props ------------------------------------------------------------------------

interface Props {
	line: string;
	/** Local names props bind (reactive). */
	locals: Set<string>;
	snippets: Set<string>;
	props_id: string | null;
	/** Extra `let {…} = $derived(prop)` lines for nested destructuring. */
	nested: string[];
	ref_local: string | null;
}

/** Members of a props type: inline literal, local interface/type alias, intersections. */
function type_members(type: t.Node | null | undefined, ast: t.File, seen = new Set<string>()): Map<string, t.Node | null> {
	const out = new Map<string, t.Node | null>();
	if (!type) return out;
	const add_members = (members: t.Node[]) => {
		for (const m of members) if (t.isTSPropertySignature(m) && (t.isIdentifier(m.key) || t.isStringLiteral(m.key))) out.set(t.isIdentifier(m.key) ? m.key.name : m.key.value, m.typeAnnotation ?? null);
	};
	if (t.isTSTypeAnnotation(type)) return type_members(type.typeAnnotation, ast, seen);
	if (t.isTSTypeLiteral(type)) add_members(type.members);
	else if (t.isTSIntersectionType(type)) for (const x of type.types) for (const [k, v] of type_members(x, ast, seen)) out.set(k, v);
	else if (t.isTSParenthesizedType(type)) return type_members(type.typeAnnotation, ast, seen);
	else if (t.isTSTypeReference(type)) {
		const n = type.typeName;
		const name = t.isIdentifier(n) ? n.name : t.isTSQualifiedName(n) ? n.right.name : '';
		if (name === 'PropsWithChildren') {
			out.set('children', null);
			for (const [k, v] of type_members(type.typeArguments?.params[0], ast, seen)) out.set(k, v);
			return out;
		}
		if (!t.isIdentifier(n) || seen.has(n.name)) return out;
		seen.add(n.name);
		for (const stmt of ast.program.body) {
			const decl = t.isExportNamedDeclaration(stmt) ? stmt.declaration : stmt;
			if (t.isTSInterfaceDeclaration(decl) && decl.id.name === n.name) {
				add_members(decl.body.body);
				for (const ext of decl.extends ?? []) if (t.isIdentifier(ext.expression)) for (const [k, v] of type_members(t.tsTypeReference(t.identifier(ext.expression.name)), ast, seen)) if (!out.has(k)) out.set(k, v);
			}
			if (t.isTSTypeAliasDeclaration(decl) && decl.id.name === n.name) for (const [k, v] of type_members(decl.typeAnnotation, ast, seen)) out.set(k, v);
		}
	}
	return out;
}

function props_type_of(c: Found, ast: t.File, single: boolean): t.TSType | null {
	const p0 = c.fn.params[0];
	const target = p0 && t.isAssignmentPattern(p0) ? p0.left : p0;
	if (target && (t.isObjectPattern(target) || t.isIdentifier(target)) && target.typeAnnotation && t.isTSTypeAnnotation(target.typeAnnotation)) return target.typeAnnotation.typeAnnotation;
	if (c.props_type) return c.props_type;
	// a module-level `<Name>Props`, or the only `*Props` when the file has one component
	const names = [`${c.name}Props`];
	for (const stmt of ast.program.body) {
		const decl = t.isExportNamedDeclaration(stmt) ? stmt.declaration : stmt;
		if ((t.isTSInterfaceDeclaration(decl) || t.isTSTypeAliasDeclaration(decl)) && (names.includes(decl.id.name) || (single && p0 && /Props$/.test(decl.id.name)))) {
			return t.tsTypeReference(t.identifier(decl.id.name));
		}
	}
	return null;
}

function analyze_props(c: Found, ast: t.File, react: Set<string>, defaults: t.ObjectExpression | undefined, single: boolean): { props: Omit<Props, 'line'>; type: t.TSType | null; build: () => string } {
	const p0raw = c.fn.params[0];
	const p0 = p0raw && t.isAssignmentPattern(p0raw) ? p0raw.left : p0raw;
	const p1 = c.forward_ref ? c.fn.params[1] : undefined;
	const type = props_type_of(c, ast, single);
	const members = type_members(type, ast);
	const props: Omit<Props, 'line'> = { locals: new Set(), snippets: new Set(), props_id: null, nested: [], ref_local: null };
	for (const [k, v] of members) if (is_node_type(v, react) || is_render_fn_type(v, react)) props.snippets.add(k);
	const default_of = new Map<string, string>();
	for (const p of defaults?.properties ?? []) if (t.isObjectProperty(p) && t.isIdentifier(p.key)) default_of.set(p.key.name, gen_inline(p.value));

	const entries: string[] = [];
	let rest: string | null = null;
	if (p0 && t.isObjectPattern(p0)) {
		for (const p of p0.properties) {
			if (t.isRestElement(p)) {
				rest = t.isIdentifier(p.argument) ? p.argument.name : 'rest';
				props.locals.add(rest);
				continue;
			}
			const key = t.isIdentifier(p.key) ? p.key.name : t.isStringLiteral(p.key) ? p.key.value : null;
			if (!key) continue;
			let value: t.Node = p.value;
			let def: string | null = default_of.get(key) ?? null;
			if (t.isAssignmentPattern(value)) {
				def = gen_inline(value.right);
				value = value.left;
			}
			const suffix = def != null ? ` = ${def}` : '';
			if (t.isIdentifier(value)) {
				props.locals.add(value.name);
				if (/^render[A-Z]/.test(key) || key === 'children') props.snippets.add(value.name);
				else if (props.snippets.has(key) && value.name !== key) props.snippets.add(value.name);
				entries.push(value.name === key ? `${key}${suffix}` : `${key}: ${value.name}${suffix}`);
			} else {
				// nested destructuring: bind the prop whole, destructure it reactively
				props.locals.add(key);
				entries.push(`${key}${suffix}`);
				const inner = t.cloneNode(value, true) as t.ObjectPattern | t.ArrayPattern;
				for (const name of Object.keys(t.getBindingIdentifiers(inner))) props.locals.add(name);
				props.nested.push(`let ${gen_inline(inner)} = $derived(${key});`);
			}
		}
	} else if (p0 && t.isIdentifier(p0)) {
		props.props_id = p0.name;
		props.locals.add(p0.name);
	}
	// keep only snippet names that are actually bound
	if (!props.props_id) for (const s of [...props.snippets]) if (!props.locals.has(s)) props.snippets.delete(s);
	if (p1 && t.isIdentifier(p1)) props.ref_local = p1.name;

	const build = () => {
		let annotation = type ? gen_inline(type) : '';
		if (props.ref_local) {
			const rt = c.ref_type ? gen_inline(c.ref_type) : 'HTMLElement';
			annotation = annotation ? `${annotation} & { ref?: ${rt} | null }` : '';
		}
		const ann = annotation ? `: ${annotation}` : '';
		if (props.props_id) {
			if (props.ref_local) return `let { ref: ${props.ref_local} = $bindable(null), ...${props.props_id} }${ann} = $props();`;
			return `let ${props.props_id}${ann} = $props();`;
		}
		const list = [...entries];
		if (props.ref_local) list.push(props.ref_local === 'ref' ? 'ref = $bindable(null)' : `ref: ${props.ref_local} = $bindable(null)`);
		if (rest) list.push(`...${rest}`);
		if (!list.length) return '';
		return `let { ${list.join(', ')} }${ann} = $props();`;
	};
	return { props, type, build };
}

// --- per-component conversion ------------------------------------------------------

interface Converted {
	name: string;
	script: string[];
	snippets: string[];
	template: string;
	svelte_imports: Set<string>;
	generics: string | null;
	warnings: string[];
}

interface FileCtx {
	ast: t.File;
	react: Set<string>;
	paths: Map<t.Node, NodePath<t.Function>>;
	jsx_helpers: t.FunctionDeclaration[];
	contexts: Map<string, { def: t.Expression | null; type: t.TSType | null }>;
	styled: Map<string, { tag: string; cls: string }>;
	types: TypeUse;
}

function convert_component(c: Found, fc: FileCtx, analysis: ReturnType<typeof analyze_props>): Converted {
	const warnings: string[] = [];
	const svelte_imports = new Set<string>();
	const path = fc.paths.get(c.fn)!;
	const body: t.Statement[] = t.isBlockStatement(c.fn.body) ? c.fn.body.body : [];
	const { props } = analysis;

	// 1. state setters → assignments (scope-aware: a shadowing name is left alone)
	const states = new Map<string, { name: string; type: t.TSType | null }>(); // setter → state
	for (const stmt of body) {
		if (!t.isVariableDeclaration(stmt)) continue;
		for (const d of stmt.declarations) {
			const h = hook_call(d.init);
			if (h?.name === 'useState' && t.isArrayPattern(d.id)) {
				const [a, b] = d.id.elements;
				if (t.isIdentifier(a) && t.isIdentifier(b)) states.set(b.name, { name: a.name, type: type_args(h.call)[0] ?? null });
			}
		}
	}
	const setter_values = new Set<string>();
	const binding_of = new Map([...states.keys()].map((s) => [s, path.scope.getBinding(s)]));
	path.traverse({
		CallExpression(p) {
			const callee = p.node.callee;
			if (!t.isIdentifier(callee) || !states.has(callee.name)) return;
			if (p.scope.getBinding(callee.name) !== binding_of.get(callee.name)) return;
			const state = states.get(callee.name)!.name;
			const arg = p.node.arguments[0];
			let rhs: t.Expression;
			if (arg && (t.isArrowFunctionExpression(arg) || t.isFunctionExpression(arg))) rhs = updater(arg, state);
			else rhs = (arg as t.Expression) ?? t.identifier('undefined');
			p.replaceWith(t.assignmentExpression('=', t.identifier(state), rhs));
		},
		Identifier(p) {
			if (!states.has(p.node.name) || !p.isReferencedIdentifier()) return;
			if (p.scope.getBinding(p.node.name) !== binding_of.get(p.node.name)) return;
			if (t.isCallExpression(p.parent) && p.parent.callee === p.node) return;
			setter_values.add(p.node.name);
		}
	});

	// 2. refs: which are bound to DOM elements (or a child component's ref), then `.current` → the value
	const refs = new Map<string, { init: t.Expression | null; type: t.TSType | null }>();
	for (const stmt of body) {
		if (!t.isVariableDeclaration(stmt)) continue;
		for (const d of stmt.declarations) {
			const h = hook_call(d.init);
			if (h?.name === 'useRef' && t.isIdentifier(d.id)) refs.set(d.id.name, { init: (h.call.arguments[0] as t.Expression) ?? null, type: type_args(h.call)[0] ?? null });
		}
	}
	const dom_refs = new Set<string>();
	const component_refs = new Set<string>();
	path.traverse({
		JSXAttribute(p) {
			if (!t.isJSXIdentifier(p.node.name, { name: 'ref' }) || !t.isJSXExpressionContainer(p.node.value)) return;
			const e = unwrap(p.node.value.expression);
			const open = p.parent as t.JSXOpeningElement;
			const dom = t.isJSXIdentifier(open.name) && /^[a-z]/.test(open.name.name);
			if (t.isIdentifier(e)) (dom ? dom_refs : component_refs).add(e.name);
			// (el) => (x.current = el) / (el) => (x = el): bound with bind:this too
			if (dom && (t.isArrowFunctionExpression(e) || t.isFunctionExpression(e))) {
				const b = unwrap((t.isBlockStatement(e.body) && e.body.body.length === 1 && t.isExpressionStatement(e.body.body[0]) ? e.body.body[0].expression : e.body) as t.Node);
				if (t.isAssignmentExpression(b)) {
					const l = b.left;
					if (t.isIdentifier(l)) dom_refs.add(l.name);
					else if (t.isMemberExpression(l) && t.isIdentifier(l.object) && t.isIdentifier(l.property, { name: 'current' })) dom_refs.add(l.object.name);
				}
			}
		}
	});
	const ref_names = new Set([...refs.keys()]);
	if (props.ref_local) ref_names.add(props.ref_local);
	path.traverse({
		MemberExpression(p) {
			const n = p.node;
			if (t.isIdentifier(n.object) && ref_names.has(n.object.name) && t.isIdentifier(n.property, { name: 'current' }) && !n.computed) p.replaceWith(t.identifier(n.object.name));
		},
		OptionalMemberExpression(p) {
			const n = p.node;
			if (t.isIdentifier(n.object) && ref_names.has(n.object.name) && t.isIdentifier(n.property, { name: 'current' }) && !n.computed) p.replaceWith(t.identifier(n.object.name));
		}
	});

	// 3. walk the body in order
	const reactive = new Set<string>([...props.locals]);
	const snippets = new Set<string>(props.snippets);
	const optional = new Set<string>(props.snippets);
	const script: string[] = [...props.nested];
	const local_snippets: { name: string; params: string; body: t.Node | t.Statement[] }[] = [];
	for (const helper of fc.jsx_helpers) {
		if (!helper.id) continue;
		snippets.add(helper.id.name);
		local_snippets.push({ name: helper.id.name, params: helper.params.map((p) => gen_pattern_safe(p)).join(', '), body: helper.body.body });
	}
	const branches: { test: t.Expression | null; body: MarkupBody }[] = [];
	let final: t.Node | null = t.isBlockStatement(c.fn.body) ? null : c.fn.body;
	const state_names = new Set([...states.values()].map((s) => s.name));

	const branch_body = (statements: t.Statement[]): MarkupBody | null => {
		if (!statements.length) return null;
		const last = statements[statements.length - 1];
		if (t.isReturnStatement(last)) return statements.length === 1 ? last.argument ?? null : statements;
		return statements;
	};
	const branch_statements = (statement: t.Statement): { test: t.Expression | null; body: MarkupBody }[] | null => {
		if (t.isIfStatement(statement)) {
			const consequent = t.isBlockStatement(statement.consequent) ? statement.consequent.body : [statement.consequent];
			const out: { test: t.Expression | null; body: MarkupBody }[] = [{ test: statement.test, body: branch_body(consequent) }];
			if (statement.alternate) {
				if (t.isIfStatement(statement.alternate)) out.push(...(branch_statements(statement.alternate) ?? []));
				else out.push({ test: null, body: branch_body(t.isBlockStatement(statement.alternate) ? statement.alternate.body : [statement.alternate]) });
			}
			return out;
		}
		if (t.isSwitchStatement(statement)) {
			const out: { test: t.Expression | null; body: MarkupBody }[] = [];
			for (const c of statement.cases) {
				const test = c.test ? t.binaryExpression('===', t.cloneNode(statement.discriminant, true) as t.Expression, t.cloneNode(c.test, true) as t.Expression) : null;
				out.push({ test, body: branch_body(c.consequent) });
			}
			return out;
		}
		return null;
	};

	// lets assigned during render (`let label = 'a'; if (x) label = 'b'`): fold into $derived.by
	const render_lets = new Map<string, { decl: t.VariableDeclarator; kind: string; stmts: t.Statement[] }>();
	for (const stmt of body) if (t.isVariableDeclaration(stmt) && stmt.kind === 'let') for (const d of stmt.declarations) if (t.isIdentifier(d.id) && !hook_call(d.init)) render_lets.set(d.id.name, { decl: d, kind: stmt.kind, stmts: [] });
	const folded = new Set<t.Statement>();
	for (const stmt of body) {
		if (t.isVariableDeclaration(stmt) || t.isFunctionDeclaration(stmt) || t.isReturnStatement(stmt)) continue;
		const w = [...render_writes(stmt)].filter((n) => render_lets.has(n));
		if (w.length === 1) {
			render_lets.get(w[0])!.stmts.push(stmt);
			folded.add(stmt);
		} else if (w.length > 1) warnings.push(`a statement assigns several render-time variables (${w.join(', ')}); it runs once in Svelte, so compute them with $derived by hand`);
	}

	const is_reactive_expr = (e: t.Node) => [...reads(e)].some((n) => reactive.has(n));
	const mark = (id: t.Node) => {
		for (const n of Object.keys(t.getBindingIdentifiers(id))) reactive.add(n);
	};

	// JSX-valued consts and JSX-returning inner functions → snippets (known before the template renders)
	for (const stmt of body) {
		if (t.isFunctionDeclaration(stmt) && stmt.id && fn_returns_jsx(stmt)) snippets.add(stmt.id.name);
		if (t.isVariableDeclaration(stmt))
			for (const d of stmt.declarations) {
				if (!t.isIdentifier(d.id) || !d.init) continue;
				const init = unwrap(d.init);
				if (is_jsxish(init) || ((t.isArrowFunctionExpression(init) || t.isFunctionExpression(init)) && fn_returns_jsx(init))) snippets.add(d.id.name);
			}
	}

	for (const stmt of body) {
		if (folded.has(stmt)) continue;
		const rendered_branches = branch_statements(stmt);
		if (rendered_branches && rendered_branches.some((branch) => {
			const body = branch.body;
			return body != null && (Array.isArray(body) ? body.some((item) => t.isReturnStatement(item) && item.argument && is_jsxish(item.argument)) : is_jsxish(body));
		})) {
			branches.push(...rendered_branches);
			continue;
		}
		// early returns
		if (t.isIfStatement(stmt)) {
			const ret = sole_return(stmt.consequent);
			if (ret && (!ret.argument || is_jsxish(ret.argument) || t.isNullLiteral(ret.argument) || t.isStringLiteral(ret.argument) || t.isExpression(ret.argument))) {
				branches.push({ test: stmt.test, body: ret.argument ?? null });
				if (stmt.alternate) {
					const alt = sole_return(stmt.alternate);
					if (alt) {
						final = alt.argument ?? t.nullLiteral();
						break;
					}
					warnings.push('an else branch after an early return is not converted');
				}
				continue;
			}
		}
		if (t.isReturnStatement(stmt)) {
			final = stmt.argument ?? t.nullLiteral();
			break;
		}
		if (t.isExpressionStatement(stmt)) {
			const h = hook_call(stmt.expression);
			if (h) {
				script.push(...effect_hook(h, state_names, svelte_imports, warnings));
				continue;
			}
		}
		if (t.isVariableDeclaration(stmt)) {
			for (const d of stmt.declarations) {
				const line = declarator(d, stmt.kind);
				if (line) script.push(line);
			}
			continue;
		}
		if (t.isFunctionDeclaration(stmt)) {
			if (stmt.id && fn_returns_jsx(stmt)) snippets.add(stmt.id.name);
			if (stmt.id && snippets.has(stmt.id.name)) {
				local_snippets.push({ name: stmt.id.name, params: stmt.params.map((p) => gen_pattern_safe(p)).join(', '), body: stmt.body.body });
				continue;
			}
			if (has_jsx(stmt)) warnings.push(`JSX inside ${stmt.id?.name ?? 'a function'}() isn't converted`);
			if (stmt.id && is_reactive_expr(stmt)) reactive.add(stmt.id.name);
			script.push(gen(stmt));
			continue;
		}
		if (has_jsx(stmt)) warnings.push(`JSX inside a statement isn't converted: ${gen_inline(stmt).slice(0, 60)}`);
		if (!t.isEmptyStatement(stmt)) {
			warnings.push(`\`${gen_inline(stmt).slice(0, 50)}\` runs on every render in React but once in Svelte; move it into an $effect or $derived`);
			script.push(gen(stmt));
		}
	}

	function declarator(d: t.VariableDeclarator, kind: string): string | null {
		const h = hook_call(d.init);
		if (h) return hook_decl(d, h);
		if (!d.init) {
			if (t.isIdentifier(d.id) && render_lets.get(d.id.name)?.stmts.length) return let_derived(d);
			return `${kind} ${gen(d)};`;
		}
		const init = unwrap(d.init);
		if (t.isIdentifier(d.id) && snippets.has(d.id.name)) {
			if (is_jsxish(init)) local_snippets.push({ name: d.id.name, params: '', body: init });
			else if (t.isArrowFunctionExpression(init) || t.isFunctionExpression(init)) local_snippets.push({ name: d.id.name, params: init.params.map((p) => gen_pattern_safe(p)).join(', '), body: t.isBlockStatement(init.body) ? init.body.body : init.body });
			return null;
		}
		if (has_jsx(init)) warnings.push(`JSX inside script isn't converted: ${gen_inline(d).slice(0, 60)}`);
		if (t.isArrowFunctionExpression(init) || t.isFunctionExpression(init)) {
			if (t.isIdentifier(d.id) && is_reactive_expr(init)) reactive.add(d.id.name);
			return `${kind} ${gen(d)};`;
		}
		if (t.isIdentifier(d.id) && render_lets.get(d.id.name)?.stmts.length) {
			mark(d.id);
			return let_derived(d);
		}
		if (is_reactive_expr(init)) {
			mark(d.id);
			const ann = t.isIdentifier(d.id) && d.id.typeAnnotation ? gen_inline(d.id.typeAnnotation.typeAnnotation) : '';
			const id = t.isIdentifier(d.id) ? d.id.name : gen_inline(d.id);
			return `let ${id}${ann ? ann.replace(/^:?\s*/, ': ') : ''} = $derived(${gen_inline(d.init)});`;
		}
		return `${kind} ${gen(d)};`;
	}

	function let_derived(d: t.VariableDeclarator): string {
		const id = d.id as t.Identifier;
		const info = render_lets.get(id.name)!;
		mark(id);
		const ann = id.typeAnnotation ? gen_inline(id.typeAnnotation.typeAnnotation).replace(/^:?\s*/, ': ') : '';
		const inner = [`let ${id.name}${ann}${d.init ? ` = ${gen(d.init)}` : ''};`, ...info.stmts.map((s) => gen(s)), `return ${id.name};`].join('\n');
		return `let ${id.name}${ann} = $derived.by(() => {\n${indent(inner)}\n});`;
	}

	function hook_decl(d: t.VariableDeclarator, h: { name: string; call: t.CallExpression }): string | null {
		const args = h.call.arguments;
		const targs = type_args(h.call);
		const targ = targs[0] ? `<${gen_inline(targs[0])}>` : '';
		switch (h.name) {
			case 'useState': {
				if (!t.isArrayPattern(d.id)) break;
				const [a, b] = d.id.elements;
				const name = t.isIdentifier(a) ? a.name : 'value';
				reactive.add(name);
				let init = args[0] ? (args[0] as t.Expression) : null;
				let init_src = init ? gen_inline(init) : '';
				// lazy initializer: useState(() => compute())
				if (init && (t.isArrowFunctionExpression(init) || t.isFunctionExpression(init)) && init.params.length === 0) {
					init_src = t.isBlockStatement(init.body) ? `(${gen(init)})()` : gen_inline(unwrap(init.body));
					init = null;
				}
				const lines = [`let ${name} = $state${targ}(${init_src});`];
				const setter = t.isIdentifier(b) ? b.name : null;
				if (setter && setter_values.has(setter)) {
					const ty = targs[0] ? gen_inline(targs[0]) : null;
					const param = ty ? `value: ${ty} | ((prev: ${ty}) => ${ty})` : 'value';
					lines.push(`function ${setter}(${param}) {\n\t${name} = typeof value === 'function' ? (value as (prev: ${ty ?? 'any'}) => ${ty ?? 'any'})(${name}) : value;\n}`);
				}
				return lines.join('\n');
			}
			case 'useReducer': {
				if (!t.isArrayPattern(d.id)) break;
				const [a, b] = d.id.elements;
				const name = t.isIdentifier(a) ? a.name : 'state';
				const dispatch = t.isIdentifier(b) ? b.name : 'dispatch';
				reactive.add(name);
				const reducer = args[0] ? gen_inline(args[0]) : 'reducer';
				const init = args[2] ? `${gen_inline(args[2])}(${args[1] ? gen_inline(args[1]) : ''})` : args[1] ? gen_inline(args[1]) : 'undefined';
				const action = t.isIdentifier(args[0]) ? `: Parameters<typeof ${reducer}>[1]` : '';
				const state_type = targ || (t.isIdentifier(args[0]) && !args[2] ? `<Parameters<typeof ${reducer}>[0]>` : '');
				return `let ${name} = $state${state_type}(${init});\nfunction ${dispatch}(action${action}) {\n\t${name} = ${reducer}(${name}, action);\n}`;
			}
			case 'useRef': {
				if (!t.isIdentifier(d.id)) break;
				const name = d.id.name;
				const ref = refs.get(name)!;
				const ty = ref.type ? gen_inline(ref.type) : null;
				if (dom_refs.has(name)) {
					reactive.add(name);
					return `let ${name} = $state<${ty ?? 'HTMLElement'} | null>(null);`;
				}
				if (component_refs.has(name)) {
					reactive.add(name);
					warnings.push(`ref={${name}} on a component → bind:ref; the child must declare \`ref = $bindable()\``);
					return `let ${name} = $state${ty ? `<${ty} | null>` : ''}(null);`;
				}
				const init = ref.init ? gen_inline(ref.init) : 'undefined';
				const nullable = ty && ref.init && t.isNullLiteral(ref.init) && !/\bnull\b/.test(ty) ? `${ty} | null` : ty;
				return `let ${name}${nullable ? `: ${nullable}` : ''} = ${init};`;
			}
			case 'useMemo': {
				const fn = args[0];
				if (!t.isIdentifier(d.id) && !t.isObjectPattern(d.id) && !t.isArrayPattern(d.id)) break;
				if (!(t.isArrowFunctionExpression(fn) || t.isFunctionExpression(fn))) break;
				mark(d.id);
				const id = gen_pattern_safe(d.id);
				const ann = targs[0] ? `: ${gen_inline(targs[0])}` : t.isIdentifier(d.id) && d.id.typeAnnotation ? gen_inline(d.id.typeAnnotation).replace(/^:?\s*/, ': ') : '';
				if (t.isBlockStatement(fn.body)) {
					const simple = fn.body.body.length === 1 && t.isReturnStatement(fn.body.body[0]) && fn.body.body[0].argument ? fn.body.body[0].argument : null;
					if (simple) return `let ${id}${ann} = $derived(${gen_inline(unwrap(simple))});`;
					return `let ${id}${ann} = $derived.by(() => ${gen(fn.body)});`;
				}
				return `let ${id}${ann} = $derived(${gen_inline(unwrap(fn.body))});`;
			}
			case 'useCallback': {
				const fn = args[0];
				if (!t.isIdentifier(d.id) || !(t.isArrowFunctionExpression(fn) || t.isFunctionExpression(fn))) break;
				const block = t.isBlockStatement(fn.body) ? fn.body : t.blockStatement([t.returnStatement(unwrap(fn.body) as t.Expression)]);
				const decl = t.functionDeclaration(t.identifier(d.id.name), fn.params, block, !!fn.generator, !!fn.async);
				decl.returnType = fn.returnType ?? null;
				decl.typeParameters = fn.typeParameters ?? null;
				if (is_reactive_expr(fn)) reactive.add(d.id.name);
				return gen(decl);
			}
			case 'useContext': {
				if (!t.isIdentifier(d.id) && !t.isObjectPattern(d.id)) break;
				svelte_imports.add('getContext');
				const key = args[0] ? gen_inline(args[0]) : 'undefined';
				const known = t.isIdentifier(args[0]) ? fc.contexts.get(args[0].name) : undefined;
				const ty = targs[0] ?? known?.type ?? null;
				const call = `getContext${ty ? `<${gen_inline(ty)}>` : ''}(${key})`;
				const value = known?.def && !t.isIdentifier(known.def, { name: 'undefined' }) ? `${call} ?? ${gen_inline(known.def)}` : call;
				mark(d.id);
				if (!known) warnings.push(`useContext(${key}) → getContext(${key}): a parent must call setContext(${key}, …) (a React Provider in another file isn't converted)`);
				return `const ${gen_pattern_safe(d.id)} = ${value};`;
			}
			case 'useId':
				if (!t.isIdentifier(d.id)) break;
				return `const ${d.id.name} = $props.id();`;
			case 'useDeferredValue':
				if (!t.isIdentifier(d.id)) break;
				mark(d.id);
				warnings.push('useDeferredValue → $derived: Svelte has no deferred rendering; the value updates immediately');
				return `let ${d.id.name} = $derived(${args[0] ? gen_inline(args[0]) : 'undefined'});`;
			case 'useTransition': {
				if (!t.isArrayPattern(d.id)) break;
				const [a, b] = d.id.elements;
				warnings.push('useTransition: Svelte has no transitions of state; isPending is always false and the callback runs immediately');
				return [t.isIdentifier(a) ? `const ${a.name} = false;` : '', t.isIdentifier(b) ? `const ${b.name} = (fn: () => void) => fn();` : ''].filter(Boolean).join('\n');
			}
			case 'useSyncExternalStore': {
				if (!t.isIdentifier(d.id)) break;
				reactive.add(d.id.name);
				const [sub, snap] = args.map((x) => gen_inline(x));
				return `let ${d.id.name} = $state(${snap}());\n$effect(() => ${sub}(() => (${d.id.name} = ${snap}())));`;
			}
		}
		if (!KNOWN_HOOKS.has(h.name)) {
			warnings.push(`${h.name}() is a custom React hook and is left as is: port it to a function in a .svelte.ts module that uses runes and returns getters (pass reactive inputs as functions, e.g. ${h.name}(() => value))`);
		} else warnings.push(`${h.name} isn't converted`);
		mark(d.id);
		return `const ${gen(d)};`;
	}

	// 4. the template: the early-return chain, then the final return
	const jsx: JsxCtx = { warnings, snippets, optional, dom_refs, component_refs, ref_names: new Set([...refs.keys(), ...(props.ref_local ? [props.ref_local] : [])]), provides: [], styled: fc.styled, props_id: props.props_id };
	for (const s of local_snippets) optional.delete(s.name);
	branches.push({ test: null, body: final });
	const template = blocks(branches, jsx, '').replace(/\n{3,}/g, '\n\n');
	const snippet_markup = local_snippets.map((s) => snippet_block(s.name, s.params, s.body, jsx, ''));

	// 5. Providers → setContext, after the values they read are declared
	for (const p of jsx.provides) {
		svelte_imports.add('setContext');
		const v = unwrap(p.value);
		// { dark, toggle } → getters, so consumers reading theme.dark stay reactive
		if (t.isObjectExpression(v) && v.properties.every((x) => (t.isObjectProperty(x) && !x.computed && t.isIdentifier(x.key)) || t.isObjectMethod(x))) {
			const parts = v.properties.map((x) => {
				if (t.isObjectMethod(x)) return gen_inline(x);
				const prop = x as t.ObjectProperty;
				const key = (prop.key as t.Identifier).name;
				const val = prop.value as t.Expression;
				return is_reactive_expr(val) && !t.isArrowFunctionExpression(val) && !t.isFunctionExpression(val) ? `get ${key}() {\n\t\treturn ${gen_inline(val)};\n\t}` : `${key}: ${gen_inline(val)}`;
			});
			script.push(`setContext(${p.key}, {\n\t${parts.join(',\n\t')}\n});`);
			continue;
		}
		script.push(`setContext(${p.key}, ${gen_inline(p.value)});`);
		if (is_reactive_expr(p.value)) warnings.push(`<${p.key}.Provider value={${gen_inline(p.value)}}> → setContext: the value is read once; to keep consumers reactive, pass a $state object (or an object with getters) and mutate it`);
	}
	if (/\bonMount\(/.test(script.join('\n'))) svelte_imports.add('onMount');
	if (/\buntrack\(/.test(script.join('\n'))) svelte_imports.add('untrack');

	const generics = c.fn.typeParameters && t.isTSTypeParameterDeclaration(c.fn.typeParameters) ? c.fn.typeParameters.params.map((p) => gen_inline(p)).join(', ') : null;
	return { name: c.name, script: [analysis.build(), ...script].filter(Boolean), snippets: snippet_markup, template, svelte_imports, generics, warnings };
}

function gen_pattern_safe(p: t.Node): string {
	return gen_inline(p);
}

/** useEffect / useLayoutEffect as a statement → $effect or onMount. */
function effect_hook(h: { name: string; call: t.CallExpression }, state_names: Set<string>, imports: Set<string>, warnings: string[]): string[] {
	const [fn, deps] = h.call.arguments;
	if (h.name === 'useEffect' || h.name === 'useLayoutEffect' || h.name === 'useInsertionEffect') {
		if (!(t.isArrowFunctionExpression(fn) || t.isFunctionExpression(fn))) {
			warnings.push(`${h.name} with a non-inline callback isn't converted`);
			return [`${gen(h.call)};`];
		}
		const body = t.isBlockStatement(fn.body) ? gen(fn.body) : gen_inline(fn.body);
		if (fn.async) warnings.push(`async ${h.name} callback: its cleanup (if any) is lost; start the async work inside a sync callback`);
		if (deps && t.isArrayExpression(deps) && deps.elements.length === 0) {
			imports.add('onMount');
			return [`onMount(() => ${body});`];
		}
		if (deps && t.isArrayExpression(deps)) {
			// The effect writes state it also reads: Svelte would re-run it on its own
			// write. Track exactly the deps, untrack the body.
			const w = render_writes(fn.body);
			const r = sync_reads(fn.body);
			const loops = [...w].filter((n) => state_names.has(n) && r.has(n));
			if (loops.length) {
				imports.add('untrack');
				const dep_lines = deps.elements.filter((x): x is t.Expression => !!x && t.isExpression(x)).map((x) => `${gen_inline(x)};`);
				return [`$effect(() => {\n${indent([...dep_lines, `return untrack(() => ${body});`].join('\n'))}\n});`];
			}
		}
		return [`$effect(() => ${body});`];
	}
	if (h.name === 'useImperativeHandle') {
		warnings.push('useImperativeHandle isn\'t converted: export functions from the component (`export function focus() {…}`) and bind:this to it');
		return [];
	}
	if (h.name === 'useDebugValue') return [];
	if (!KNOWN_HOOKS.has(h.name)) warnings.push(`${h.name}() is a custom React hook and is left as is: port it to a function in a .svelte.ts module that uses runes`);
	return [`${gen(h.call)};`];
}

/** `prev => expr` applied to `state`: inline the param for an expression body, else call it. */
export function updater(fn: t.ArrowFunctionExpression | t.FunctionExpression, state: string): t.Expression {
	const param = fn.params[0];
	if (t.isIdentifier(param) && !t.isBlockStatement(fn.body)) return substitute(t.cloneNode(unwrap(fn.body), true) as t.Expression, param.name, state);
	if (!param) return t.isBlockStatement(fn.body) ? t.callExpression(t.parenthesizedExpression(fn), []) : (unwrap(fn.body) as t.Expression);
	return t.callExpression(t.parenthesizedExpression(fn), [t.identifier(state)]);
}

/** Replace free `from` identifiers with `to`, respecting inner shadowing. */
function substitute(expr: t.Expression, from: string, to: string): t.Expression {
	const file = t.file(t.program([t.expressionStatement(expr)]));
	traverse(file, {
		Identifier(p) {
			if (p.node.name !== from || !p.isReferencedIdentifier()) return;
			if (p.scope.hasBinding(from)) return; // shadowed inside the expression
			p.node.name = to;
		}
	});
	return (file.program.body[0] as t.ExpressionStatement).expression;
}

// --- module level ----------------------------------------------------------------

interface ModuleDecl {
	names: string[];
	code: string;
	exported: boolean;
	type_only: boolean;
}

function module_level(ast: t.File, d: Discovery, fc: FileCtx, components: Set<t.Statement>, warnings: string[]): { decls: ModuleDecl[]; imports: t.ImportDeclaration[]; styles: string[] } {
	const decls: ModuleDecl[] = [];
	const imports: t.ImportDeclaration[] = [];
	const styles: string[] = [];
	const component_names = new Set(d.components.map((c) => c.name));
	const css_libs = new Map<string, string>(); // local → source
	for (const stmt of ast.program.body) {
		if (t.isImportDeclaration(stmt)) {
			const src = stmt.source.value;
			if (REACT_SOURCES(src)) continue;
			if (CSS_IN_JS.has(src)) for (const s of stmt.specifiers) css_libs.set(s.local.name, src);
			if (/\.module\.(css|s[ac]ss|less)$/.test(src)) warnings.push(`CSS module ${src}: Svelte scopes a component's <style> itself; move those rules into <style> and use plain class names`);
			imports.push(stmt);
		}
	}
	for (const stmt of ast.program.body) {
		if (t.isImportDeclaration(stmt) || components.has(stmt) || d.dropped.has(stmt)) continue;
		if (t.isExportDefaultDeclaration(stmt)) continue; // a Svelte component is the default export
		const decl = t.isExportNamedDeclaration(stmt) ? stmt.declaration : stmt;
		const exported = t.isExportNamedDeclaration(stmt);
		if (t.isExportNamedDeclaration(stmt) && !stmt.declaration) {
			const specs = stmt.specifiers.filter((specifier) => {
				if (!t.isExportSpecifier(specifier)) return true;
				const local = t.isIdentifier(specifier.local) ? specifier.local.name : specifier.local.value;
				return !component_names.has(local);
			});
			if (specs.length) {
				const copy = t.cloneNode(stmt, true);
				copy.specifiers = specs;
				decls.push({ names: [], code: gen(copy), exported: true, type_only: false });
			}
			continue;
		}
		if (t.isVariableDeclaration(decl)) {
			const kept: t.VariableDeclarator[] = [];
			for (const v of decl.declarations) {
				if (t.isClassExpression(v.init) && v.init.superClass && /Component$/.test(gen_inline(v.init.superClass))) continue;
				if (!t.isIdentifier(v.id) || !v.init) {
					kept.push(v);
					continue;
				}
				const init = unwrap(v.init);
				// createContext(default) → a key (Symbol.for, so every file that declares it agrees);
				// the default moves to getContext(…) ?? default
				if (t.isCallExpression(init) && callee_name(init.callee) === 'createContext') {
					fc.contexts.set(v.id.name, { def: (init.arguments[0] as t.Expression) ?? null, type: type_args(init)[0] ?? null });
					decls.push({ names: [v.id.name], code: `${exported ? 'export ' : ''}const ${v.id.name} = Symbol.for('${v.id.name}');`, exported, type_only: false });
					continue;
				}
				// styled.div`…` / styled('div')`…` without interpolations → a tag + scoped class
				if (t.isTaggedTemplateExpression(init)) {
					const tag = styled_tag(init.tag, css_libs);
					if (tag !== null) {
						if (tag && init.quasi.expressions.length === 0) {
							const cls = v.id.name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
							fc.styled.set(v.id.name, { tag, cls });
							styles.push(`.${cls} {\n${indent(dedent(init.quasi.quasis[0].value.cooked ?? init.quasi.quasis[0].value.raw))}\n}`);
							continue;
						}
						warnings.push(`CSS-in-JS: ${v.id.name} = ${gen_inline(init.tag)}\`…\`${init.quasi.expressions.length ? ' interpolates props' : ' wraps a component'}; move its rules into <style> (dynamic values as CSS variables via style:--name={value})`);
					} else if (t.isIdentifier(init.tag) && css_libs.has(init.tag.name)) {
						warnings.push(`CSS-in-JS: ${init.tag.name}\`…\` (${css_libs.get(init.tag.name)}) isn't converted; move those rules into <style>`);
					}
				}
				kept.push(v);
			}
			if (!kept.length) continue;
			const copy = t.variableDeclaration(decl.kind, kept);
			const names = kept.flatMap((v) => Object.keys(t.getBindingIdentifiers(v.id)));
			decls.push({ names, code: gen(exported ? t.exportNamedDeclaration(copy) : copy), exported, type_only: false });
			continue;
		}
		if (t.isFunctionDeclaration(decl) && decl.id && /^use[A-Z]/.test(decl.id.name) && has_hooks(decl)) {
			warnings.push(`${decl.id.name}() is a custom hook defined in this file; it still calls React hooks: rewrite it to a function in a .svelte.ts module using runes`);
		}
		if (t.isFunctionDeclaration(decl) && decl.id && fc.jsx_helpers.some((helper) => helper.id?.name === decl.id?.name)) continue;
		if (t.isClassDeclaration(decl) && decl.superClass && /Component$/.test(gen_inline(decl.superClass))) continue;
		const names = decl && 'id' in decl && decl.id && t.isIdentifier(decl.id) ? [decl.id.name] : [];

		const type_only = t.isTSInterfaceDeclaration(decl) || t.isTSTypeAliasDeclaration(decl);
		decls.push({ names, code: gen(stmt), exported, type_only });
	}
	return { decls, imports, styles };
}

function has_hooks(fn: t.Node): boolean {
	let found = false;
	t.traverseFast(fn, (n) => {
		if (t.isCallExpression(n) && KNOWN_HOOKS.has(callee_name(n.callee) ?? '')) found = true;
	});
	return found;
}

/** styled.div → 'div', styled('div') → 'div', styled(Comp) → '' (a wrapped component), else null. */
function styled_tag(tag: t.Node, libs: Map<string, string>): string | null {
	const is_styled = (n: t.Node) => t.isIdentifier(n) && libs.has(n.name) && ['styled', 'default'].includes(n.name) || (t.isIdentifier(n) && n.name === 'styled' && libs.has('styled'));
	if (t.isMemberExpression(tag) && is_styled(tag.object) && t.isIdentifier(tag.property) && !tag.computed) return tag.property.name;
	if (t.isCallExpression(tag) && is_styled(tag.callee)) {
		const a = tag.arguments[0];
		return t.isStringLiteral(a) ? a.value : '';
	}
	if (t.isIdentifier(tag) && ['createGlobalStyle', 'keyframes', 'css'].includes(tag.name) && libs.has(tag.name)) return null;
	return null;
}

function dedent(css: string): string {
	const lines = css.replace(/^\n+|\s+$/g, '').split('\n');
	const pad = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)![0].length));
	return lines.map((l) => l.slice(Number.isFinite(pad) ? pad : 0).replace(/^ {2}/g, '\t')).join('\n').trim();
}

// --- assembly ----------------------------------------------------------------------

const word = (name: string) => new RegExp(`(^|[^\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`);

function assemble(conv: Converted, all: Converted[], mod: ReturnType<typeof module_level>, fc: FileCtx, is_main: boolean, jsx_tags: Set<string>): string {
	const body = conv.script.join('\n\n');
	const markup = [...conv.snippets, conv.template].filter(Boolean).join('\n\n');
	let text = `${body}\n${markup}`;

	// module declarations this file uses (transitively); the main file keeps every export
	const used: ModuleDecl[] = [];
	let changed = true;
	while (changed) {
		changed = false;
		for (const d of mod.decls) {
			if (used.includes(d)) continue;
			if ((is_main && d.exported) || d.names.some((n) => word(n).test(text))) {
				used.push(d);
				text += '\n' + d.code;
				changed = true;
			}
		}
	}
	const module_code = mod.decls.filter((d) => used.includes(d)).map((d) => d.code);

	// imports: only the specifiers this file uses; sibling components → their .svelte file
	const import_lines: string[] = [];
	const svelte_types = [...fc.types.svelte].filter((n) => word(n).test(text));
	const svelte_values = [...conv.svelte_imports].sort();
	if (svelte_values.length) import_lines.push(`import { ${svelte_values.join(', ')} } from 'svelte';`);
	if (svelte_types.length) import_lines.push(`import type { ${svelte_types.sort().join(', ')} } from 'svelte';`);
	const element_types = [...fc.types.elements].filter((n) => word(n).test(text));
	if (element_types.length) import_lines.push(`import type { ${element_types.sort().join(', ')} } from 'svelte/elements';`);
	for (const imp of mod.imports) {
		const specs = imp.specifiers.filter((s) => word(s.local.name).test(text));
		if (!specs.length) {
			if (!imp.specifiers.length) import_lines.push(gen(imp)); // side-effect import
			continue;
		}
		const src = imp.source.value;
		const comp_specs = specs.filter((s) => t.isImportSpecifier(s) && jsx_tags.has(s.local.name) && is_component_name(s.local.name) && /^\.\.?\//.test(src));
		const non_comp_specs = specs.filter((s) => !comp_specs.includes(s));

		for (const cs of comp_specs) {
			const svelte_src = src.replace(/\.(jsx|tsx|js|ts)$/, '') + (src.endsWith('.svelte') ? '' : '.svelte');
			import_lines.push(`import ${cs.local.name} from '${svelte_src}';`);
		}

		if (non_comp_specs.length) {
			const copy = t.cloneNode(imp, true);
			copy.specifiers = non_comp_specs.map((s) => t.cloneNode(s, true));
			const def = non_comp_specs.find((s) => t.isImportDefaultSpecifier(s));
			if (def && jsx_tags.has(def.local.name) && /^\.\.?\//.test(src) && !/\.(svelte|css|json|svg|png)$/.test(src)) copy.source = t.stringLiteral(src.replace(/\.(jsx|tsx|js|ts)$/, '') + '.svelte');
			import_lines.push(gen(copy));
		}
	}
	for (const other of all) if (other !== conv && word(other.name).test(`${body}\n${markup}`)) import_lines.push(`import ${other.name} from './${other.name}.svelte';`);

	const out: string[] = [];
	// module-level types may name imported types, and the instance script sees the module script's imports
	if (module_code.length) out.push(`<script module lang="ts">\n${indent([...import_lines, ...(import_lines.length ? [''] : []), module_code.join('\n\n')].join('\n'))}\n</script>`);
	const generics = conv.generics ? ` generics="${conv.generics.replace(/"/g, "'")}"` : '';
	const script = [...(module_code.length ? [] : import_lines), ...(import_lines.length && !module_code.length ? [''] : []), body].join('\n').trim();
	if (script) out.push(`<script lang="ts"${generics}>\n${indent(script)}\n</script>`);
	if (markup.trim()) out.push(markup);
	const styles = mod.styles.filter((s) => {
		const cls = s.slice(1, s.indexOf(' '));
		return word(cls).test(markup) || markup.includes(`"${cls}`) || markup.includes(`'${cls}'`);
	});
	if (styles.length) out.push(`<style>\n${indent(styles.join('\n\n'))}\n</style>`);
	return out.join('\n\n') + '\n';
}

// --- entry ---------------------------------------------------------------------------

export function react_to_svelte(code: string): ConversionResult {
	let ast: t.File;
	try {
		ast = parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'], errorRecovery: false });
	} catch (err) {
		const e = err as { message?: string; loc?: { line: number } };
		throw new ReactConvertError(String(e.message ?? err).replace(/\s*\(\d+:\d+\)$/, ''), e.loc?.line ?? null);
	}
	const normalized = normalize_class_components(ast);
	const d = discover(ast);
	d.warnings.unshift(...normalized.warnings);
	if (!d.components.length) {
		const contains_jsx = has_jsx(ast);
		throw new ReactConvertError(
			d.warnings[0] ??
				(contains_jsx
					? 'No supported React component found: expected a function, class, memo, or forwardRef that returns JSX'
					: 'This file contains no JSX component; keep it as TypeScript rather than converting it to .svelte')
		);
	}

	const react = new Set<string>();
	for (const stmt of ast.program.body) if (t.isImportDeclaration(stmt) && REACT_SOURCES(stmt.source.value)) for (const s of stmt.specifiers) react.add(s.local.name);

	const paths = new Map<t.Node, NodePath<t.Function>>();
	traverse(ast, {
		Function(p) {
			paths.set(p.node, p);
		}
	});
	const component_names = new Set(d.components.map((component) => component.name));
	const jsx_helpers: t.FunctionDeclaration[] = [];
	for (const stmt of ast.program.body) {
		const decl = t.isExportNamedDeclaration(stmt) ? stmt.declaration : stmt;
		if (t.isFunctionDeclaration(decl) && decl.id && !component_names.has(decl.id.name) && fn_returns_jsx(decl)) jsx_helpers.push(decl);
	}
	const fc: FileCtx = { ast, react, paths, jsx_helpers, contexts: new Map(), styled: new Map(), types: new_type_use() };
	const single = d.components.length === 1;
	// props are read before React types are rewritten (ReactNode marks a snippet prop)
	const analyses = d.components.map((c) => analyze_props(c, ast, react, d.default_props.get(c.name), single));
	const file_warnings: string[] = [...d.warnings];
	const unmapped = map_react_types(ast, react, fc.types);
	if (unmapped.length) file_warnings.push(`React types left as is (no Svelte equivalent): ${unmapped.map((n) => `React.${n}`).join(', ')}`);

	const comp_stmts = new Set(d.components.map((c) => c.top));
	const mod = module_level(ast, d, fc, comp_stmts, file_warnings);
	const converted = d.components.map((c, i) => convert_component(c, fc, analyses[i]));
	const jsx_tags = new Set<string>();
	traverse(ast, {
		JSXOpeningElement(p) {
			const n = p.node.name;
			if (t.isJSXIdentifier(n)) jsx_tags.add(n.name);
			if (t.isJSXMemberExpression(n) && t.isJSXIdentifier(n.object)) jsx_tags.add(n.object.name);
		}
	});
	// named imports used as components: Svelte components are default exports
	for (const stmt of ast.program.body)
		if (t.isImportDeclaration(stmt) && /^\.\.?\//.test(stmt.source.value))
			for (const s of stmt.specifiers) if (t.isImportSpecifier(s) && jsx_tags.has(s.local.name) && is_component_name(s.local.name)) file_warnings.push(`<${s.local.name}> is a named import from ${stmt.source.value}; a .svelte component is that file's default export`);

	const main_index = Math.max(0, d.components.findIndex((c) => c.is_default));
	const order = [main_index, ...converted.map((_, i) => i).filter((i) => i !== main_index)];
	const files: ConvertedFile[] = order.map((i, k) => {
		const warn = [...new Set([...(k === 0 ? file_warnings : []), ...converted[i].warnings])];
		const code = assemble(converted[i], converted, mod, fc, k === 0, jsx_tags);
		// The UI lists warnings under the panes; they also ride in the file itself as
		// HTML comments, so a copied file still says what was left unconverted.
		// (`--` would close the comment early, so it becomes an em dash.)
		const notes = warn.map((w) => `<!-- ⚠ ${w.replace(/--/g, '—')} -->`).join('\n');
		return { name: `${converted[i].name}.svelte`, code: warn.length ? `${notes}\n${code}` : code, warnings: warn };
	});
	const warnings = files.length === 1 ? files[0].warnings : files.flatMap((f) => f.warnings.map((w) => `${f.name}: ${w}`));
	return { svelte: files[0].code, files, warnings };
}

/** The original name, kept for callers of the fractaldesk version. */
export const convertReactToSvelte = react_to_svelte;

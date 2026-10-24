/**
 * React TypeScript modules with no components → Svelte 5 TypeScript modules.
 *
 * A file of constants, types, helpers and custom hooks (`useX`) becomes a `.ts` file, or a
 * `.svelte.ts` file once a hook uses runes:
 *
 * - React imports are dropped. React types map to Svelte types, as in components.
 * - Inside a hook:
 *   - `useState` becomes `$state` and setter calls become assignments.
 *   - `useMemo` and render-time values that read state become `$derived`.
 *   - `useEffect` becomes `$effect`, or `onMount` when its deps are `[]`.
 *   - `useCallback` becomes the plain function.
 *   - `useRef` becomes a plain `{ current }` box.
 *   - `useContext` becomes `getContext`.
 * - What a hook returns stays reactive. A state value comes back as
 *   `{ get current() { … } }`. An object or tuple comes back as an object with getters,
 *   so callers read properties instead of destructuring.
 * - Hooks in the same file that call each other read `.current` on the returned value.
 *
 * Every rewrite that changes how callers use a hook comes with a warning that names it.
 * `react_any_to_svelte` picks this or the component converter by whether the file has JSX.
 */

import { parse } from '@babel/parser';
import _traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { gen, gen_inline } from './gen.ts';
import { unwrap } from './jsx.ts';
import { map_react_types, new_type_use } from './types.ts';
import {
	callee_name,
	has_jsx,
	hook_call,
	indent,
	KNOWN_HOOKS,
	react_to_svelte,
	REACT_SOURCES,
	ReactConvertError,
	reads,
	render_writes,
	sync_reads,
	type_args,
	updater,
	type ConversionResult
} from './convert.ts';

const traverse = ((_traverse as unknown as { default?: typeof _traverse }).default ?? _traverse) as typeof _traverse;

type FnNode = t.FunctionDeclaration | t.ArrowFunctionExpression | t.FunctionExpression;
const is_fn = (n: t.Node | null | undefined): n is t.ArrowFunctionExpression | t.FunctionExpression => !!n && (t.isArrowFunctionExpression(n) || t.isFunctionExpression(n));
const is_hook_name = (s: string) => /^use[A-Z0-9]/.test(s);

const parse_stmts = (src: string): t.Statement[] => parse(src, { sourceType: 'module', plugins: ['typescript'] }).program.body;
const parse_expr = (src: string): t.Expression => (parse_stmts(`(${src});`)[0] as t.ExpressionStatement).expression;

/** Picks the converter: files with JSX are components, files without are modules. */
export function react_any_to_svelte(code: string, filename?: string): ConversionResult {
	let ast: t.File;
	try {
		ast = parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
	} catch {
		return react_to_svelte(code); // reports the parse error the usual way
	}
	return has_jsx(ast) ? react_to_svelte(code) : react_module_to_svelte(code, filename);
}

interface Hook {
	name: string;
	fn: FnNode;
}

export function react_module_to_svelte(code: string, filename = 'module.ts'): ConversionResult {
	let ast: t.File;
	try {
		ast = parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'], errorRecovery: false });
	} catch (err) {
		const e = err as { message?: string; loc?: { line: number } };
		throw new ReactConvertError(String(e.message ?? err).replace(/\s*\(\d+:\d+\)$/, ''), e.loc?.line ?? null);
	}

	const warnings: string[] = [];
	const svelte_values = new Set<string>();
	const react = new Set<string>();
	for (const stmt of ast.program.body) if (t.isImportDeclaration(stmt) && REACT_SOURCES(stmt.source.value)) for (const s of stmt.specifiers) react.add(s.local.name);

	// hooks: top-level `function useX` / `const useX = () => …` (exported or not) that call hooks
	const hooks: Hook[] = [];
	for (const stmt of ast.program.body) {
		const decl = t.isExportNamedDeclaration(stmt) || t.isExportDefaultDeclaration(stmt) ? stmt.declaration : stmt;
		if (t.isFunctionDeclaration(decl) && decl.id && is_hook_name(decl.id.name) && calls_hooks(decl)) hooks.push({ name: decl.id.name, fn: decl });
		if (t.isVariableDeclaration(decl))
			for (const d of decl.declarations) {
				const init = d.init ? unwrap(d.init) : null;
				if (t.isIdentifier(d.id) && is_hook_name(d.id.name) && is_fn(init) && calls_hooks(init)) hooks.push({ name: d.id.name, fn: init });
			}
	}
	// expression bodies → blocks, so every hook has statements to rewrite
	for (const h of hooks) if (!t.isBlockStatement(h.fn.body)) h.fn.body = t.blockStatement([t.returnStatement(h.fn.body as t.Expression)]);

	// which local hooks will return `{ current }` (to a fixpoint: hooks can wrap each other)
	const current_hooks = new Set<string>();
	for (let changed = true; changed; ) {
		changed = false;
		for (const h of hooks) {
			if (current_hooks.has(h.name)) continue;
			const body = (h.fn.body as t.BlockStatement).body;
			const reactive = reactive_names(body, current_hooks);
			const ret = body.find((s): s is t.ReturnStatement => t.isReturnStatement(s));
			if (ret?.argument && t.isIdentifier(unwrap(ret.argument)) && reactive.has((unwrap(ret.argument) as t.Identifier).name)) {
				current_hooks.add(h.name);
				changed = true;
			}
		}
	}

	const paths = new Map<t.Node, NodePath<t.Function>>();
	traverse(ast, {
		Function(p) {
			paths.set(p.node, p);
		}
	});
	for (const h of hooks) convert_hook(h, paths.get(h.fn)!, current_hooks, svelte_values, warnings);

	// calls to converted local hooks outside other hooks (module scope) also return { current }
	const unmapped = map_react_types(ast, react, (types_used = new_type_use()));
	if (unmapped.length) warnings.push(`React types left as is (no Svelte equivalent): ${unmapped.map((n) => `React.${n}`).join(', ')}`);

	// leftover React hooks anywhere (outside converted hooks, or ones we don't map)
	const leftovers = new Set<string>();
	traverse(ast, {
		CallExpression(p) {
			const n = callee_name(p.node.callee);
			if (n && KNOWN_HOOKS.has(n) && (react.has(n) || t.isMemberExpression(p.node.callee))) leftovers.add(n);
		}
	});
	if (leftovers.size) warnings.push(`React hooks still called outside a converted hook: ${[...leftovers].join(', ')}; port them by hand`);

	// --- print -----------------------------------------------------------------------------
	const blocks: { code: string; is_import: boolean }[] = [];
	let carry: t.Comment[] = [];
	for (const stmt of ast.program.body) {
		if (t.isImportDeclaration(stmt) && REACT_SOURCES(stmt.source.value)) {
			carry = [...carry, ...(stmt.leadingComments ?? [])]; // keep a file header comment
			continue;
		}
		if (carry.length) {
			stmt.leadingComments = [...carry, ...(stmt.leadingComments ?? [])];
			carry = [];
		}
		blocks.push({ code: gen(stmt), is_import: t.isImportDeclaration(stmt) });
	}
	let body = blocks.map((b, i) => (i === 0 ? '' : b.is_import && blocks[i - 1].is_import ? '\n' : '\n\n') + b.code).join('');

	const import_lines: string[] = [];
	const word = (n: string) => new RegExp(`(^|[^\\w$.])${n}(?![\\w$])`).test(body);
	const values = [...svelte_values].filter(word).sort();
	if (values.length) import_lines.push(`import { ${values.join(', ')} } from 'svelte';`);
	const types = [...types_used.svelte].filter(word).sort();
	if (types.length) import_lines.push(`import type { ${types.join(', ')} } from 'svelte';`);
	const elements = [...types_used.elements].filter(word).sort();
	if (elements.length) import_lines.push(`import type { ${elements.join(', ')} } from 'svelte/elements';`);
	if (import_lines.length) body = import_lines.join('\n') + (blocks[0]?.is_import ? '\n' : '\n\n') + body;

	const runes = /\$(state|derived|effect)\b/.test(body);
	const base = filename.replace(/^.*[\\/]/, '').replace(/(\.svelte)?\.(tsx|ts|jsx|js|mts)$/, '') || 'module';
	const name = `${base}${runes ? '.svelte.ts' : '.ts'}`;
	if (!hooks.length && !react.size) warnings.push('no React imports or hooks found; the file is unchanged');
	const out = body.trimEnd() + '\n';
	const file = { name, code: out, warnings: [...new Set(warnings)] };
	return { svelte: out, files: [file], warnings: file.warnings };
}

let types_used = new_type_use();

function calls_hooks(fn: t.Node): boolean {
	let found = false;
	t.traverseFast(fn, (n) => {
		if (t.isCallExpression(n)) {
			const c = callee_name(n.callee);
			if (c && is_hook_name(c)) found = true;
		}
	});
	return found;
}

/** Names that are reactive after conversion, in statement order: state, derived values, local `{ current }` hooks. */
function reactive_names(body: t.Statement[], current_hooks: Set<string>): Set<string> {
	const reactive = new Set<string>();
	for (const stmt of body) {
		if (!t.isVariableDeclaration(stmt)) continue;
		for (const d of stmt.declarations) {
			const h = hook_call(d.init);
			if (h) {
				if ((h.name === 'useState' || h.name === 'useReducer') && t.isArrayPattern(d.id) && t.isIdentifier(d.id.elements[0])) reactive.add(d.id.elements[0].name);
				else if ((h.name === 'useMemo' || h.name === 'useSyncExternalStore' || h.name === 'useContext' || h.name === 'useDeferredValue' || current_hooks.has(h.name)) && t.isIdentifier(d.id)) reactive.add(d.id.name);
				continue;
			}
			if (d.init && !is_fn(unwrap(d.init)) && t.isIdentifier(d.id) && [...reads(d.init)].some((n) => reactive.has(n))) reactive.add(d.id.name);
		}
	}
	return reactive;
}

function param_names(fn: FnNode): string[] {
	return fn.params.flatMap((p) => Object.keys(t.getBindingIdentifiers(p)));
}

function convert_hook(hook: Hook, path: NodePath<t.Function>, current_hooks: Set<string>, svelte_values: Set<string>, warnings: string[]) {
	const { name, fn } = hook;
	const block = fn.body as t.BlockStatement;

	// 1. setters → assignments (scope-aware: a shadowing name is left alone)
	const states = new Map<string, { name: string; type: t.TSType | null }>();
	for (const stmt of block.body) {
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
			const rhs = is_fn(arg) ? updater(arg, state) : ((arg as t.Expression) ?? t.identifier('undefined'));
			p.replaceWith(t.assignmentExpression('=', t.identifier(state), rhs));
		},
		Identifier(p) {
			if (!states.has(p.node.name) || !p.isReferencedIdentifier()) return;
			if (p.scope.getBinding(p.node.name) !== binding_of.get(p.node.name)) return;
			if (t.isCallExpression(p.parent) && p.parent.callee === p.node) return;
			setter_values.add(p.node.name);
		}
	});

	// 2. values from local `{ current }` hooks: x → x.current
	const boxed = new Set<string>();
	for (const stmt of block.body)
		if (t.isVariableDeclaration(stmt))
			for (const d of stmt.declarations) {
				const h = hook_call(d.init);
				if (h && current_hooks.has(h.name) && t.isIdentifier(d.id)) boxed.add(d.id.name);
			}
	if (boxed.size) {
		const box_binding = new Map([...boxed].map((b) => [b, path.scope.getBinding(b)]));
		path.traverse({
			Identifier(p) {
				if (!boxed.has(p.node.name) || !p.isReferencedIdentifier()) return;
				if (p.scope.getBinding(p.node.name) !== box_binding.get(p.node.name)) return;
				if (t.isMemberExpression(p.parent) && p.parent.object === p.node && t.isIdentifier(p.parent.property, { name: 'current' })) return;
				p.replaceWith(t.memberExpression(t.identifier(p.node.name), t.identifier('current')));
				p.skip();
			}
		});
	}

	// 3. statements in order
	const reactive = new Set<string>(boxed);
	const params = new Set(param_names(fn));
	const params_read = new Set<string>(); // params a reactive computation depends on
	const note_params = (n: t.Node) => {
		for (const r of reads(n)) if (params.has(r)) params_read.add(r);
	};
	const out: t.Statement[] = [];
	const push = (src: string) => out.push(...parse_stmts(src));
	const is_reactive = (n: t.Node) => [...reads(n)].some((r) => reactive.has(r));

	for (const stmt of block.body) {
		if (t.isExpressionStatement(stmt)) {
			const h = hook_call(stmt.expression);
			if (h && ['useEffect', 'useLayoutEffect', 'useInsertionEffect'].includes(h.name)) {
				const [cb, deps] = h.call.arguments;
				if (deps && t.isArrayExpression(deps)) note_params(deps);
				if (!is_fn(cb)) {
					warnings.push(`${name}(): ${h.name} with a non-inline callback isn't converted`);
					out.push(stmt);
					continue;
				}
				const body_src = t.isBlockStatement(cb.body) ? gen(cb.body) : gen_inline(cb.body);
				if (cb.async) warnings.push(`${name}(): async ${h.name} callback: its cleanup (if any) is lost; start the async work inside a sync callback`);
				if (deps && t.isArrayExpression(deps) && deps.elements.length === 0) {
					svelte_values.add('onMount');
					push(`onMount(() => ${body_src});`);
					continue;
				}
				if (deps && t.isArrayExpression(deps)) {
					const w = render_writes(cb.body);
					const r = sync_reads(cb.body);
					if ([...w].some((n) => reactive.has(n) && r.has(n))) {
						svelte_values.add('untrack');
						const dep_lines = deps.elements.filter((x): x is t.Expression => !!x && t.isExpression(x)).map((x) => `${gen_inline(x)};`);
						push(`$effect(() => {\n${indent([...dep_lines, `return untrack(() => ${body_src});`].join('\n'))}\n});`);
						continue;
					}
				}
				push(`$effect(() => ${body_src});`);
				continue;
			}
			if (h?.name === 'useDebugValue') continue;
			if (h) warnings.push(`${name}(): ${h.name}() isn't converted`);
			out.push(stmt);
			continue;
		}

		if (t.isVariableDeclaration(stmt)) {
			for (const d of stmt.declarations) {
				const src = declarator(d, stmt.kind);
				if (src === null) out.push(t.variableDeclaration(stmt.kind, [d]));
				else push(src);
			}
			continue;
		}
		out.push(stmt);
	}

	function declarator(d: t.VariableDeclarator, kind: string): string | null {
		const h = hook_call(d.init);
		if (!h) {
			if (d.init && t.isIdentifier(d.id) && !is_fn(unwrap(d.init)) && is_reactive(d.init)) {
				reactive.add(d.id.name);
				note_params(d.init);
				const ann = d.id.typeAnnotation ? gen_inline(d.id.typeAnnotation).replace(/^:?\s*/, ': ') : '';
				return `const ${d.id.name}${ann} = $derived(${gen_inline(d.init)});`;
			}
			return null;
		}
		const args = h.call.arguments;
		const targs = type_args(h.call);
		const targ = targs[0] ? `<${gen_inline(targs[0])}>` : '';
		switch (h.name) {
			case 'useState': {
				if (!t.isArrayPattern(d.id)) break;
				const [a, b] = d.id.elements;
				const state = t.isIdentifier(a) ? a.name : 'value';
				reactive.add(state);
				let init = args[0] ? gen_inline(args[0]) : '';
				const arg0 = args[0];
				if (is_fn(arg0) && arg0.params.length === 0) init = t.isBlockStatement(arg0.body) ? `(${gen(arg0)})()` : gen_inline(unwrap(arg0.body));
				const lines = [`let ${state} = $state${targ}(${init});`];
				const setter = t.isIdentifier(b) ? b.name : null;
				if (setter && setter_values.has(setter)) {
					const ty = targs[0] ? gen_inline(targs[0]) : null;
					const param = ty ? `value: ${ty} | ((prev: ${ty}) => ${ty})` : 'value: any';
					lines.push(`function ${setter}(${param}) {\n\t${state} = typeof value === 'function' ? (value as (prev: ${ty ?? 'any'}) => ${ty ?? 'any'})(${state}) : value;\n}`);
				}
				return lines.join('\n');
			}
			case 'useReducer': {
				if (!t.isArrayPattern(d.id)) break;
				const [a, b] = d.id.elements;
				const state = t.isIdentifier(a) ? a.name : 'state';
				const dispatch = t.isIdentifier(b) ? b.name : 'dispatch';
				reactive.add(state);
				const reducer = args[0] ? gen_inline(args[0]) : 'reducer';
				const init = args[2] ? `${gen_inline(args[2])}(${args[1] ? gen_inline(args[1]) : ''})` : args[1] ? gen_inline(args[1]) : 'undefined';
				const action = t.isIdentifier(args[0]) ? `: Parameters<typeof ${reducer}>[1]` : '';
				const state_type = targ || (t.isIdentifier(args[0]) && !args[2] ? `<Parameters<typeof ${reducer}>[0]>` : '');
				return `let ${state} = $state${state_type}(${init});\nfunction ${dispatch}(action${action}) {\n\t${state} = ${reducer}(${state}, action);\n}`;
			}
			case 'useRef': {
				if (!t.isIdentifier(d.id)) break;
				const init = args[0] ? gen_inline(args[0]) : 'undefined';
				const ty = targs[0] ? gen_inline(targs[0]) : null;
				const nullable = ty && args[0] && t.isNullLiteral(args[0]) && !/\bnull\b/.test(ty) ? `${ty} | null` : ty;
				// a plain mutable box: same semantics as a ref (not reactive), callers keep `.current`
				return `const ${d.id.name}${nullable ? `: { current: ${nullable} }` : ''} = { current: ${init} };`;
			}
			case 'useMemo': {
				const cb = args[0];
				if (!is_fn(cb) || !(t.isIdentifier(d.id) || t.isObjectPattern(d.id) || t.isArrayPattern(d.id))) break;
				for (const id of Object.keys(t.getBindingIdentifiers(d.id))) reactive.add(id);
				if (args[1]) note_params(args[1]);
				const id = gen_inline(d.id);
				const ann = targs[0] ? `: ${gen_inline(targs[0])}` : '';
				if (t.isBlockStatement(cb.body)) {
					const only = cb.body.body.length === 1 && t.isReturnStatement(cb.body.body[0]) ? cb.body.body[0].argument : null;
					return only ? `const ${id}${ann} = $derived(${gen_inline(unwrap(only))});` : `const ${id}${ann} = $derived.by(() => ${gen(cb.body)});`;
				}
				return `const ${id}${ann} = $derived(${gen_inline(unwrap(cb.body))});`;
			}
			case 'useCallback': {
				const cb = args[0];
				if (!t.isIdentifier(d.id) || !is_fn(cb)) break;
				return `${kind} ${d.id.name} = ${gen(cb)};`;
			}
			case 'useContext': {
				if (!t.isIdentifier(d.id) && !t.isObjectPattern(d.id)) break;
				svelte_values.add('getContext');
				const key = args[0] ? gen_inline(args[0]) : 'undefined';
				for (const id of Object.keys(t.getBindingIdentifiers(d.id))) reactive.add(id);
				warnings.push(`${name}(): useContext(${key}) → getContext(${key}): a parent component must call setContext(${key}, …), and createContext(…) must become a key`);
				return `const ${gen_inline(d.id)} = getContext${targ}(${key});`;
			}
			case 'useSyncExternalStore': {
				if (!t.isIdentifier(d.id)) break;
				reactive.add(d.id.name);
				const [sub, snap] = args.map((x) => gen_inline(x));
				return `let ${d.id.name} = $state(${snap}());\n$effect(() => ${sub}(() => (${d.id.name} = ${snap}())));`;
			}
			case 'useDeferredValue': {
				if (!t.isIdentifier(d.id)) break;
				reactive.add(d.id.name);
				warnings.push(`${name}(): useDeferredValue → $derived: Svelte has no deferred rendering; the value updates immediately`);
				return `const ${d.id.name} = $derived(${args[0] ? gen_inline(args[0]) : 'undefined'});`;
			}
		}
		if (current_hooks.has(h.name)) return null; // local hook converted to { current }; refs already read .current
		if (!KNOWN_HOOKS.has(h.name)) warnings.push(`${name}() calls ${h.name}(), a custom hook from another file: port it to a .svelte.ts function too (its return value must stay reactive, e.g. getters)`);
		else warnings.push(`${name}(): ${h.name} isn't converted`);
		return null;
	}

	// 4. the return value must stay reactive
	const top_return = out.findIndex((s) => t.isReturnStatement(s));
	if (top_return >= 0) {
		const ret = out[top_return] as t.ReturnStatement;
		const arg = ret.argument ? unwrap(ret.argument) : null;
		if (arg && t.isIdentifier(arg) && reactive.has(arg.name) && !boxed.has(arg.name)) {
			ret.argument = parse_expr(`{\n\tget current() {\n\t\treturn ${arg.name};\n\t}\n}`);
			warnings.push(`${name}() now returns { current }: callers read ${name}(…).current (a returned $state value would be a snapshot)`);
		} else if (arg && t.isMemberExpression(arg) && t.isIdentifier(arg.object) && boxed.has(arg.object.name) && t.isIdentifier(arg.property, { name: 'current' })) {
			ret.argument = t.identifier(arg.object.name);
			warnings.push(`${name}() now returns { current }: callers read ${name}(…).current`);
		} else if (arg && t.isObjectExpression(arg) && is_reactive(arg)) {
			arg.properties = arg.properties.map((p) => {
				if (!t.isObjectProperty(p) || p.computed || !(t.isIdentifier(p.key) || t.isStringLiteral(p.key))) return p;
				const v = p.value as t.Expression;
				if (is_fn(v) || !is_reactive(v)) return p;
				return t.objectMethod('get', t.cloneNode(p.key), [], t.blockStatement([t.returnStatement(t.cloneNode(v, true))]));
			});
			warnings.push(`${name}() returns getters for its reactive fields: don't destructure the result (const x = ${name}(…); read x.field), or the values stop updating`);
		} else if (arg && t.isArrayExpression(arg) && is_reactive(arg)) {
			const els = arg.elements;
			const keys = els.map((e) => (t.isIdentifier(e) ? e.name : t.isMemberExpression(e) && t.isIdentifier(e.object) && boxed.has(e.object.name) ? e.object.name : null));
			if (keys.every((k): k is string => !!k)) {
				const parts = els.map((e, i) => {
					const k = keys[i];
					return e && is_reactive(e) && !is_fn(e) ? `get ${k}() {\n\t\treturn ${gen_inline(e)};\n\t}` : k === gen_inline(e!) ? k : `${k}: ${gen_inline(e!)}`;
				});
				ret.argument = parse_expr(`{\n\t${parts.join(',\n\t')}\n}`);
				warnings.push(`${name}() returned a tuple; it now returns { ${keys.join(', ')} } with getters: callers change \`const [${keys.join(', ')}] = ${name}(…)\` to \`const x = ${name}(…)\` and read x.${keys[0]}`);
			} else warnings.push(`${name}() returns a tuple of reactive values: destructuring snapshots them; return an object with getters instead`);
		} else if (arg && is_reactive(arg) && !boxed.has((arg as t.Identifier).name)) {
			warnings.push(`${name}() returns an expression of reactive values (${gen_inline(arg).slice(0, 40)}): it is read once; return a getter or an object with getters`);
		}
	}
	for (const s of out) {
		if (s === out[top_return]) continue;
		let nested = false;
		t.traverseFast(s, (n) => {
			if (t.isReturnStatement(n) && n.argument && is_reactive(n.argument)) nested = true;
		});
		if (nested && !t.isFunctionDeclaration(s) && !(t.isExpressionStatement(s) && t.isCallExpression(s.expression))) {
			warnings.push(`${name}() has an early return of reactive values; only the final return was made reactive`);
			break;
		}
	}

	for (const p of params_read) warnings.push(`${name}(): parameter \`${p}\` is read once in Svelte; for a reactive input accept a getter (${p}: () => T) and call ${p}() inside`);

	block.body = out;
}

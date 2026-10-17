/**
 * React's TypeScript types → their Svelte 5 equivalents, rewritten on the AST in place
 * before anything is printed: `ReactNode` → `Snippet`, a function returning one →
 * `Snippet<[…params]>`, `HTMLAttributes` → `svelte/elements`, synthetic events → DOM
 * events with a typed `currentTarget`, `Dispatch<SetStateAction<T>>` → a setter.
 *
 * Only references that really are React's are touched: `React.X`, or a bare `X`
 * imported from 'react'. A DOM `MouseEvent` that never came from React stays as is.
 */

import { parse } from '@babel/parser';
import * as t from '@babel/types';
import { gen_inline } from './gen.ts';

const NODE_TYPES = new Set(['ReactNode', 'ReactElement', 'ReactChild', 'ReactFragment', 'ReactPortal', 'JSX.Element', 'Element']);
const DOM_EVENTS = new Set(['MouseEvent', 'KeyboardEvent', 'PointerEvent', 'FocusEvent', 'WheelEvent', 'DragEvent', 'TouchEvent', 'ClipboardEvent', 'AnimationEvent', 'TransitionEvent', 'CompositionEvent', 'UIEvent']);
const GENERIC_EVENTS = new Set(['ChangeEvent', 'FormEvent', 'InputEvent', 'SyntheticEvent', 'BaseSyntheticEvent', 'InvalidEvent']);
/** React's `<X>HTMLAttributes<T>` names whose `svelte/elements` twin is `HTML<X>Attributes`. */
const ATTRIBUTE_TYPES: Record<string, string> = {
	AnchorHTMLAttributes: 'HTMLAnchorAttributes',
	ButtonHTMLAttributes: 'HTMLButtonAttributes',
	FormHTMLAttributes: 'HTMLFormAttributes',
	ImgHTMLAttributes: 'HTMLImgAttributes',
	InputHTMLAttributes: 'HTMLInputAttributes',
	LabelHTMLAttributes: 'HTMLLabelAttributes',
	LiHTMLAttributes: 'HTMLLiAttributes',
	OlHTMLAttributes: 'HTMLOlAttributes',
	OptionHTMLAttributes: 'HTMLOptionAttributes',
	SelectHTMLAttributes: 'HTMLSelectAttributes',
	TableHTMLAttributes: 'HTMLTableAttributes',
	TdHTMLAttributes: 'HTMLTdAttributes',
	TextareaHTMLAttributes: 'HTMLTextareaAttributes',
	ThHTMLAttributes: 'HTMLThAttributes',
	VideoHTMLAttributes: 'HTMLVideoAttributes',
	AudioHTMLAttributes: 'HTMLAudioAttributes',
	DialogHTMLAttributes: 'HTMLDialogAttributes',
	DetailsHTMLAttributes: 'HTMLDetailsAttributes',
	IframeHTMLAttributes: 'HTMLIframeAttributes',
	ProgressHTMLAttributes: 'HTMLProgressAttributes'
};

/** Which Svelte type names the rewritten types use, so the file can import them. */
export interface TypeUse {
	svelte: Set<string>; // from 'svelte'
	elements: Set<string>; // from 'svelte/elements'
}

export const new_type_use = (): TypeUse => ({ svelte: new Set(), elements: new Set() });

function parse_type(src: string): t.TSType {
	const file = parse(`type __T = ${src};`, { sourceType: 'module', plugins: ['typescript'] });
	return (file.program.body[0] as t.TSTypeAliasDeclaration).typeAnnotation;
}

/** `React.X` or a bare `X` imported from react → 'X'; anything else → null. */
function react_name(node: t.TSTypeReference, react: Set<string>): string | null {
	const n = node.typeName;
	if (t.isTSQualifiedName(n) && t.isIdentifier(n.left)) {
		if (n.left.name === 'React' || react.has(n.left.name)) return n.right.name;
		if (n.left.name === 'JSX') return `JSX.${n.right.name}`;
		return null;
	}
	if (t.isTSQualifiedName(n) && t.isTSQualifiedName(n.left) && t.isIdentifier(n.left.left) && n.left.left.name === 'React' && n.left.right.name === 'JSX') {
		return `JSX.${n.right.name}`;
	}
	if (t.isIdentifier(n) && react.has(n.name)) return n.name;
	return null;
}

const args_of = (node: t.TSTypeReference): t.TSType[] => node.typeArguments?.params ?? [];

/** Is this type React's notion of renderable content (so a Svelte snippet)? */
export function is_node_type(type: t.Node | null | undefined, react: Set<string>): boolean {
	if (!type) return false;
	if (t.isTSTypeAnnotation(type)) return is_node_type(type.typeAnnotation, react);
	if (t.isTSParenthesizedType(type)) return is_node_type(type.typeAnnotation, react);
	if (t.isTSUnionType(type)) return type.types.some((x) => is_node_type(x, react));
	if (t.isTSTypeReference(type)) {
		const name = react_name(type, react);
		if (name && NODE_TYPES.has(name)) return true;
		// already rewritten
		if (t.isIdentifier(type.typeName) && type.typeName.name === 'Snippet') return true;
	}
	return false;
}

/** A function type that returns renderable content: a render prop. */
export function is_render_fn_type(type: t.Node | null | undefined, react: Set<string>): boolean {
	if (!type) return false;
	if (t.isTSTypeAnnotation(type)) return is_render_fn_type(type.typeAnnotation, react);
	if (t.isTSParenthesizedType(type)) return is_render_fn_type(type.typeAnnotation, react);
	if (t.isTSUnionType(type)) return type.types.some((x) => is_render_fn_type(x, react));
	return t.isTSFunctionType(type) && is_node_type(type.returnType, react);
}

function param_types(fn: t.TSFunctionType): string {
	return fn.params
		.map((p) => {
			const ann = 'typeAnnotation' in p && p.typeAnnotation && t.isTSTypeAnnotation(p.typeAnnotation) ? p.typeAnnotation.typeAnnotation : null;
			const type = ann ? gen_inline(ann) : 'any';
			return t.isRestElement(p) ? `...${type}` : type;
		})
		.join(', ');
}

/** The replacement for one React type reference, or null to leave it. */
function replacement(node: t.TSTypeReference, react: Set<string>, use: TypeUse): string | null {
	const name = react_name(node, react);
	if (!name) return null;
	const args = args_of(node).map(gen_inline);
	const a0 = args[0];
	if (NODE_TYPES.has(name)) {
		use.svelte.add('Snippet');
		return 'Snippet';
	}
	if (name === 'PropsWithChildren') {
		use.svelte.add('Snippet');
		return `${a0 ?? '{}'} & { children?: Snippet }`;
	}
	if (name === 'FC' || name === 'FunctionComponent' || name === 'VFC' || name === 'ComponentType' || name === 'ElementType' || name === 'ComponentClass') {
		use.svelte.add('Component');
		return `Component<${a0 ?? 'any'}>`;
	}
	if (name === 'ComponentProps' || name === 'ComponentPropsWithoutRef' || name === 'ComponentPropsWithRef' || name === 'JSX.IntrinsicElements') {
		const tag = args_of(node)[0];
		if (tag && t.isTSLiteralType(tag) && t.isStringLiteral(tag.literal)) {
			use.elements.add('SvelteHTMLElements');
			return `SvelteHTMLElements['${tag.literal.value}']`;
		}
		use.svelte.add('ComponentProps');
		return `ComponentProps<${a0 ?? 'any'}>`;
	}
	if (name === 'HTMLAttributes' || name === 'AllHTMLAttributes' || name === 'DOMAttributes') {
		use.elements.add('HTMLAttributes');
		return `HTMLAttributes<${a0 ?? 'HTMLElement'}>`;
	}
	if (name === 'SVGAttributes' || name === 'SVGProps') {
		use.elements.add('SVGAttributes');
		return `SVGAttributes<${a0 ?? 'SVGElement'}>`;
	}
	if (ATTRIBUTE_TYPES[name]) {
		use.elements.add(ATTRIBUTE_TYPES[name]);
		return ATTRIBUTE_TYPES[name];
	}
	if (name === 'CSSProperties') return 'string';
	if (name === 'Key') return 'string | number';
	if (DOM_EVENTS.has(name)) return a0 ? `${name} & { currentTarget: EventTarget & ${a0} }` : name;
	if (GENERIC_EVENTS.has(name)) return a0 ? `Event & { currentTarget: EventTarget & ${a0} }` : 'Event';
	const handler = name.match(/^(\w+Event)Handler$/);
	if (handler) {
		const ev = handler[1];
		const mapped = DOM_EVENTS.has(ev) ? (a0 ? `${ev} & { currentTarget: EventTarget & ${a0} }` : ev) : a0 ? `Event & { currentTarget: EventTarget & ${a0} }` : 'Event';
		return `(event: ${mapped}) => void`;
	}
	if (name === 'Dispatch') {
		const inner = args_of(node)[0];
		if (inner && t.isTSTypeReference(inner) && react_name(inner, react) === 'SetStateAction') {
			const v = args_of(inner)[0];
			return `(value: ${v ? gen_inline(v) : 'any'}) => void`;
		}
		return `(action: ${a0 ?? 'any'}) => void`;
	}
	if (name === 'SetStateAction') return a0 ?? 'any';
	if (name === 'RefObject' || name === 'MutableRefObject') return `{ current: ${a0 ?? 'any'} | null }`;
	if (name === 'Ref' || name === 'ForwardedRef' || name === 'LegacyRef') return `${a0 ?? 'HTMLElement'} | null`;
	return null;
}

/**
 * Rewrites every React type in `root` (any node: a file, a param, an annotation) in
 * place. Returns the React type names it could not map.
 */
export function map_react_types(root: t.Node, react: Set<string>, use: TypeUse): string[] {
	const unmapped: string[] = [];
	const visit = (node: t.Node, parent: t.Node | null, key: string | null, index: number | null) => {
		// `(r: Row) => ReactNode` → `Snippet<[Row]>`, before its parts are rewritten.
		if (t.isTSFunctionType(node) && is_node_type(node.returnType, react)) {
			use.svelte.add('Snippet');
			const params = param_types(node);
			replace(parent!, key!, index, parse_type(params ? `Snippet<[${params}]>` : 'Snippet'));
			return;
		}
		if (t.isTSTypeReference(node)) {
			const r = replacement(node, react, use);
			if (r != null) {
				replace(parent!, key!, index, parse_type(r));
				return;
			}
			const name = react_name(node, react);
			if (name && !name.startsWith('JSX.')) unmapped.push(name);
		}
		for (const k of t.VISITOR_KEYS[node.type] ?? []) {
			const child = (node as unknown as Record<string, unknown>)[k];
			if (Array.isArray(child)) child.forEach((c, i) => c && typeof c === 'object' && 'type' in c && visit(c as t.Node, node, k, i));
			else if (child && typeof child === 'object' && 'type' in child) visit(child as t.Node, node, k, null);
		}
	};
	visit(root, null, null, null);
	return [...new Set(unmapped)];
}

function replace(parent: t.Node, key: string, index: number | null, value: t.Node) {
	const holder = parent as unknown as Record<string, unknown>;
	if (index == null) holder[key] = value;
	else (holder[key] as t.Node[])[index] = value;
}

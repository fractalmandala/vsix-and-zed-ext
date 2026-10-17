/** Printing AST nodes back to source, the only place strings are produced. */

import _generate from '@babel/generator';
import * as t from '@babel/types';

// Babel ships these as interop default exports.
const generate = ((_generate as unknown as { default?: typeof _generate }).default ?? _generate) as typeof _generate;

function detached(node: t.Node): t.Node {
	const copy = t.cloneNode(node, true) as t.Node;
	const strip = (value: t.Node) => {
		const record = value as unknown as Record<string, unknown>;
		delete record.loc;
		delete record.start;
		delete record.end;
		delete record.extra;
		for (const key of t.VISITOR_KEYS[value.type] ?? []) {
			const child = record[key];
			if (Array.isArray(child)) {
				for (const item of child) if (item && typeof item === 'object' && 'type' in item) strip(item as t.Node);
			} else if (child && typeof child === 'object' && 'type' in child) strip(child as t.Node);
		}
	};
	strip(copy);
	return copy;
}

/** Multi-line, for script statements. */
export const gen = (node: t.Node): string => generate(detached(node), { jsescOption: { minimal: true, quotes: 'single' } }).code;

/** One line, for template expressions and attribute values. */
export const gen_inline = (node: t.Node): string =>
	generate(detached(node), { concise: true, jsescOption: { minimal: true, quotes: 'single' } })
		.code.replace(/;\s*$/, '')
		.trim();

/** A pattern with its TypeScript annotations removed (each-block items, @const). */
export function gen_pattern(node: t.Node): string {
	const clone = t.cloneNode(node, true);
	strip_annotations(clone);
	return gen_inline(clone);
}

function strip_annotations(node: t.Node) {
	if ('typeAnnotation' in node && !t.isTSAsExpression(node) && !t.isTSSatisfiesExpression(node) && !t.isTSTypeAnnotation(node)) (node as { typeAnnotation?: unknown }).typeAnnotation = null;
	if ('optional' in node && t.isIdentifier(node)) node.optional = false;
	for (const k of t.VISITOR_KEYS[node.type] ?? []) {
		const child = (node as unknown as Record<string, unknown>)[k];
		if (Array.isArray(child)) child.forEach((c) => c && typeof c === 'object' && 'type' in c && strip_annotations(c as t.Node));
		else if (child && typeof child === 'object' && 'type' in child) strip_annotations(child as t.Node);
	}
}

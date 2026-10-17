import * as t from '@babel/types';

export interface ClassNormalization {
	warnings: string[];
	converted: number;
}

type ClassLike = t.ClassDeclaration | t.ClassExpression;

interface ClassNames {
	methods: Set<string>;
	getters: Set<string>;
	fields: Set<string>;
}

interface ClassSummary {
	names: ClassNames;
	unsupported: string[];
	constructor: t.ClassMethod | null;
	render: t.ClassMethod | null;
	mount: t.ClassMethod | null;
	unmount: t.ClassMethod | null;
	should_update: boolean;
}

interface ClassConversion {
	fn: t.FunctionDeclaration | t.FunctionExpression | null;
	warnings: string[];
}

const ignored_lifecycle_methods = new Set(['shouldComponentUpdate', 'componentDidMount', 'componentWillUnmount']);
const unsupported_lifecycle_methods = new Set([
	'componentDidUpdate',
	'componentWillReceiveProps',
	'componentWillUpdate',
	'componentWillMount',
	'UNSAFE_componentWillMount',
	'UNSAFE_componentWillReceiveProps',
	'UNSAFE_componentWillUpdate',
	'getSnapshotBeforeUpdate',
	'componentDidCatch',
	'getDerivedStateFromProps'
]);

function key_name(node: t.Node): string | null {
	if (t.isIdentifier(node)) return node.name;
	if (t.isStringLiteral(node) || t.isNumericLiteral(node)) return String(node.value);
	return null;
}

function is_component_superclass(node: t.Node | null | undefined): boolean {
	if (!node) return false;
	if (t.isIdentifier(node)) return /Component$/.test(node.name);
	if (t.isMemberExpression(node) && !node.computed && t.isIdentifier(node.property)) return /Component$/.test(node.property.name);
	return false;
}

function unique_name(preferred: string, used: Set<string>): string {
	if (!used.has(preferred)) {
		used.add(preferred);
		return preferred;
	}
	for (let i = 2; ; i++) {
		const candidate = `${preferred}${i}`;
		if (!used.has(candidate)) {
			used.add(candidate);
			return candidate;
		}
	}
}

function collect_names(node: t.Node): Set<string> {
	const names = new Set<string>();
	const visit = (child: t.Node, parent: t.Node | null) => {
		if (t.isIdentifier(child)) {
			const is_member_property = (t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) && parent.property === child && !parent.computed;
			const is_object_key = t.isObjectProperty(parent) && parent.key === child && !parent.computed && parent.value !== child;
			const is_class_key = (t.isClassMethod(parent) || t.isClassProperty(parent)) && parent.key === child && !parent.computed;
			if (!is_member_property && !is_object_key && !is_class_key) names.add(child.name);
		}
		for (const key of t.VISITOR_KEYS[child.type] ?? []) {
			const value = (child as unknown as Record<string, unknown>)[key];
			if (Array.isArray(value)) {
				for (const item of value) if (item && typeof item === 'object' && 'type' in item) visit(item as t.Node, child);
			} else if (value && typeof value === 'object' && 'type' in value) visit(value as t.Node, child);
		}
	};
	visit(node, null);
	return names;
}

function is_this_member(node: t.Node): node is t.MemberExpression & { property: t.Identifier } {
	return t.isMemberExpression(node) && !node.computed && t.isThisExpression(node.object) && t.isIdentifier(node.property);
}

function method_name(member: t.ClassMethod): string | null {
	return member.computed ? null : key_name(member.key);
}

function class_member_names(cls: ClassLike): ClassNames {
	const names: ClassNames = { methods: new Set(), getters: new Set(), fields: new Set() };
	for (const member of cls.body.body) {
		if (t.isClassMethod(member)) {
			const name = method_name(member);
			if (!name || name === 'constructor') continue;
			if (member.kind === 'get') names.getters.add(name);
			else if (member.kind === 'method') names.methods.add(name);
		} else if (t.isClassProperty(member) && !member.computed) {
			const name = key_name(member.key);
			if (name) names.fields.add(name);
		}
	}
	return names;
}

function class_uses_member(cls: ClassLike, name: string): boolean {
	let found = false;
	t.traverseFast(cls, (node) => {
		if (is_this_member(node) && node.property.name === name) found = true;
	});
	return found;
}

function collect_instance_fields(cls: ClassLike, names: ClassNames): void {
	t.traverseFast(cls, (node) => {
		if (!is_this_member(node)) return;
		const name = node.property.name;
		if (name !== 'props' && name !== 'state' && name !== 'setState' && !names.methods.has(name) && !names.getters.has(name)) names.fields.add(name);
	});
}

function direct_assignment(statement: t.Statement): { name: string; value: t.Expression } | null {
	if (!t.isExpressionStatement(statement) || !t.isAssignmentExpression(statement.expression, { operator: '=' })) return null;
	const left = statement.expression.left;
	if (!is_this_member(left)) return null;
	return { name: left.property.name, value: statement.expression.right as t.Expression };
}

function state_initializer(cls: ClassLike, constructor: t.ClassMethod | null): t.Expression | null {
	for (const member of cls.body.body) {
		if (!t.isClassProperty(member) || member.static || member.computed || key_name(member.key) !== 'state') continue;
		return member.value && t.isExpression(member.value) ? t.cloneNode(member.value, true) as t.Expression : null;
	}
	if (!constructor) return null;
	for (const statement of constructor.body.body) {
		const assignment = direct_assignment(statement);
		if (assignment?.name === 'state') return t.cloneNode(assignment.value, true) as t.Expression;
	}
	return null;
}

function is_super_statement(statement: t.Statement): boolean {
	return t.isExpressionStatement(statement) && t.isCallExpression(statement.expression) && t.isSuper(statement.expression.callee);
}

function is_self_binding(value: t.Expression, name: string): boolean {
	return (
		t.isCallExpression(value) &&
		t.isMemberExpression(value.callee) &&
		!value.callee.computed &&
		t.isIdentifier(value.callee.property, { name: 'bind' }) &&
		value.arguments.length === 1 &&
		t.isThisExpression(value.arguments[0]) &&
		is_this_member(value.callee.object) &&
		value.callee.object.property.name === name
	);
}

function function_parameter(param: t.ClassMethod['params'][number]): t.FunctionParameter {
	if (t.isTSParameterProperty(param)) return t.cloneNode(param.parameter, true) as t.FunctionParameter;
	return t.cloneNode(param, true) as t.FunctionParameter;
}

function parameter_identifier(param: t.ClassMethod['params'][number] | null): t.Identifier | null {
	if (!param) return null;
	const value = t.isTSParameterProperty(param) ? param.parameter : param;
	if (t.isIdentifier(value)) return value;
	if (t.isAssignmentPattern(value) && t.isIdentifier(value.left)) return value.left;
	return null;
}

function summarize_class(cls: ClassLike): ClassSummary {
	const names = class_member_names(cls);
	const unsupported: string[] = [];
	let constructor: t.ClassMethod | null = null;
	let render: t.ClassMethod | null = null;
	let mount: t.ClassMethod | null = null;
	let unmount: t.ClassMethod | null = null;
	let should_update = false;
	for (const member of cls.body.body) {
		if (t.isClassMethod(member)) {
			const name = method_name(member);
			if (!name) {
				unsupported.push('computed class methods');
				continue;
			}
			if (member.static) {
				unsupported.push(`static member ${name}`);
				continue;
			}
			if (name === 'constructor') {
				if (constructor) unsupported.push('multiple constructors');
				else constructor = member;
			} else if (name === 'render') {
				if (render) unsupported.push('multiple render methods');
				else render = member;
			} else if (name === 'componentDidMount') mount = member;
			else if (name === 'componentWillUnmount') unmount = member;
			else if (name === 'shouldComponentUpdate') should_update = true;
			else if (unsupported_lifecycle_methods.has(name)) unsupported.push(`${name} has no safe Svelte equivalent`);
			else if (member.kind === 'set') unsupported.push(`setter ${name}`);
		} else if (t.isClassProperty(member)) {
			if (member.static) unsupported.push(`static member ${key_name(member.key) ?? 'unknown'}`);
			if (member.computed) unsupported.push('computed class fields');
		} else {
			unsupported.push('private class members');
		}
	}
	if (!render) unsupported.push('no render method');
	return { names, unsupported: [...new Set(unsupported)], constructor, render, mount, unmount, should_update };
}

function set_child(parent: t.Node, key: string, index: number | null, value: t.Node): void {
	const holder = parent as unknown as Record<string, unknown>;
	if (index == null) holder[key] = value;
	else (holder[key] as t.Node[])[index] = value;
}

function rewrite_class_references(
	root: t.Node,
	props_name: string,
	state_name: string | null,
	setter_name: string | null,
	names: ClassNames,
	used: Set<string>,
	warnings: string[]
): boolean {
	let unsupported = false;
	const rewrite = (node: t.Node, parent: t.Node | null, key: string | null, index: number | null, state_override: string | null = null): void => {
		if (t.isSuper(node)) {
			warnings.push('class `super` usage outside the constructor is not representable as a function component');
			unsupported = true;
			return;
		}
		if (t.isCallExpression(node) && t.isMemberExpression(node.callee) && !node.callee.computed && t.isIdentifier(node.callee.property, { name: 'bind' }) && node.arguments.length === 1 && t.isThisExpression(node.arguments[0])) {
			const target = node.callee.object;
			const name = is_this_member(target) ? target.property.name : null;
			if (name && (names.methods.has(name) || names.getters.has(name))) {
				if (parent && key) set_child(parent, key, index, t.identifier(name));
				return;
			}
		}
		if (t.isCallExpression(node) && t.isMemberExpression(node.callee) && !node.callee.computed && is_this_member(node.callee) && node.callee.property.name === 'setState' && setter_name) {
			const update = node.arguments[0] && !t.isSpreadElement(node.arguments[0]) ? node.arguments[0] : null;
			const previous = t.identifier(unique_name('__previousState', used));
			const patch = t.identifier(unique_name('__statePatch', used));
			let patch_expression: t.Expression;
			if (update && (t.isArrowFunctionExpression(update) || t.isFunctionExpression(update))) {
				const updater = t.cloneNode(update, true) as t.ArrowFunctionExpression | t.FunctionExpression;
				rewrite(updater, null, null, null, previous.name);
				patch_expression = t.callExpression(t.parenthesizedExpression(updater), [previous]);
			} else {
				patch_expression = update ? t.cloneNode(update, true) as t.Expression : t.objectExpression([]);
				if (update) rewrite(patch_expression, null, null, null, previous.name);
			}
			if (!update) warnings.push('this.setState without an update object was converted to a no-op');
			const merged = t.objectExpression([t.spreadElement(previous), t.spreadElement(patch)]);
			const callback = t.arrowFunctionExpression(
				[previous],
				t.blockStatement([
					t.variableDeclaration('const', [t.variableDeclarator(patch, patch_expression)]),
					t.returnStatement(t.conditionalExpression(t.binaryExpression('==', patch, t.nullLiteral()), previous, merged))
				])
			);
			let replacement: t.Expression = t.callExpression(t.identifier(setter_name), [callback]);
			if (node.arguments[1] && !t.isSpreadElement(node.arguments[1])) {
				warnings.push('this.setState callback timing may differ in Svelte');
				replacement = t.sequenceExpression([replacement, t.callExpression(t.cloneNode(node.arguments[1], true) as t.Expression, [])]);
			}
			if (parent && key) {
				set_child(parent, key, index, replacement);
				rewrite(replacement, parent, key, index);
			}
			return;
		}
		if (t.isMemberExpression(node) && !node.computed && t.isThisExpression(node.object) && t.isIdentifier(node.property)) {
			const name = node.property.name;
			let replacement: t.Expression | null = null;
			if (name === 'props') replacement = t.identifier(props_name);
			else if (name === 'state' && state_name) replacement = t.identifier(state_override ?? state_name);
			else if (name === 'setState' && setter_name) replacement = t.identifier(setter_name);
			else if (names.getters.has(name)) replacement = t.callExpression(t.identifier(name), []);
			else if (names.methods.has(name) || names.fields.has(name)) replacement = t.identifier(name);
			if (replacement) {
				if (parent && key) set_child(parent, key, index, replacement);
				return;
			}
			warnings.push(`this.${name} could not be mapped to a component-local value`);
			unsupported = true;
			return;
		}
		if (t.isOptionalMemberExpression(node) && !node.computed && t.isThisExpression(node.object) && t.isIdentifier(node.property)) {
			const name = node.property.name;
			let replacement: t.Expression | null = null;
			if (name === 'props') replacement = t.identifier(props_name);
			else if (name === 'state' && state_name) replacement = t.identifier(state_override ?? state_name);
			else if (name === 'setState' && setter_name) replacement = t.identifier(setter_name);
			else if (names.getters.has(name)) replacement = t.callExpression(t.identifier(name), []);
			else if (names.methods.has(name) || names.fields.has(name)) replacement = t.identifier(name);
			if (replacement) {
				if (parent && key) set_child(parent, key, index, replacement);
				return;
			}
			warnings.push(`this.${name} could not be mapped to a component-local value`);
			unsupported = true;
			return;
		}
		if (t.isThisExpression(node)) {
			warnings.push('class instance `this` usage is not representable as a function component');
			unsupported = true;
			return;
		}
		for (const child_key of t.VISITOR_KEYS[node.type] ?? []) {
			const child = (node as unknown as Record<string, unknown>)[child_key];
			if (Array.isArray(child)) child.forEach((item, i) => item && typeof item === 'object' && 'type' in item && rewrite(item as t.Node, node, child_key, i, state_override));
			else if (child && typeof child === 'object' && 'type' in child) rewrite(child as t.Node, node, child_key, null, state_override);
		}
	};
	rewrite(root, null, null, null);
	return !unsupported;
}

function lifecycle_effect(mount: t.ClassMethod | null, unmount: t.ClassMethod | null): t.ExpressionStatement | null {
	if (!mount && !unmount) return null;
	const body: t.Statement[] = [];
	if (mount) body.push(...mount.body.body.map((statement) => t.cloneNode(statement, true) as t.Statement));
	if (unmount) body.push(t.returnStatement(t.arrowFunctionExpression([], t.blockStatement(unmount.body.body.map((statement) => t.cloneNode(statement, true) as t.Statement)))));
	return t.expressionStatement(t.callExpression(t.identifier('useEffect'), [t.arrowFunctionExpression([], t.blockStatement(body)), t.arrayExpression([])]));
}

function convert_class(cls: ClassLike, fallback_name: string, expression: boolean): ClassConversion {
	const warnings: string[] = [];
	if (!is_component_superclass(cls.superClass)) return { fn: null, warnings };
	const summary = summarize_class(cls);
	const class_name = cls.id?.name ?? fallback_name;
	if (summary.unsupported.length) {
		warnings.push(`class component ${class_name} isn't converted: ${summary.unsupported.join(', ')}`);
		return { fn: null, warnings };
	}
	if (summary.constructor && summary.constructor.params.length > 1) {
		warnings.push(`class component ${class_name} isn't converted: constructor must accept at most props`);
		return { fn: null, warnings };
	}
	const names = summary.names;
	collect_instance_fields(cls, names);
	const used = collect_names(cls);
	const constructor_param = summary.constructor?.params[0] ?? null;
	const constructor_props = parameter_identifier(constructor_param);
	if (constructor_param && !constructor_props && class_uses_member(cls, 'props')) {
		warnings.push(`class component ${class_name} isn't converted: constructor props must be an identifier`);
		return { fn: null, warnings };
	}
	const props_name = constructor_props?.name ?? unique_name('props', used);
	const initial_state = state_initializer(cls, summary.constructor);
	const has_state = !!initial_state || class_uses_member(cls, 'state') || class_uses_member(cls, 'setState');
	const state_name = has_state ? unique_name('__state', used) : null;
	const setter_name = has_state ? unique_name('__setState', used) : null;
	const fields = new Map<string, t.Expression | null>();
	for (const member of cls.body.body) {
		if (!t.isClassProperty(member) || member.static || member.computed) continue;
		const name = key_name(member.key);
		if (!name || name === 'state') continue;
		fields.set(name, member.value && t.isExpression(member.value) ? t.cloneNode(member.value, true) as t.Expression : null);
	}
	for (const name of names.fields) if (name !== 'state' && !fields.has(name)) fields.set(name, null);
	const constructor_statements: t.Statement[] = [];
	if (summary.constructor) {
		for (const statement of summary.constructor.body.body) {
			if (is_super_statement(statement)) continue;
			const assignment = direct_assignment(statement);
			if (assignment?.name === 'state') continue;
			if (assignment && names.methods.has(assignment.name) && is_self_binding(assignment.value, assignment.name)) continue;
			if (assignment && names.fields.has(assignment.name) && !fields.has(assignment.name)) {
				fields.set(assignment.name, t.cloneNode(assignment.value, true) as t.Expression);
				continue;
			}
			constructor_statements.push(t.cloneNode(statement, true) as t.Statement);
		}
	}
	const body: t.Statement[] = [];
	if (has_state && state_name && setter_name) {
		body.push(t.variableDeclaration('const', [t.variableDeclarator(t.arrayPattern([t.identifier(state_name), t.identifier(setter_name)]), t.callExpression(t.identifier('useState'), [initial_state ? t.cloneNode(initial_state, true) as t.Expression : t.objectExpression([])]))]));
		if (!initial_state) warnings.push('class state was inferred without an initializer; initialized it to an empty object');
	}
	for (const [name, value] of fields) body.push(t.variableDeclaration('let', [t.variableDeclarator(t.identifier(name), value)]));
	body.push(...constructor_statements);
	const methods = new Map<string, t.ClassMethod>();
	for (const member of cls.body.body) {
		if (!t.isClassMethod(member) || member.static) continue;
		const name = method_name(member);
		if (!name || name === 'constructor' || name === 'render' || ignored_lifecycle_methods.has(name) || unsupported_lifecycle_methods.has(name)) continue;
		methods.set(name, member);
	}
	for (const [name, member] of methods) {
		const fn = t.functionDeclaration(t.identifier(name), member.params.map(function_parameter), t.cloneNode(member.body, true) as t.BlockStatement, member.generator, member.async);
		fn.returnType = member.returnType ? t.cloneNode(member.returnType, true) : null;
		fn.typeParameters = member.typeParameters ? t.cloneNode(member.typeParameters, true) : null;
		body.push(fn);
	}
	const effect = lifecycle_effect(summary.mount, summary.unmount);
	if (effect) {
		body.push(effect);
		warnings.push('componentDidMount/componentWillUnmount were mapped to onMount cleanup; review imperative DOM and async resource handling');
	}
	if (summary.should_update) warnings.push('shouldComponentUpdate has no direct Svelte equivalent and was dropped');
	if (summary.render) body.push(...summary.render.body.body.map((statement) => t.cloneNode(statement, true) as t.Statement));
	const params = constructor_props ? [function_parameter(constructor_param!)] : [t.identifier(props_name)];
	const fn = expression ? t.functionExpression(t.identifier(class_name), params, t.blockStatement(body)) : t.functionDeclaration(t.identifier(class_name), params, t.blockStatement(body));
	if (!rewrite_class_references(fn, props_name, state_name, setter_name, names, used, warnings)) return { fn: null, warnings };
	return { fn, warnings };
}

function normalize_statement(statement: t.Statement): { statement: t.Statement; warnings: string[]; converted: number } {
	const warnings: string[] = [];
	if (t.isClassDeclaration(statement)) {
		const result = convert_class(statement, statement.id?.name ?? 'Component', false);
		warnings.push(...result.warnings);
		return { statement: result.fn ? result.fn as t.FunctionDeclaration : statement, warnings, converted: result.fn ? 1 : 0 };
	}
	if (t.isExportDefaultDeclaration(statement) && t.isClassDeclaration(statement.declaration)) {
		const result = convert_class(statement.declaration, 'Component', false);
		warnings.push(...result.warnings);
		if (result.fn && t.isFunctionDeclaration(result.fn)) statement.declaration = result.fn;
		return { statement, warnings, converted: result.fn ? 1 : 0 };
	}
	if (t.isExportNamedDeclaration(statement) && t.isClassDeclaration(statement.declaration)) {
		const result = convert_class(statement.declaration, statement.declaration.id?.name ?? 'Component', false);
		warnings.push(...result.warnings);
		if (result.fn && t.isFunctionDeclaration(result.fn)) statement.declaration = result.fn;
		return { statement, warnings, converted: result.fn ? 1 : 0 };
	}
	if (t.isVariableDeclaration(statement)) {
		let converted = 0;
		for (const declaration of statement.declarations) {
			if (!t.isClassExpression(declaration.init)) continue;
			const name = t.isIdentifier(declaration.id) ? declaration.id.name : 'Component';
			const result = convert_class(declaration.init, name, true);
			warnings.push(...result.warnings);
			if (result.fn && t.isFunctionExpression(result.fn)) {
				declaration.init = result.fn;
				converted++;
			}
		}
		return { statement, warnings, converted };
	}
	return { statement, warnings, converted: 0 };
}

export function normalize_class_components(ast: t.File): ClassNormalization {
	const warnings: string[] = [];
	let converted = 0;
	ast.program.body = ast.program.body.map((statement) => {
		const result = normalize_statement(statement);
		warnings.push(...result.warnings);
		converted += result.converted;
		return result.statement;
	});
	return { warnings: [...new Set(warnings)], converted };
}

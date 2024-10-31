// deno-lint-ignore-file no-explicit-any
// Metadata polyfill for Node and Browser
(Symbol.metadata as any) ??= Symbol("Symbol.metadata");

export interface Context {
	kind: string;
	name: string | symbol;
	access: {
		get?(value: unknown): any;
		set?(object: unknown, value: any): void;
	};
	isPrivate?: boolean;
	isStatic?: boolean;
	addInitializer?(initializer: () => void): void;
	metadata: Record<string | number | symbol, unknown>;
}

interface MetadataField {
	type: string | undefined;
	class: new (...args: any[]) => any | undefined;
}

export type Decorator<T> = (value: T, context: Context) => T | void;

/**
 * Retrieve the value for a TC39 decorator metadata field
 * @param target 
 * @param key 
 * @returns 
 */
export function getMetadata(target: any, key: string): MetadataField {
	// Metadata is stored on the class only, so an instance of a Dto does not directly have the metadata
	// If we have an instance, we need to get the constructor to get the metadata
	const _target = target.constructor.name === "Function"
		? target
		: target.constructor;
	const classMetadata = _target[Symbol.metadata] ?? {};
	const metadata = classMetadata[key] ?? { losslessJson: {} };
	return metadata.losslessJson;
}

export function setMetadata(context: Context, value: any) {
	const existingMetadata = context.metadata[context.name] ?? {};
	context.metadata[context.name] = {
		...existingMetadata,
		losslessJson: value,
	};
}

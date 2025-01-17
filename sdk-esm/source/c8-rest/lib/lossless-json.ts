// deno-lint-ignore-file no-explicit-any
/**
 * This is a custom JSON Parser that handles lossless parsing of int64 numbers by using the lossless-json library.
 *
 * This is motivated by the use of int64 for Camunda 8 Entity keys, which are not supported by JavaScript's Number type.
 * Variables could also contain unsafe large integers if an external system sends them to the broker.
 *
 * It converts all JSON numbers to lossless numbers, then converts them back to the correct type based on the metadata
 * of a Dto class - fields decorated with `@Int64` are converted to a `string`, fields decorated with `@BigIntValue` are
 * converted to `bigint`. All other numbers are converted to `number`. Throws if a number cannot be safely converted.
 *
 * It also handles nested Dtos by using the `@ChildDto` decorator.
 *
 * Update: added an optional `key` parameter to support the Camunda 8 REST API's use of an array under a key, e.g. { jobs : Job[] }
 *
 * Note: the parser uses DTO classes that extend the LosslessDto class to perform mappings of numeric types. However, only the type of
 * the annotated numerics is type-checked at runtime. Fields of other types are not checked.
 *
 * More details on the design here: https://github.com/camunda/camunda-8-js-sdk/issues/81#issuecomment-2022213859
 *
 * See this article to understand why this is necessary: https://jsoneditoronline.org/indepth/parse/why-does-json-parse-corrupt-large-numbers/
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
// import { debug as d } from 'debug'
import {
	isLosslessNumber,
	LosslessNumber,
	parse,
	stringify,
	toSafeNumberOrThrow,
} from "lossless-json";
import {
	type Context,
	type Decorator,
	getMetadata,
	setMetadata,
} from "./tc39-metadata-utils.ts";

interface Indexable {
	[key: string]: any;
}

const debug = (_msg: string, _data?: any) => {};

export class LosslessDto {}

const MetadataKey = {
	INT64_STRING: "type:int64",
	INT64_STRING_ARRAY: "type:int64[]",
	INT64_BIGINT: "type:bigint",
	INT64_BIGINT_ARRAY: "type:bigint[]",
	CHILD_DTO: "child:class",
};

/**
 * Decorate Dto string fields as `@Int64String` to specify that the JSON number property should be parsed as a string.
 * @example
 * ```typescript
 * class MyDto extends LosslessDto {
 *   @Int64String
 *   int64NumberField!: string
 *   @BigIntValue
 *   bigintField!: bigint
 *   @ChildDto(MyChildDto)
 *   childDtoField!: MyChildDto
 *   normalField!: string
 *   normalNumberField!: number
 *   maybePresentField?: string
 * }
 * ```
 */
export const Int64String: Decorator<any> = (
	_target: any,
	context: Context,
): void => {
	setMetadata(context, {
		type: MetadataKey.INT64_STRING,
	});
};

/**
 * Decorate Dto string fields as `@Int64StringArray` to specify that the array of JSON numbers should be parsed as an array of strings.
 * @example
 * ```typescript
 * class Dto extends LosslessDto {
 *   message!: string
 *   userId!: number
 *   @Int64StringArray
 *   sendTo!: string[]
 * }
 */
export const Int64StringArray: Decorator<any> = (
	_target: unknown,
	context: Context,
): void => {
	setMetadata(context, {
		type: MetadataKey.INT64_STRING_ARRAY,
	});
};

/**
 * Decorate Dto bigint fields as `@BigIntValue` to specify that the JSON number property should be parsed as a bigint.
 * @example
 * ```typescript
 * class MyDto extends LosslessDto {
 *   @Int64String
 *   int64NumberField!: string
 *   @BigIntValue
 *   bigintField!: bigint
 *   @ChildDto(MyChildDto)
 *   childDtoField!: MyChildDto
 *   normalField!: string
 *   normalNumberField!: number
 *   maybePresentField?: string
 * }
 * ```
 */

export const BigIntValue: Decorator<any> = (
	_target: unknown,
	context: Context,
): void => {
	setMetadata(context, {
		type: MetadataKey.INT64_BIGINT,
	});
};

/**
 * Decorate Dto bigint fields as `@BigIntValueArray` to specify that the JSON number property should be parsed as a bigint.
 * @example
 * ```typescript
 * class MyDto extends LosslessDto {
 *   @Int64String
 *   int64NumberField!: string
 *   @BigIntValueArray
 *   bigintField!: bigint[]
 *   @ChildDto(MyChildDto)
 *   childDtoField!: MyChildDto
 *   normalField!: string
 *   normalNumberField!: number
 *   maybePresentField?: string
 * }
 * ```
 */
export const BigIntValueArray: Decorator<any> = (
	_target: unknown,
	context: Context,
): void => {
	setMetadata(context, {
		type: MetadataKey.INT64_BIGINT_ARRAY,
	});
};
/**
 * Decorate a Dto object field as `@ChildDto` to specify that the JSON object property should be parsed as a child Dto.
 * @example
 * ```typescript
 *
 * class MyChildDto extends LosslessDto {
 *   someField!: string
 * }
 *
 * class MyDto extends LosslessDto {
 *   @Int64String
 *   int64NumberField!: string
 *   @BigIntValue
 *   bigintField!: bigint
 *   @ChildDto(MyChildDto)
 *   childDtoField!: MyChildDto
 *   normalField!: string
 *   normalNumberField!: number
 *   maybePresentField?: string
 * }
 */
// deno-lint-ignore ban-types
export const ChildDto = (childClass: Function) => {
	return function (_target: unknown, context: Context): void {
		setMetadata(context, {
			type: MetadataKey.CHILD_DTO,
			class: childClass,
		});
	};
};

/**
 * Extend the LosslessDto class with your own Dto classes to enable lossless parsing of int64 values.
 * Decorate fields with `@Int64String` or `@BigIntValue` to specify how int64 JSON numbers should be parsed.
 * @example
 * ```typescript
 * class MyDto extends LosslessDto {
 *   @Int64String
 *   int64NumberField: string
 *   @BigIntValue
 *   bigintField: bigint
 *   @ChildDto(MyChildDto)
 *   childDtoField: MyChildDto
 *   normalField: string
 *   normalNumberField: number
 * }
 * ```
 */

/**
 * losslessParse uses lossless-json parse to deserialize JSON.
 * With no Dto, the parser will throw if it encounters an int64 number that cannot be safely represented as a JS number.
 *
 * @param json the JSON string to parse
 * @param dto an annotated Dto class to parse the JSON string with
 */
export function losslessParse<T = any>(
	json: string,
	dto?: { new (...args: any[]): T & Indexable },
	keyToParse?: string,
): T {
	/**
	 * lossless-json parse converts all numerics to LosslessNumber type instead of number type.
	 * Here we safely parse the string into an JSON object with all numerics as type LosslessNumber.
	 * This way we lose no fidelity at this stage, and can then use a supplied DTO to map large numbers
	 * or throw if we find an unsafe number.
	 */
	const parsedLossless = parse(json) as any;

	/**
	 * Specifying a keyToParse value applies all the mapping functionality to a key of the object in the JSON.
	 * gRPC API responses were naked objects or arrays of objects. REST response shapes typically have
	 * an array under an object key - eg: { jobs: [ ... ] }
	 *
	 * Since we now have a safely parsed object, we can recursively call losslessParse with the key, if it exists.
	 */
	if (keyToParse) {
		if (parsedLossless[keyToParse]) {
			return losslessParse(
				stringify(parsedLossless[keyToParse]) as string,
				dto,
			);
		}
		/**
		 * A key was specified, but it was not found on the parsed object.
		 * At this point we should throw, because we cannot perform the operation requested. Something has gone wrong with
		 * the expected shape of the response.
		 *
		 * We throw an error with the actual shape of the object to help with debugging.
		 */
		throw new Error(
			`Attempted to parse key ${keyToParse} on an object that does not have this key: ${
				stringify(
					parsedLossless,
				)
			}`,
		);
	}

	if (Array.isArray(parsedLossless)) {
		debug(`Array input detected. Parsing array.`);
		return parseArrayWithAnnotations(
			json,
			dto ?? (LosslessDto as new (...args: any[]) => T & Indexable),
		) as T;
	}
	if (!dto) {
		debug(`No Dto class provided. Parsing without annotations (safe parse).`);
		return convertLosslessNumbersToNumberOrThrow(parsedLossless) as T;
	}
	debug(`Got a Dto ${dto.name}. Parsing with annotations.`);
	const parsed = parseWithAnnotations(parsedLossless, dto);
	debug(`Converting remaining lossless numbers to numbers for ${dto.name}`);
	/** All numbers are parsed to LosslessNumber by lossless-json. For any fields that should be numbers, we convert them
	 * now to number. Because we expose large values as string or BigInt, the only Lossless numbers left on the object
	 * are unmapped. So at this point we convert all remaining LosslessNumbers to number type if safe, and throw if not.
	 */
	return convertLosslessNumbersToNumberOrThrow(parsed);
}

function parseWithAnnotations<T>(
	obj: any,
	dto: { new (...args: any[]): T & Indexable },
): T & Indexable {
	const instance = new dto();

	for (const [key, value] of Object.entries(obj)) {
		const fieldMetadata = getMetadata(dto, key);
		const childClass = fieldMetadata.type === MetadataKey.CHILD_DTO
			? fieldMetadata.class
			: null;
		if (childClass) {
			if (Array.isArray(value)) {
				// If the value is an array, parse each element with the specified child class
				(instance as any)[key] = value.map((item) =>
					losslessParse(stringify(item)!, childClass)
				);
			} else {
				// If the value is an object, parse it with the specified child class
				(instance as any)[key] = losslessParse(stringify(value)!, childClass);
			}
		} else {
			if (
				fieldMetadata.type === MetadataKey.INT64_STRING_ARRAY
			) {
				debug(`Parsing int64 array field "${key}" to string`);
				if (Array.isArray(value)) {
					(instance as any)[key] = value.map((item) => {
						if (isLosslessNumber(item)) {
							return item.toString();
						} else {
							debug("Unexpected type for value", value);
							throw new Error(
								`Unexpected type: Received JSON ${typeof item} value for Int64String Dto field "${key}", expected number`,
							);
						}
					});
				} else {
					const type = value instanceof LosslessNumber
						? "number"
						: typeof value;
					throw new Error(
						`Unexpected type: Received JSON ${type} value for Int64StringArray Dto field "${key}", expected Array`,
					);
				}
			} else if (
				fieldMetadata.type === MetadataKey.INT64_STRING
			) {
				debug(`Parsing int64 field "${key}" to string`);
				if (value) {
					if (isLosslessNumber(value)) {
						(instance as any)[key] = value.toString();
					} else {
						if (Array.isArray(value)) {
							throw new Error(
								`Unexpected type: Received JSON array value for Int64String Dto field "${key}", expected number. If you are expecting an array, use the @Int64StringArray decorator.`,
							);
						}
						const type = value instanceof LosslessNumber
							? "number"
							: typeof value;

						throw new Error(
							`Unexpected type: Received JSON ${type} value for Int64String Dto field "${key}", expected number`,
						);
					}
				}
			} else if (
				fieldMetadata.type === MetadataKey.INT64_BIGINT_ARRAY
			) {
				debug(`Parsing int64 array field "${key}" to BigInt`);
				if (Array.isArray(value)) {
					(instance as any)[key] = value.map((item) => {
						if (isLosslessNumber(item)) {
							return BigInt(item.toString());
						} else {
							debug("Unexpected type for value", value);
							throw new Error(
								`Unexpected type: Received JSON ${typeof item} value for BigIntValue in Dto field "${key}[]", expected number`,
							);
						}
					});
				} else {
					const type = value instanceof LosslessNumber
						? "number"
						: typeof value;
					throw new Error(
						`Unexpected type: Received JSON ${type} value for BigIntValueArray Dto field "${key}", expected Array`,
					);
				}
			} else if (
				getMetadata(dto, key).type === MetadataKey.INT64_BIGINT
			) {
				debug(`Parsing bigint field ${key}`);
				if (value) {
					if (isLosslessNumber(value)) {
						(instance as any)[key] = BigInt(value.toString());
					} else {
						if (Array.isArray(value)) {
							throw new Error(
								`Unexpected type: Received JSON array value for BigIntValue Dto field "${key}", expected number. If you are expecting an array, use the @BigIntValueArray decorator.`,
							);
						}
						throw new Error(
							`Unexpected type: Received JSON ${typeof value} value for BigIntValue Dto field "${key}", expected number`,
						);
					}
				}
			} else {
				(instance as any)[key] = value; // Assign directly for other types
			}
		}
	}

	return instance;
}

function parseArrayWithAnnotations<T>(
	json: string,
	dto: { new (...args: any[]): T & Indexable },
): T[] {
	const array = parse(json) as any[];

	return array.map((item) =>
		losslessParse(stringify(item) as string, dto)
	) as T[];
}

/**
 * Convert all `LosslessNumber` instances to a number or throw if any are unsafe.
 *
 * All numerics are converted to LosslessNumbers by lossless-json parse. Then, if a DTO was provided,
 * all mappings have been done to either BigInt or string type. So all remaining LosslessNumbers in the object
 * are either unmapped or mapped to number.
 *
 * Here we convert all remaining LosslessNumbers to a safe number value, or throw if an unsafe value is detected.
 */
function convertLosslessNumbersToNumberOrThrow<T>(obj: any): T {
	debug(`Parsing LosslessNumbers to numbers for ${obj?.constructor?.name}`);
	if (!obj) {
		return obj;
	}
	if (obj instanceof LosslessNumber) {
		return toSafeNumberOrThrow(obj.toString()) as T;
	}
	let currentKey = "";
	try {
		Object.keys(obj).forEach((key) => {
			currentKey = key;
			if (Array.isArray(obj[key])) {
				// If the value is an array, iterate over it and recursively call the function on each element
				obj[key].forEach((item: any, index: number) => {
					obj[key][index] = convertLosslessNumbersToNumberOrThrow(item);
				});
			} else if (isLosslessNumber(obj[key])) {
				debug(`Converting LosslessNumber ${key} to number`);
				obj[key] = toSafeNumberOrThrow(obj[key].toString());
			} else if (typeof obj[key] === "object" && obj[key] !== null) {
				// If the value is an object, recurse into it
				obj[key] = convertLosslessNumbersToNumberOrThrow(obj[key]);
			}
		});
	} catch (e) {
		const message = (e as Error).message;
		throw new Error(
			`An unsafe number value was received for "${currentKey}" and no Dto mapping was specified.\n` +
				message,
		);
	}
	return obj;
}

export function losslessStringify<T extends LosslessDto>(
	obj: T & Indexable,
	isTopLevel = true,
): string {
	const isLosslessDto = obj instanceof LosslessDto;

	debug(`Stringifying ${isLosslessDto ? obj.constructor.name : "object"}`);

	if (obj instanceof Date) {
		throw new Error(
			`Date type not supported in variables. Please serialize with .toISOString() before passing to Camunda`,
		);
	}
	if (obj instanceof Map) {
		throw new Error(
			`Map type not supported in variables. Please serialize with Object.fromEntries() before passing to Camunda`,
		);
	}
	if (obj instanceof Set) {
		throw new Error(
			`Set type not supported in variables. Please serialize with Array.from() before passing to Camunda`,
		);
	}

	if (!isLosslessDto) {
		debug(`Object is not a LosslessDto. Stringifying as normal JSON.`);
	}

	const newObj: any = Array.isArray(obj) ? [] : {};

	Object.keys(obj).forEach((key) => {
		const value = obj[key];
		const metadata = getMetadata(obj, key);
		if (typeof value === "object" && value !== null) {
			// If the value is an object or array, recurse into it
			newObj[key] = losslessStringify(value, false);
		} else if (metadata.type === MetadataKey.INT64_STRING) {
			// If the property is decorated with @Int64String, convert the string to a LosslessNumber
			debug(`Stringifying int64 string field ${key}`);
			newObj[key] = new LosslessNumber(value);
		} else if (metadata.type === MetadataKey.INT64_BIGINT) {
			// If the property is decorated with @BigIntValue, convert the bigint to a LosslessNumber
			debug(`Stringifying bigint field ${key}`);
			newObj[key] = new LosslessNumber(value.toString());
		} else {
			newObj[key] = value;
		}
	});

	return isTopLevel ? (stringify(newObj) as string) : newObj;
}

/**
 * Create an instance of a DTO class with the provided data.
 *
 * This provides a type-safe method to create a DTO instance from a plain object.
 *
 * Node 22's experimental strip types does not play well with the previous "via the constructor" method.
 *
 * See: https://gist.github.com/jwulf/6e7b093b5b7b3e12c7b76f55b9e4be84
 *
 * @param dtoClass
 * @param dtoData
 * @returns
 */
export function createDtoInstance<T>(dtoClass: { new (): T }, dtoData: T) {
	const newDto = new dtoClass();
	for (const key in dtoData) {
		newDto[key] = dtoData[key];
	}
	return newDto;
}

export { isLosslessNumber, isSafeNumber, LosslessNumber } from "lossless-json";

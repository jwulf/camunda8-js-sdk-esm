import { expect } from "@std/expect/expect";
import {
	BigIntValue,
	Int64String,
	LosslessDto,
} from "../source/c8-rest/lib/lossless-json.ts";
import { getMetadata } from "../source/c8-rest/lib/tc39-metadata-utils.ts";

Deno.test("Metadata works", () => {
	class InputVariables extends LosslessDto {
		name!: string;
		@Int64String
		key!: string;
		@BigIntValue
		bigInt!: bigint;
	}
	expect(getMetadata(InputVariables, "key").type).toEqual("type:int64");
	const instance = new InputVariables();
	expect(getMetadata(instance, "key").type).toEqual("type:int64");
});

Deno.test("Metadata class", () => {
	class InputVariables extends LosslessDto {
		name!: string;
		@Int64String
		key!: string;
		@BigIntValue
		bigInt!: bigint;
	}

	expect(getMetadata(InputVariables, "key").type).toEqual("type:int64");
	const instance = new InputVariables();
	expect(getMetadata(instance, "key").type).toEqual("type:int64");
});

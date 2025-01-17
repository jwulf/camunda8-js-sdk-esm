import path from "node:path";
import test from "ava";
import { createDtoInstance, LosslessDto } from "@camunda8/lossless-json";
import { TimeoutError } from "ky";
import { CamundaRestClient } from "../../c8-rest/index.js";
import { loadResourcesFromFiles } from "../helpers/_load-resources.js";

let processDefinitionId: string;
let processDefinitionKey: string;
const restClient = new CamundaRestClient();

test.before(async () => {
	const resources = loadResourcesFromFiles([
		path.join(
			".",
			"distribution",
			"test",
			"resources",
			"create-process-rest.bpmn",
		),
	]);
	const response = await restClient.deployResources({ resources });
	({ processDefinitionId, processDefinitionKey } =
		response.processDefinitions[0]);
});

class MyVariableDto extends LosslessDto {
	someNumberField?: number;
}

test("Can create a process from bpmn id", async (t) => {
	const response = await restClient
		.createProcessInstance({
			processDefinitionId,
			variables: {
				someNumberField: 8,
			},
		});

	t.is(response.processDefinitionKey, processDefinitionKey);
});

test("Can create a process from process definition key", async (t) => {
	const response = await restClient
		.createProcessInstance({
			processDefinitionKey,
			variables: {
				someNumberField: 8,
			},
		});
	t.is(response.processDefinitionKey, processDefinitionKey);
});

test("Can create a process with a lossless Dto", async (t) => {
	const response = await restClient
		.createProcessInstance({
			processDefinitionKey,
			variables: createDtoInstance(MyVariableDto, { someNumberField: 8 }),
		});

	t.is(response.processDefinitionKey, processDefinitionKey);
});

test("Can create a process and get the result (with output Dto)", async (t) => {
	const variables = createDtoInstance(MyVariableDto, { someNumberField: 8 });
	const response = await restClient
		.createProcessInstanceWithResult({
			processDefinitionKey,
			variables,
			outputVariablesDto: MyVariableDto,
		});

	t.is(response.processDefinitionKey, processDefinitionKey);
	t.is(response.variables.someNumberField, 8);
});

test("Can create a process and get the result (without output Dto)", async (t) => {
	const response = await restClient
		.createProcessInstanceWithResult({
			processDefinitionKey,
			variables: createDtoInstance(MyVariableDto, { someNumberField: 9 }),
		});
	t.is(response.processDefinitionKey, processDefinitionKey);
	// Without an outputVariablesDto, the response variables will be of type unknown

	t.is((response.variables as any).someNumberField, 9);
});

test("What happens if we time out?", async (t) => {
	const resources = loadResourcesFromFiles([
		path.join(".", "distribution", "test", "resources", "time-out-rest.bpmn"),
	]);
	const response = await restClient.deployResources({
		resources,
	});
	const { processDefinitionId } = response.processDefinitions[0];
	const error = await t.throwsAsync(async () => {
		t.timeout(17_000);
		void await restClient.createProcessInstanceWithResult({
			processDefinitionId,
			variables: createDtoInstance(MyVariableDto, { someNumberField: 9 }),
			requestTimeout: 3000,
		});
		t.fail("Should have thrown");
	});
	t.true(error instanceof TimeoutError);
});

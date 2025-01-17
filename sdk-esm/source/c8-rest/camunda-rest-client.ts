import {
	LosslessDto,
	losslessParse,
	losslessStringify,
} from "./lib/lossless-json.ts";
import type { OAuthInterfaces } from "../oauth/index.ts";
import debug from "debug";
import ky from "ky";
import * as Dto from "../dto/c8-dto.ts";
import { getLogger, type Logger } from "../lib/c8-logger.ts";
import {
	type IsoSdkClientConfiguration,
	isoSdkEnvironmentConfigurator,
	requireConfiguration,
} from "../lib/get-configuration.ts";
import { constructOauthProvider } from "../lib/construct-oauth-provider.ts";
import { createUserAgentString } from "../lib/create-user-agent-string.ts";
import { beforeErrorHook } from "../lib/index.ts";
import {
	CamundaJobWorker,
	type CamundaJobWorkerConfig,
} from "./camunda-job-worker.ts";
import { createSpecializedRestApiJobClass } from "./lib/rest-api-job-class-factory.ts";
import { createSpecializedCreateProcessInstanceResponseClass } from "./lib/rest-api-process-instance-class-factory.ts";
import type { FailJobRequest } from "../dto/c8-dto.ts";

const trace = debug("camunda:zeebe-rest");

const camundaRestApiVersion = "v2";

type CamundaRestClientOptions = {
	configuration?: Partial<IsoSdkClientConfiguration>;
	oAuthProvider?: OAuthInterfaces.IOAuthProvider;
	rest?: typeof ky;
};
class DefaultLosslessDto extends LosslessDto {}
/**
 * The client for the unified Camunda 8 REST API.
 *
 * Logging: to enable debug tracing during development, you can set `DEBUG=camunda:zeebe-rest`.
 *
 * For production, you can pass in an instance of [winston.Logger](https://github.com/winstonjs/winston) to the constructor as `logger`.
 *
 * `CAMUNDA_LOG_LEVEL` in the environment or the constructor options can be used to set the log level to one of 'error', 'warn', 'info', 'http', 'verbose', 'debug', or 'silly'.
 *
 * @since 8.6.0
 */
export class CamundaRestClient {
	public log: Logger;
	private readonly userAgentString: string;
	private readonly oAuthProvider: OAuthInterfaces.IOAuthProvider;
	private readonly rest: typeof ky;
	private readonly tenantId?: string;

	/**
	 * All constructor parameters for configuration are optional. If no configuration is provided, the SDK will use environment variables to configure itself.
	 */
	constructor({
		configuration,
		oAuthProvider,
		rest = ky,
	}: CamundaRestClientOptions = {}) {
		const config = isoSdkEnvironmentConfigurator.mergeConfigWithEnvironment(
			configuration ?? {},
		);
		this.log = getLogger(config);
		this.log.debug(`Using REST API version ${camundaRestApiVersion}`);
		trace("options.config", configuration);
		trace("config", config);
		this.oAuthProvider = oAuthProvider ??
			constructOauthProvider({ config, rest });
		this.userAgentString = createUserAgentString(config);
		this.tenantId = config.CAMUNDA_TENANT_ID;

		const baseUrl = requireConfiguration(
			config.ZEEBE_REST_ADDRESS,
			"ZEEBE_REST_ADDRESS",
		);

		const prefixUrl = `${baseUrl}/${camundaRestApiVersion}`;

		/** The non-iso SDK wrapper needs to use @camunda8/certificates GetCustomCertificateBuffer and put it in CUSTOM_CERT_STRING */
		this.rest = rest.create({
			prefixUrl,
			/* This needs to be lifted to the sdk */
			// https: {
			// 	certificateAuthority: config.CAMUNDA_CUSTOM_CERT_STRING,
			// },
			hooks: {
				beforeError: [beforeErrorHook],
				beforeRequest: [
					/** Add authorization header and set the content-type */
					async (request) => {
						const newHeaders = await this.getHeaders();
						for (const [key, value] of Object.entries(newHeaders)) {
							if (!request.headers.has(key)) {
								request.headers.set(key, value);
							}
						}

						// If the request is not a multipart form, set the content type to JSON
						if (
							!request.headers.get("content-type")?.startsWith(
								"multipart/form-data",
							)
						) {
							request.headers.set("content-type", "application/json");
						}
					},
					/** Log for debugging */
					async (request) => {
						const { body, method } = request;
						const path = request.url;
						const authHeader = request.headers.get("authorization");
						const safeAuthHeader = authHeader
							? {
								authorization: authHeader.slice(0, 15) +
									(authHeader.length > 8 ? "..." : ""),
							}
							: {};
						const safeHeaders = {
							...request.headers,
							...safeAuthHeader,
						};
						trace(`${method} ${path}`);
						trace(body);
						this.log.debug(`${method} ${path}`);
						this.log.trace("body", body);
						this.log.trace("headers", safeHeaders);
					},
					/** Add user-supplied middleware at the end, where they can override auth headers */
					...(config.middleware ?? []),
				],
			},
		});
	}

	/**
	 * Manage the permissions assigned to authorization.
	 *
	 * Documentation: https://docs.camunda.io/docs/apis-tools/camunda-api-rest/specifications/patch-authorization/
	 *
	 * @since 8.6.0
	 */
	public modifyAuthorization(request_: Dto.PatchAuthorizationRequest) {
		const { ownerKey, ...request } = request_;
		return this.rest
			.patch(`authorizations/${ownerKey}`, {
				json: losslessStringify(request),
			})
			.json();
	}

	/**
	 * Broadcast a signal.
	 *
	 * Documentation: https://docs.camunda.io/docs/apis-tools/camunda-api-rest/specifications/broadcast-signal/
	 *
	 * @since 8.6.0
	 */
	public broadcastSignal(request_: Dto.BroadcastSignalRequest) {
		const request = this.addDefaultTenantId(request_);
		return this.rest
			.post("signals/broadcast", {
				json: losslessStringify(request),
				headers: {
					"content-type": "application/json",
				},
				parseJson: (text) => losslessParse(text, Dto.BroadcastSignalResponse),
			})
			.json<Dto.BroadcastSignalResponse>();
	}

	/* Get the topology of the Zeebe cluster. */
	public getTopology() {
		return this.rest.get("topology").json<Dto.TopologyResponse>();
	}

	/**
	 * Complete a user task with the given key. The method either completes the task or throws 400, 404, or 409.
	 *
	 * Documentation: https://docs.camunda.io/docs/apis-tools/zeebe-api-rest/specifications/complete-a-user-task/
	 *
	 * @since 8.6.0
	 */
	public completeUserTask({
		userTaskKey,
		variables = {},
		action = "complete",
	}: {
		userTaskKey: string;
		variables?: Record<string, unknown>;
		action?: string;
	}) {
		return this.rest
			.post(`user-tasks/${userTaskKey}/completion`, {
				json: losslessStringify({
					variables,
					action,
				}),
			})
			.json();
	}

	/**
	 * Assign a user task with the given key to the given assignee.
	 *
	 * Documentation: https://docs.camunda.io/docs/apis-tools/camunda-api-rest/specifications/assign-user-task/
	 *
	 * @since 8.6.0
	 */
	public assignTask({
		userTaskKey,
		assignee,
		allowOverride = true,
		action = "assign",
	}: {
		/** The key of the user task to assign. */
		userTaskKey: string;
		/** The assignee for the user task. The assignee must not be empty or null. */
		assignee: string;
		/** By default, the task is reassigned if it was already assigned. Set this to false to return an error in such cases. The task must then first be unassigned to be assigned again. Use this when you have users picking from group task queues to prevent race conditions. */
		allowOverride?: boolean;
		/** A custom action value that will be accessible from user task events resulting from this endpoint invocation. If not provided, it will default to "assign". */
		action: string;
	}) {
		const request = {
			allowOverride,
			action,
			assignee,
		};
		return this.rest
			.post(`user-tasks/${userTaskKey}/assignment`, {
				json: losslessStringify(request),
			})
			.json();
	}

	/**
	 * Update a user task with the given key.
	 *
	 * Documentation: https://docs.camunda.io/docs/apis-tools/camunda-api-rest/specifications/update-user-task/
	 *
	 * @since 8.6.0
	 */
	public updateTask({
		userTaskKey,
		changeset,
	}: {
		userTaskKey: string;
		changeset: Dto.TaskChangeSet;
	}) {
		return this.rest
			.patch(`user-tasks/${userTaskKey}/update`, {
				json: losslessStringify(changeset),
			})
			.json();
	}

	/**
	 * Remove the assignee of a task with the given key.
	 *
	 * Documentation: https://docs.camunda.io/docs/apis-tools/camunda-api-rest/specifications/unassign-user-task/
	 *
	 * @since 8.6.0
	 */
	public unassignTask({ userTaskKey }: { userTaskKey: string }) {
		return this.rest.delete(`user-tasks/${userTaskKey}/assignee`).json();
	}

	/**
	 * Create a user.
	 *
	 * Documentation: https://docs.camunda.io/docs/apis-tools/camunda-api-rest/specifications/create-user/
	 *
	 * @since 8.6.0
	 */
	public createUser(newUserInfo: Dto.NewUserInfo) {
		return this.rest
			.post("users", {
				json: JSON.stringify(newUserInfo),
			})
			.json();
	}

	/**
	 * Search for user tasks based on given criteria.
	 *
	 * Documentation: https://docs.camunda.io/docs/apis-tools/camunda-api-rest/specifications/query-user-tasks-alpha/
	 * @experimental
	 */
	// public async queryTasks() {}

	/**
	 * Publish a Message and correlates it to a subscription. If correlation is successful it will return the first process instance key the message correlated with.
	 *
	 * Documentation: https://docs.camunda.io/docs/apis-tools/camunda-api-rest/specifications/correlate-a-message/
	 *
	 * @since 8.6.0
	 */
	public correlateMessage(
		message: Pick<
			Dto.PublishMessageRequest,
			"name" | "correlationKey" | "variables" | "tenantId"
		>,
	) {
		const request = this.addDefaultTenantId(message);
		const json = losslessStringify(request);
		return this.rest
			.post("messages/correlation", {
				json,
				parseJson: (text) => losslessParse(text, Dto.CorrelateMessageResponse),
			})
			.json<Dto.CorrelateMessageResponse>();
	}

	/**
	 * Publish a single message. Messages are published to specific partitions computed from their correlation keys. This method does not wait for a correlation result. Use `correlateMessage` for such use cases.
	 *
	 * Documentation: https://docs.camunda.io/docs/apis-tools/camunda-api-rest/specifications/publish-a-message/
	 *
	 * @since 8.6.0
	 */
	public publishMessage(
		publishMessageRequest: Dto.PublishMessageRequest,
	) {
		const request = this.addDefaultTenantId(publishMessageRequest);
		const json = losslessStringify(request);
		return this.rest
			.post("messages/publication", {
				json,
				parseJson: (text) => losslessParse(text, Dto.PublishMessageResponse),
			})
			.json<Dto.PublishMessageResponse>();
	}

	/**
	 * Obtains the status of the current Camunda license.
	 *
	 * Documentation: https://docs.camunda.io/docs/apis-tools/camunda-api-rest/specifications/get-status-of-camunda-license/
	 *
	 * @since 8.6.0
	 */
	public getLicenseStatus(): Promise<{
		vaildLicense: boolean;
		licenseType: string;
	}> {
		return this.rest.get("license").json();
	}

	/**
	 * Create a new polling Job Worker.
	 * You can pass in an optional winston.Logger instance as `logger`. This enables you to have distinct logging levels for different workers.
	 *
	 * @since 8.6.0
	 */
	public createJobWorker<
		Variables extends LosslessDto,
		CustomHeaders extends LosslessDto,
	>(config: CamundaJobWorkerConfig<Variables, CustomHeaders>) {
		const worker = new CamundaJobWorker(config, this);
		// Worker.start()
		return worker;
	}

	/**
	 * Iterate through all known partitions and activate jobs up to the requested maximum.
	 *
	 * The parameter `inputVariablesDto` is a Dto to decode the job payload. The `customHeadersDto` parameter is a Dto to decode the custom headers.
	 * Pass in a Dto class that extends LosslessDto to provide both type information in your code,
	 * and safe interoperability with applications that use the `int64` type in variables.
	 *
	 * @since 8.6.0
	 */
	public activateJobs<
		VariablesDto extends LosslessDto,
		CustomHeadersDto extends LosslessDto,
	>(
		request: Dto.ActivateJobsRequest & {
			inputVariableDto?: Dto.Ctor<VariablesDto>;
			customHeadersDto?: Dto.Ctor<CustomHeadersDto>;
		},
	): Promise<
		Array<
			& Dto.Job<VariablesDto, CustomHeadersDto>
			& Dto.JobCompletionInterfaceRest<Dto.ProcessVariables>
		>
	> {
		const {
			inputVariableDto = LosslessDto,
			customHeadersDto = LosslessDto,
			tenantIds = this.tenantId ? [this.tenantId] : undefined,
			...request_
		} = request;

		/**
		 * The ActivateJobs endpoint can take multiple tenantIds, and activate jobs for multiple tenants at once.
		 */
		const json = losslessStringify({
			...request_,
			tenantIds,
		});

		const jobDto = createSpecializedRestApiJobClass(
			inputVariableDto,
			customHeadersDto,
		);

		return this.rest
			.post("jobs/activation", {
				json,
				parseJson: (text) => losslessParse(text, jobDto, "jobs"),
			})
			.json<Array<Dto.Job<VariablesDto, CustomHeadersDto>>>()
			.then((activatedJobs) =>
				activatedJobs.map((job) => this.addJobMethods(job))
			);
	}

	/**
	 * Fails a job using the provided job key. This method sends a POST request to the endpoint '/jobs/{jobKey}/fail' with the failure reason and other details specified in the failJobRequest object.
	 *
	 * Documentation: https://docs.camunda.io/docs/next/apis-tools/camunda-api-rest/specifications/fail-job/
	 *
	 * @since 8.6.0
	 */
	public failJob(failJobRequest: Dto.FailJobRequest) {
		const { jobKey } = failJobRequest;
		return this.rest
			.post(`jobs/${jobKey}/failure`, {
				json: losslessStringify(failJobRequest),
			})
			.then(() =>
				Dto.jobActionAcknowledgement as Dto.JobActionAcknowledgementType
			);
	}

	/**
	 * Report a business error (i.e. non-technical) that occurs while processing a job.
	 *
	 * Documentation: https://docs.camunda.io/docs/next/apis-tools/camunda-api-rest/specifications/report-error-for-job/
	 *
	 * @since 8.6.0
	 */
	public errorJob(
		errorJobRequest: Dto.ErrorJobWithVariables & { jobKey: string },
	) {
		const { jobKey, ...request } = errorJobRequest;
		return this.rest
			.post(`jobs/${jobKey}/error`, {
				json: losslessStringify(request),
				parseJson: (text) => losslessParse(text),
			})
			.then(() =>
				Dto.jobActionAcknowledgement as Dto.JobActionAcknowledgementType
			);
	}

	/**
	 * Complete a job with the given payload, which allows completing the associated service task.
	 *
	 * Documentation: https://docs.camunda.io/docs/next/apis-tools/camunda-api-rest/specifications/complete-job/
	 *
	 * @since 8.6.0
	 */
	public completeJob(completeJobRequest: Dto.CompleteJobRequest) {
		const { jobKey } = completeJobRequest;
		const request = { variables: completeJobRequest.variables };
		return this.rest
			.post(`jobs/${jobKey}/completion`, {
				json: losslessStringify(request),
			})
			.then(() =>
				Dto.jobActionAcknowledgement as Dto.JobActionAcknowledgementType
			);
	}

	/**
	 * Update a job with the given key.
	 *
	 * Documentation: https://docs.camunda.io/docs/apis-tools/camunda-api-rest/specifications/update-a-job/
	 *
	 * @since 8.6.0
	 */
	public updateJob(
		jobChangeset: Dto.JobUpdateChangeset & { jobKey: string },
	) {
		const { jobKey, ...changeset } = jobChangeset;
		return this.rest.patch(`jobs/${jobKey}`, {
			json: JSON.stringify(changeset),
		});
	}

	/**
	 * Marks the incident as resolved; most likely a call to Update job will be necessary to reset the job's retries, followed by this call.
	 *
	 * Documentation: https://docs.camunda.io/docs/apis-tools/camunda-api-rest/specifications/resolve-incident/
	 *
	 * @since 8.6.0
	 */
	public resolveIncident(incidentKey: string) {
		return this.rest.post(`incidents/${incidentKey}/resolution`);
	}

	/**
	 * Create and start a process instance. This method does not await the outcome of the process. For that, use `createProcessInstanceWithResult`.
	 *
	 * Documentation: https://docs.camunda.io/docs/apis-tools/camunda-api-rest/specifications/create-process-instance/
	 *
	 * @since 8.6.0
	 */
	public async createProcessInstance<T extends Dto.JsonDocument | LosslessDto>(
		request: Dto.CreateProcessInstanceRequest<T>,
	): Promise<Dto.CreateProcessInstanceResponse<never>>;

	public createProcessInstance<
		T extends Dto.JsonDocument | LosslessDto,
		V extends LosslessDto,
	>(
		request: Dto.CreateProcessInstanceRequest<T> & {
			outputVariablesDto?: Dto.Ctor<V>;
		},
	) {
		const outputVariablesDto: Dto.Ctor<V> | Dto.Ctor<LosslessDto> =
			request.outputVariablesDto ?? DefaultLosslessDto;

		const createProcessInstanceResponseWithVariablesDto =
			createSpecializedCreateProcessInstanceResponseClass(outputVariablesDto);

		return this.rest
			.post("process-instances", {
				json: losslessStringify(this.addDefaultTenantId(request)),
				parseJson: (text) =>
					losslessParse(text, createProcessInstanceResponseWithVariablesDto),
			})
			.json<
				InstanceType<typeof createProcessInstanceResponseWithVariablesDto>
			>();
	}

	/**
	 * Create and start a process instance. This method awaits the outcome of the process.
	 *
	 * Documentation: https://docs.camunda.io/docs/apis-tools/camunda-api-rest/specifications/create-process-instance/
	 *
	 * @throws {TimeoutError} Ky.TimeoutError if the process instance does not complete within the timeout.
	 * @since 8.6.0
	 */
	public async createProcessInstanceWithResult<
		T extends Dto.JsonDocument | LosslessDto,
	>(
		request: Dto.CreateProcessInstanceRequest<T> & {
			/** An array of variable names to fetch. If not supplied, all visible variables in the root scope will be returned  */
			fetchVariables?: string[];
		},
	): Promise<Dto.CreateProcessInstanceResponse<unknown>>;

	public async createProcessInstanceWithResult<
		T extends Dto.JsonDocument | LosslessDto,
		V extends LosslessDto,
	>(
		request: Dto.CreateProcessInstanceRequest<T> & {
			/** An array of variable names to fetch. If not supplied, all visible variables in the root scope will be returned  */
			fetchVariables?: string[];
			/** A Dto specifying the shape of the output variables. If not supplied, the output variables will be returned as a `LosslessDto` of type `unknown`. */
			outputVariablesDto: Dto.Ctor<V>;
		},
	): Promise<Dto.CreateProcessInstanceResponse<V>>;
	public createProcessInstanceWithResult<
		T extends Dto.JsonDocument | LosslessDto,
		V,
	>(
		request: Dto.CreateProcessInstanceRequest<T> & {
			outputVariablesDto?: Dto.Ctor<V>;
		},
	) {
		/**
		 * We override the type system to make `awaitCompletion` hidden from end-users. This has been done because supporting the permutations of
		 * creating a process with/without awaiting the result and with/without an outputVariableDto in a single method is complex. I could not get all
		 * the cases to work with intellisense for the end-user using either generics or with signature overloads.
		 *
		 * To address this, createProcessInstance has all the functionality, but hides the `awaitCompletion` attribute from the signature. This method
		 * is a wrapper around createProcessInstance that sets `awaitCompletion` to true, and explicitly informs the type system via signature overloads.
		 *
		 * This is not ideal, but it is the best solution I could come up with.
		 */
		return this.createProcessInstance({
			...request,
			awaitCompletion: true,
			outputVariablesDto: request.outputVariablesDto,
		} as unknown as Dto.CreateProcessInstanceRequest<T>);
	}

	/**
	 * Cancel an active process instance
	 */
	public cancelProcessInstance({
		processInstanceKey,
		operationReference,
	}: {
		processInstanceKey: string;
		operationReference?: number;
	}) {
		const json = operationReference
			? JSON.stringify({ operationReference })
			: undefined;

		return this.rest.post(
			`process-instances/${processInstanceKey}/cancellation`,
			{
				json,
			},
		);
	}

	/**
	 * Migrates a process instance to a new process definition.
	 * This request can contain multiple mapping instructions to define mapping between the active process instance's elements and target process definition elements.
	 * Use this to upgrade a process instance to a new version of a process or to a different process definition, e.g. to keep your running instances up-to-date with the latest process improvements.
	 *
	 * Documentation: https://docs.camunda.io/docs/next/apis-tools/camunda-api-rest/specifications/migrate-process-instance/
	 *
	 * @since 8.6.0
	 */
	public migrateProcessInstance(request_: Dto.MigrationRequest) {
		const { processInstanceKey, ...request } = request_;
		this.log.debug(`Migrating process instance ${processInstanceKey}`, {
			component: "C8RestClient",
		});
		return this.rest.post(`process-instances/${processInstanceKey}/migration`, {
			json: losslessStringify(request),
		});
	}

	/**
	 * Deploy resources to the broker.
	 * @param resources - An array of binary data strings representing the resources to deploy.
	 * @param tenantId - Optional tenant ID to deploy the resources to. If not provided, the default tenant ID is used.
	 *
	 * Documentation: https://docs.camunda.io/docs/apis-tools/camunda-api-rest/specifications/deploy-resources/
	 *
	 * @since 8.6.0
	 */
	public async deployResources({
		resources,
		tenantId,
	}: {
		resources: Array<{ content: string; name: string }>;
		tenantId?: string;
	}) {
		const formData = new FormData();

		for (const resource of resources) {
			formData.append(
				"resources",
				new Blob([resource.content], { type: "text/plain" }),
				resource.name,
			);
		}

		if (tenantId ?? this.tenantId) {
			formData.append("tenantId", tenantId ?? this.tenantId!);
		}

		this.log.debug(`Deploying ${resources.length} resources`);
		const response = await this.rest
			.post("deployments", {
				json: formData,
				headers: {
					accept: "application/json",
				},
				parseJson: (text) => losslessParse(text), // We parse the response with LosslessNumbers, with no Dto
			})
			.json<Dto.DeployResourceResponseDto>();

		/**
		 * Now we need to examine the response and parse the deployments to lossless Dtos
		 * We dynamically construct the response object for the caller, by examining the lossless response
		 * and re-parsing each of the deployments with the correct Dto.
		 */
		this.log.debug(`Deployment response: ${JSON.stringify(response)}`);

		const deploymentResponse: Dto.DeployResourceResponse = {} as Dto.DeployResourceResponse;
		deploymentResponse.deploymentKey = response.deploymentKey.toString();
		deploymentResponse.tenantId = response.tenantId;
		deploymentResponse.deployments = [];
		deploymentResponse.processDefinitions = [];
		deploymentResponse.decisions = [];
		deploymentResponse.decisionRequirements = [];
		deploymentResponse.forms = [];

		/**
		 * Type-guard assertions to correctly type the deployments. The API returns an array with mixed types.
		 */
		const isProcessDeployment = (
			deployment: unknown,
		): deployment is { processDefinition: Dto.ProcessDeployment } =>
			// deno-lint-ignore no-explicit-any
			Boolean((deployment as any).processDefinition);
		const isDecisionDeployment = (
			deployment: unknown,
		): deployment is { decision: Dto.DecisionDeployment } =>
			// deno-lint-ignore no-explicit-any
			Boolean((deployment as any).decision);
		const isDecisionRequirementsDeployment = (
			deployment: unknown,
		): deployment is {
			decisionRequirements: Dto.DecisionRequirementsDeployment;
			// deno-lint-ignore no-explicit-any
		} => Boolean((deployment as any).decisionRequirements);
		const isFormDeployment = (
			deployment: unknown,
		): deployment is { form: Dto.FormDeployment } =>
			// deno-lint-ignore no-explicit-any
			Boolean((deployment as any).form);

		/**
		 * Here we examine each of the deployments returned from the API, and create a correctly typed
		 * object for each one. We also populate subkeys per type. This allows SDK users to work with
		 * types known ahead of time.
		 */
		for (const deployment of response.deployments) {
			if (isProcessDeployment(deployment)) {
				const processDeployment = losslessParse(
					losslessStringify(deployment.processDefinition),
					Dto.ProcessDeployment,
				);
				deploymentResponse.deployments.push({
					processDefinition: processDeployment,
				});
				deploymentResponse.processDefinitions.push(processDeployment);
			}

			if (isDecisionDeployment(deployment)) {
				const decisionDeployment = losslessParse(
					losslessStringify(deployment),
					Dto.DecisionDeployment,
				);
				deploymentResponse.deployments.push({ decision: decisionDeployment });
				deploymentResponse.decisions.push(decisionDeployment);
			}

			if (isDecisionRequirementsDeployment(deployment)) {
				const decisionRequirementsDeployment = losslessParse(
					losslessStringify(deployment),
					Dto.DecisionRequirementsDeployment,
				);
				deploymentResponse.deployments.push({
					decisionRequirements: decisionRequirementsDeployment,
				});
				deploymentResponse.decisionRequirements.push(
					decisionRequirementsDeployment,
				);
			}

			if (isFormDeployment(deployment)) {
				const formDeployment = losslessParse(
					losslessStringify(deployment),
					Dto.FormDeployment,
				);
				deploymentResponse.deployments.push({ form: formDeployment });
				deploymentResponse.forms.push(formDeployment);
			}
		}

		return deploymentResponse;
	}

	/**
	 * Deletes a deployed resource. This can be a process definition, decision requirements definition, or form definition deployed using the deploy resources endpoint. Specify the resource you want to delete in the resourceKey parameter.
	 *
	 * Documentation: https://docs.camunda.io/docs/apis-tools/camunda-api-rest/specifications/delete-resource/
	 *
	 * @since 8.6.0
	 */
	public deleteResource(request: {
		resourceKey: string;
		operationReference?: number;
	}) {
		const { resourceKey, operationReference } = request;
		return this.rest.post(`resources/${resourceKey}/deletion`, {
			json: losslessStringify({ operationReference }),
		});
	}

	/**
	 * Set a precise, static time for the Zeebe engine's internal clock.
	 * When the clock is pinned, it remains at the specified time and does not advance.
	 * To change the time, the clock must be pinned again with a new timestamp, or reset.
	 *
	 * Documentation: https://docs.camunda.io/docs/apis-tools/camunda-api-rest/specifications/pin-internal-clock/
	 *
	 * @since 8.6.0
	 */
	public pinInternalClock(epochMs: number) {
		return this.rest.put("clock", {
			json: JSON.stringify({ timestamp: epochMs }),
		});
	}

	/**
	 * Resets the Zeebe engine's internal clock to the current system time, enabling it to tick in real-time.
	 * This operation is useful for returning the clock to normal behavior after it has been pinned to a specific time.
	 *
	 * Documentation: https://docs.camunda.io/docs/apis-tools/camunda-api-rest/specifications/reset-internal-clock/
	 *
	 * @since 8.6.0
	 */
	public resetClock() {
		return this.rest.post("clock/reset");
	}

	/**
	 * Updates all the variables of a particular scope (for example, process instance, flow element instance) with the given variable data.
	 * Specify the element instance in the elementInstanceKey parameter.
	 *
	 * Documentation: https://docs.camunda.io/docs/apis-tools/camunda-api-rest/specifications/update-element-instance-variables/
	 *
	 * @since 8.6.0
	 */
	public updateElementInstanceVariables(
		request_: Dto.UpdateElementVariableRequest,
	) {
		const { elementInstanceKey, ...request } = request_;
		return this.rest.post(`element-instances/${elementInstanceKey}/variables`, {
			json: losslessStringify(request),
		});
	}

	private readonly addJobMethods = <Variables, CustomHeaders>(
		job: Dto.Job<Variables, CustomHeaders>,
	):
		& Dto.Job<Variables, CustomHeaders>
		& Dto.JobCompletionInterfaceRest<Dto.ProcessVariables> => ({
			...job,
			cancelWorkflow() {
				throw new Error("Not Implemented");
			},
			complete: (variables: Dto.ProcessVariables = {}) =>
				this.completeJob({
					jobKey: job.jobKey,
					variables,
				}),
			error: (error) =>
				this.errorJob({
					...error,
					jobKey: job.jobKey,
				}),
			fail: (failJobRequest: FailJobRequest) =>
				this.failJob({
					retries: job.retries - 1,
					retryBackOff: 0,
					...failJobRequest,
					jobKey: job.jobKey,
				}),
			/* This has an effect in a Job Worker, decrementing the currently active job count */
			forward: () => Dto.jobActionAcknowledgement,
			modifyJobTimeout: ({ newTimeoutMs }: { newTimeoutMs: number }) =>
				this.updateJob({ jobKey: job.jobKey, timeout: newTimeoutMs }),
		});

	/**
	 * Helper method to add the default tenantIds if we are not passed explicit tenantIds
	 */
	private addDefaultTenantId<T extends { tenantId?: string }>(request: T) {
		const tenantId = request.tenantId ?? this.tenantId;
		return { ...request, tenantId };
	}

	/**
	 * This is called in the got hooks.beforeRequest hook.
	 */
	private async getHeaders() {
		const token = await this.oAuthProvider.getToken("ZEEBE");

		const headers = {
			authorization: `Bearer ${token}`,
			"user-agent": this.userAgentString,
		};
		return headers;
	}
}

// deno-lint-ignore-file no-explicit-any
/* eslint-disable @typescript-eslint/member-ordering */
import {
	Int64String,
	LosslessDto,
	type LosslessNumber,
} from "../c8-rest/lib/lossless-json.ts";
import type { KyResponse } from "ky";

export type JsonValue =
	| string
	| number
	| boolean
	| JsonDocument
	| JsonArray
	| undefined;

// eslint-disable-next-line @typescript-eslint/consistent-indexed-object-style
export type JsonDocument = {
	[key: string]: JsonValue;
};

export type JsonArray = Record<string, unknown> & JsonValue[];

/**
 * This is the decoder class for the Activated Job.
 * It is extended at runtime to add user-typed custom headers and variables in the RestApiJobClassFactory.
 * The interface `Job` describes that shape for consumers.
 */
export class RestApiJob<
	Variables = LosslessDto,
	CustomHeaders = LosslessDto,
> extends LosslessDto {
	@Int64String
	key!: string;

	type!: string;
	@Int64String
	processInstanceKey!: string;

	processDefinitionId!: string;
	processDefinitionVersion!: number;
	@Int64String
	processDefinitionKey!: string;

	elementId!: string;
	@Int64String
	elementInstanceKey!: string;

	customHeaders!: CustomHeaders;
	worker!: string;
	retries!: number;
	@Int64String
	deadline!: string;

	variables!: Variables;
	tenantId!: string;
}

/**
 * JSON object with changed task attribute values.
 */
export type TaskChangeSet = {
	/* The due date of the task. Reset by providing an empty String. */
	dueDate?: Date | string;
	/* The follow-up date of the task. Reset by providing an empty String. */
	followUpDate?: Date | string;
	/* The list of candidate users of the task. Reset by providing an empty list. */
	candidateUsers?: string[];
	/* The list of candidate groups of the task. Reset by providing an empty list. */
	candidateGroups?: string[];
};

/** JSON object with changed job attribute values. */
export type JobUpdateChangeset = {
	/* The new amount of retries for the job; must be a positive number. */
	retries?: number;
	/**  The duration of the new timeout in ms, starting from the current moment. */
	timeout?: number;
};

export type NewUserInfo = {
	password: string;
	id: number;
	username: string;
	name: string;
	email: string;
	enabled: boolean;
};

export type Ctor<T> = new (object?: any) => T;

export class ProcessDeployment extends LosslessDto {
	processDefinitionId!: string;
	version!: number;
	@Int64String
	processDefinitionKey!: string;

	resourceName!: string;
	tenantId!: string;
}

export class DecisionDeployment extends LosslessDto {
	dmnDecisionId!: string;
	version!: number;
	@Int64String
	decisionKey!: string;

	dmnDecisionName!: string;
	tenantId!: string;
	dmnDecisionRequirementsId!: string;
	@Int64String
	dmnDecisionRequirementsKey!: string;
}

export class DecisionRequirementsDeployment extends LosslessDto {
	dmnDecisionRequirementsId!: string;
	version!: number;
	dmnDecisionRequirementsName!: string;
	tenantId!: string;
	@Int64String
	dmnDecisionRequirementsKey!: string;

	resourceName!: string;
}
export class FormDeployment {
	formId!: string;
	version!: number;
	@Int64String
	formKey!: string;

	resourceName!: string;
	tenantId!: string;
}

export class DeployResourceResponseDto extends LosslessDto {
	@Int64String
	deploymentKey!: string;

	deployments!: Array<
		| { processDefinition: ProcessDeployment }
		| { decision: DecisionDeployment }
		| { decisionRequirements: DecisionRequirementsDeployment }
		| { form: FormDeployment }
	>;

	tenantId!: string;
}

export class DeployResourceResponse extends DeployResourceResponseDto {
	processDefinitions!: ProcessDeployment[];
	decisions!: DecisionDeployment[];
	decisionRequirements!: DecisionRequirementsDeployment[];
	forms!: FormDeployment[];
}

export class CreateProcessInstanceResponse<T = Record<string, never>> {
	/**
	 * The unique key identifying the process definition (e.g. returned from a process
	 * in the DeployResourceResponse message)
	 */
	@Int64String
	readonly processDefinitionKey!: string;

	/**
	 * The BPMN process ID of the process definition
	 */
	readonly bpmnProcessId!: string;
	/**
	 * The version of the process; set to -1 to use the latest version
	 */
	readonly version!: number;
	@Int64String
	readonly processInstanceKey!: string;

	/**
	 * The tenant identifier of the created process instance
	 */
	readonly tenantId!: string;
	/**
	 * If `awaitCompletion` is true, this will be populated with the output variables. Otherwise, it will be an empty object.
	 */
	readonly variables!: T;
}

export type MigrationMappingInstruction = {
	/** The element ID to migrate from. */
	sourceElementId: string;
	/** The element ID to migrate into. */
	targetElementId: string;
};

/** Migrates a process instance to a new process definition.
 * This request can contain multiple mapping instructions to define mapping between the active process instance's elements and target process definition elements.
 */
export type MigrationRequest = {
	processInstanceKey: string;
	/** The key of process definition to migrate the process instance to. */
	targetProcessDefinitionKey: string;
	mappingInstructions: MigrationMappingInstruction[];
	/** A reference key chosen by the user that will be part of all records resulting from this operation. Must be > 0 if provided. */
	operationReference?: number | LosslessNumber;
};

/** The signal was broadcast. */
export class BroadcastSignalResponse extends LosslessDto {
	@Int64String
	/** The unique ID of the signal that was broadcast. */
	signalKey!: string;

	/** The tenant ID of the signal that was broadcast. */
	tenantId!: string;
}

export type UpdateElementVariableRequest = {
	/**
	 * The key of the element instance to update the variables for.
	 * This can be the process instance key (as obtained during instance creation), or a given element,
	 * such as a service task (see the elementInstanceKey on the job message). */
	elementInstanceKey: string;
	variables: JsonDocument | LosslessDto;
	/**
	 * Defaults to false.
	 * If set to true, the variables are merged strictly into the local scope (as specified by the elementInstanceKey). Otherwise, the variables are propagated to upper scopes and set at the outermost one.
	 * Let's consider the following example:
	 * There are two scopes '1' and '2'. Scope '1' is the parent scope of '2'. The effective variables of the scopes are: 1 => { "foo" : 2 } 2 => { "bar" : 1 }
	 * An update request with elementInstanceKey as '2', variables { "foo" : 5 }, and local set to true leaves scope '1' unchanged and adjusts scope '2' to { "bar" : 1, "foo" 5 }.
	 * By default, with local set to false, scope '1' will be { "foo": 5 } and scope '2' will be { "bar" : 1 }.
	 */
	local?: boolean;
	/**
	 * A reference key chosen by the user that will be part of all records resulting from this operation.
	 * Must be > 0 if provided.
	 */
	operationReference?: number;
};

export class CorrelateMessageResponse extends LosslessDto {
	/** The unique ID of the message that was published */
	@Int64String
	key!: string;

	/** The tenantId of the message */
	tenantId!: string;
	/** The key of the first process instance the message correlated with */
	@Int64String
	processInstanceKey!: string;
}

export class PublishMessageResponse extends LosslessDto {
	/** The unique ID of the message that was published */
	@Int64String
	key!: string;

	/** The tenantId of the message */
	tenantId!: string;
}

export type CreateProcessBaseRequest<V extends JsonDocument | LosslessDto> = {
	/**
	 * The version of the process; if not specified it will use the latest version
	 */
	version?: number;
	/**
	 * JSON document that will instantiate the variables for the root variable scope of the
	 * process instance.
	 */
	variables: V;
	/** The tenantId for a multi-tenant enabled cluster. */
	tenantId?: string;
	/** A reference key chosen by the user and will be part of all records resulted from this operation */
	operationReference?: number | LosslessNumber;
	/**
	 * List of start instructions. If empty (default) the process instance
	 * will start at the start event. If non-empty the process instance will apply start
	 * instructions after it has been created
	 */
	startInstructions?: ProcessInstanceCreationStartInstruction[];
	/**
	 * Wait for the process instance to complete. If the process instance completion does not occur within the requestTimeout, the request will be closed. Defaults to false.
	 */
	// This is commented out, because we used specialised methods for the two cases.
	// awaitCompletion?: boolean
	/**
	 * Timeout (in ms) the request waits for the process to complete. By default or when set to 0, the generic request timeout configured in the cluster is applied.
	 */
	requestTimeout?: number;
};

export type ProcessInstanceCreationStartInstruction = {
	/**
	 * Future extensions might include
	 * - different types of start instructions
	 * - ability to set local variables for different flow scopes
	 * for now, however, the start instruction is implicitly a
	 * "startBeforeElement" instruction
	 */
	elementId: string;
};

export type CreateProcessInstanceFromProcessDefinitionId<
	V extends JsonDocument | LosslessDto,
> = {
	/**
	 * The BPMN process ID of the process definition
	 */
	processDefinitionId: string;
} & CreateProcessBaseRequest<V>;

export type CreateProcessInstanceFromProcessDefinition<
	V extends JsonDocument | LosslessDto,
> = {
	/**
	 * The key of the process definition
	 */
	processDefinitionKey: string;
} & CreateProcessBaseRequest<V>;

export type CreateProcessInstanceRequest<T extends JsonDocument | LosslessDto> =
	| CreateProcessInstanceFromProcessDefinitionId<T>
	| CreateProcessInstanceFromProcessDefinition<T>;

export type PatchAuthorizationRequest = {
	/** The key of the owner of the authorization. */
	ownerKey: string;
	/** Indicates if permissions should be added or removed. */
	action: "ADD" | "REMOVE";
	/** The type of resource to add/remove perissions to/from. */
	resourceType:
		| "AUTHORIZATION"
		| "MESSAGE"
		| "JOB"
		| "APPLICATION"
		| "TENANT"
		| "DEPLOYMENT"
		| "PROCESS_DEFINITION"
		| "USER_TASK"
		| "DECISION_REQUIREMENTS_DEFINITION"
		| "DECISION_DEFINITION"
		| "USER_GROUP"
		| "USER"
		| "ROLE";
	/** The permissions to add/remove. */
	permissions: Array<{
		/** Specifies the type of permissions. */
		permissionType: "CREATE" | "READ" | "UPDATE" | "DELETE";
		/** A list of resource IDs the permission relates to. */
		resourceIds: string[];
	}>;
};

/**
 * Request object to send the broker to request jobs for the worker.
 */
export type ActivateJobsRequest = {
	/**
	 * The job type, as defined in the BPMN process (e.g. <zeebe:taskDefinition
	 * type="payment-service" />)
	 */
	type: string;
	/** The name of the worker activating the jobs, mostly used for logging purposes */
	worker: string;
	/**
	 * Millisecond value. The duration the broker allows for jobs activated by this call to complete
	 * before timing them out releasing them for retry on the broker.
	 */
	timeout: number;
	/**
	 * The maximum jobs to activate by this request
	 */
	maxJobsToActivate: number;
	/**
	 * A list of variables to fetch as the job variables; if empty, all visible variables at
	 * the time of activation for the scope of the job will be returned
	 */
	fetchVariable?: string[];
	/**
	 * Millisecond value. The request will be completed when atleast one job is activated or after the requestTimeout.
	 * if the requestTimeout = 0, the request will be completed after a default configured timeout in the broker.
	 * To immediately complete the request when no job is activated set the requestTimeout to a negative value
	 */
	requestTimeout?: number;
	/**
	 * A list of IDs of tenants for which to activate jobs
	 */
	tenantIds?: string[];
};

export type ProcessVariables = Record<string, JsonValue>;

export type JobCompletionInterfaceRest<WorkerOutputVariables> = {
	/**
	 * Cancel the workflow.
	 */
	cancelWorkflow: () => Promise<JobActionAcknowledgementType>;
	/**
	 * Complete the job with a success, optionally passing in a state update to merge
	 * with the process variables on the broker.
	 */
	complete: (
		updatedVariables?: WorkerOutputVariables,
	) => Promise<JobActionAcknowledgementType>;
	/**
	 * Fail the job with an informative message as to the cause. Optionally, pass in a
	 * value remaining retries. If no value is passed for retries then the current retry
	 * count is decremented. Pass in `0`for retries to raise an incident in Operate. Optionally,
	 * specify a retry backoff period in milliseconds. Default is 0ms (immediate retry) if not
	 * specified.
	 */
	fail: typeof failureHandler;
	/**
	 * Mark this job as forwarded to another system for completion. No action is taken by the broker.
	 * This method releases worker capacity to handle another job.
	 */
	forward: () => JobActionAcknowledgementType;
	/**
	 * Report a business error (i.e. non-technical) that occurs while processing a job.
	 * The error is handled in the process by an error catch event.
	 * If there is no error catch event with the specified errorCode then an incident will be raised instead.
	 */
	error: (
		error: ErrorJobWithVariables,
	) => Promise<JobActionAcknowledgementType>;
	/**
	 * Extend the timeout for the job by setting a new timeout
	 */
	modifyJobTimeout: ({
		newTimeoutMs,
	}: {
		newTimeoutMs: number;
	}) => Promise<KyResponse>;
};

export const jobActionAcknowledgement = "JOB_ACTION_ACKNOWLEDGEMENT";
export type JobActionAcknowledgementType = typeof jobActionAcknowledgement;
export type MustReturnJobActionAcknowledgement =
	| JobActionAcknowledgementType
	| Promise<JobActionAcknowledgementType>;

export type ErrorJobWithVariables = {
	variables: JsonDocument;
	errorCode: string;
	errorMessage?: string;
};

declare function failureHandler(
	failureConfiguration: JobFailureConfiguration,
): Promise<JobActionAcknowledgementType>;

export type JobFailureConfiguration = {
	errorMessage: string;
	/**
	 * If not specified, the library will decrement the "current remaining retries" count by one
	 */
	retries?: number;
	/**
	 * Optional backoff for subsequent retries, in milliseconds. If not specified, it is zero.
	 */
	retryBackOff?: number;
	/**
	 * Optional variable update for the job
	 */
	variables?: JsonDocument;
};

export type CustomHeaders = Record<string, string | number>;

export type InputVariables = Record<
	string,
	string | number | boolean | JsonDocument
>;

export type Job<
	Variables = InputVariables,
	CustomHeaderShape = CustomHeaders,
> = {
	/** The key, a unique identifier for the job */
	readonly jobKey: string;
	/**
	 * The job type, as defined in the BPMN process (e.g. <zeebe:taskDefinition
	 * type="payment-service" />)
	 */
	readonly type: string;
	/** The job's process instance key */
	readonly processInstanceKey: string;
	/** The bpmn process ID of the job process definition */
	readonly processDefinitionId: string;
	/** The version of the job process definition */
	readonly processDefinitionVersion: number;
	/** The associated task element ID */
	readonly elementId: string;
	/**
	 * The unique key identifying the associated task, unique within the scope of the
	 * process instance
	 */
	readonly elementInstanceKey: string;
	/**
	 * A set of custom headers defined during modelling
	 */
	readonly customHeaders: Readonly<CustomHeaderShape>;
	/** The name of the worker that activated this job */
	readonly worker: string;
	/* The amount of retries left to this job (should always be positive) */
	readonly retries: number;
	/** Epoch milliseconds */
	readonly deadline: string;
	/**
	 * All visible variables in the task scope, computed at activation time.
	 */
	readonly variables: Readonly<Variables>;
	/**
	 * The `tenantId` of the job in a multi-tenant cluster
	 */
	readonly tenantId: string;
};

export type BroadcastSignalRequest = {
	/** The name of the signal */
	signalName: string;

	/**
	 * The signal variables as a JSON document; to be valid, the root of the document must be an object, e.g. { "a": "foo" }. [ "foo" ] would not be valid.
	 */
	variables?: JsonDocument;

	/** Optional `tenantId` for a multi-tenant enabled cluster. This could also be supplied via environment variable. */
	tenantId?: string;
};

export type CompleteJobRequest<Variables = ProcessVariables> = {
	readonly jobKey: string;
	variables: Variables;
};

export type FailJobRequest = {
	readonly jobKey: string;
	retries?: number;
	errorMessage: string;
	retryBackOff?: number;
	variables?: JsonDocument;
};

export type PublishMessageRequest<Variables = InputVariables> = {
	/** Should match the "Message Name" in a BPMN Message Catch  */
	name: string;
	/** The value to match with the field specified as "Subscription Correlation Key" in BPMN */
	correlationKey: string;
	/** The number of seconds for the message to buffer on the broker, awaiting correlation. Omit or set to zero for no buffering. */
	timeToLive?: number;
	/** Unique ID for this message */
	messageId?: string;
	variables?: Variables;
	/** The tenantId of the message */
	tenantId?: string;
};

export type TopologyResponse = {
	readonly brokers: BrokerInfo[];
	readonly clusterSize: number;
	readonly partitionsCount: number;
	readonly replicationFactor: number;
	readonly gatewayVersion: string;
};

/**
 * Describes the Raft role of the broker for a given partition
 */
export enum PartitionBrokerRole {
	LEADER = 0,
	BROKER = 1,
	INACTIVE = 2,
}

/**
 * Describes the current health of the partition
 */
export enum PartitionBrokerHealth {
	HEALTHY = 0,
	UNHEALTHY = 1,
	DEAD = 2,
}

export type Partition = {
	partitionId: number;
	/** The role of the broker for this partition */
	role: PartitionBrokerRole;
	/** The health of this partition */
	health: PartitionBrokerHealth;
};

export type BrokerInfo = {
	nodeId: number;
	host: string;
	port: number;
	partitions: Partition[];
};

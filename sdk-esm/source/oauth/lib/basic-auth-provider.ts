import debug from 'debug'
import {
	EnvironmentConfigurator,
	type OAuthConfiguration,
	requireConfiguration,
} from './get-environment.ts'
import type {TokenGrantAudienceType} from './oauth-types.ts'
import type {IOAuthProvider} from './interfaces.ts'
import {encodeBase64} from "jsr:@std/encoding/base64";

const trace = debug('camunda:oauth')

export class BasicAuthProvider implements IOAuthProvider {
	private readonly username: string | undefined
	private readonly password: string | undefined
	constructor(options?: {config?: Partial<OAuthConfiguration>}) {
		const config = EnvironmentConfigurator.mergeConfigWithEnvironment(
			options?.config ?? {},
		)
		this.username = requireConfiguration(
			config.CAMUNDA_BASIC_AUTH_USERNAME,
			'CAMUNDA_BASIC_AUTH_USERNAME',
		)
		this.password = requireConfiguration(
			config.CAMUNDA_BASIC_AUTH_PASSWORD,
			'CAMUNDA_BASIC_AUTH_PASSWORD',
		)
	}

	async getToken(audience: TokenGrantAudienceType): Promise<string> {
		trace(`Requesting token for audience ${audience}`)
		const token = encodeBase64(`${this.username}:${this.password}`);
		return token;
	}
}

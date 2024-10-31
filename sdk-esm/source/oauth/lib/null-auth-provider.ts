import debug from 'debug'
import type {TokenGrantAudienceType} from './oauth-types.ts'
import type {IOAuthProvider} from './interfaces.ts'

const d = debug('camunda:oauth')

export class NullAuthProvider implements IOAuthProvider {
	public getToken(audience: TokenGrantAudienceType): Promise <string> {
		d('NullAuthProvider.getToken: returning empty string for ' + audience)
		return Promise.resolve('')
	}
}

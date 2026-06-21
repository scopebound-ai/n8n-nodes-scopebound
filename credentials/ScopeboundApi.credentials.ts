import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

/**
 * Scopebound API credential. Used by all Scopebound nodes to authenticate
 * against the enforcement plane.
 *
 * Provision an API key with:
 *   $ go run ./cmd/provision-partner -name "<partner>" -email "<email>"
 *
 * The partner is created server-side and the printed API key goes here.
 */
export class ScopeboundApi implements ICredentialType {
  name = 'scopeboundApi';
  displayName = 'Scopebound API';
  //documentationUrl = 'https://docs.scopebound.ai/sdk/n8n';
    documentationUrl = 'https://github.com/scopebound-ai/n8n-nodes-scopebound#readme';
  properties: INodeProperties[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      description:
        'Scopebound API key (starts with "sb-"). Issued by `provision-partner` on the enforcement plane.',
    },
    {
      displayName: 'Base URL',
      name: 'baseUrl',
      type: 'string',
      default: 'https://api.scopebound.ai',
      required: true,
      description:
        'Scopebound enforcement plane base URL. Use http://localhost:8080 for local development.',
    },
  ];

  // Inject the API key into outbound requests as the X-Scopebound-API-Key header.
  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        'X-Scopebound-API-Key': '={{$credentials.apiKey}}',
      },
    },
  };

  // n8n calls this when the user clicks "Test" on the credential — verifies
  // the API key is valid by hitting a lightweight endpoint.
  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.baseUrl}}',
      url: '/healthz',
      method: 'GET',
    },
  };
}

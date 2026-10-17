// Adversarial review: the AWS Lambda entry point (src/server/lambda.ts) as deployed by
// infra/template.yaml. DynamoDB is mocked (aws-sdk-client-mock); no AWS account is used.
// Each test imports a fresh copy of lambda.ts because it reads process.env at import time.
import { BatchWriteItemCommand, DynamoDBClient, QueryCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { packageRoot } from '../../src/server/root.ts';

const HOST = 'abc123.lambda-url.us-east-1.on.aws';
const ddb = mockClient(DynamoDBClient);

/** Environment exactly as infra/template.yaml sets it with default parameters. */
const TEMPLATE_DEFAULT_ENV = {
  SCAFFOLD_STORE: 'dynamodb',
  SCAFFOLD_TABLE: 'scaffold-events',
  SCAFFOLD_TZ: 'America/Los_Angeles',
  ALLOWED_HOSTS: '', // AllowedHosts parameter default ''
  SCAFFOLD_TOKENS: '', // Tokens parameter default ''
  SCAFFOLD_ANONYMOUS: 'none', // set by the template (fix for R-04)
  SCAFFOLD_TOKEN_SECRET: 'template-param-secret-0123456789abcdef0123', // TokenSecret parameter (required)
  NODE_ENV: 'production',
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'x',
  AWS_SECRET_ACCESS_KEY: 'y',
};

const saved = { ...process.env };
beforeEach(() => {
  ddb.reset();
  ddb.on(QueryCommand).resolves({ Items: [] });
  ddb.on(BatchWriteItemCommand).resolves({});
  ddb.on(TransactWriteItemsCommand).resolves({});
  vi.resetModules();
});
afterEach(() => {
  process.env = { ...saved };
});

async function loadLambda(env: Record<string, string>) {
  process.env = { ...saved, ...env };
  const mod = await import('../../src/server/lambda.ts');
  return mod.handler as (event: unknown, ctx: unknown) => Promise<{ statusCode: number; body: string; headers?: Record<string, string> }>;
}

/** Lambda Function URL event (payload format 2.0). */
function urlEvent(path: string, method = 'GET', body?: string, headers: Record<string, string> = {}) {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: path,
    rawQueryString: '',
    headers: { host: HOST, ...headers },
    requestContext: {
      accountId: 'anonymous',
      apiId: 'abc123',
      domainName: HOST,
      domainPrefix: 'abc123',
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '203.0.113.9', userAgent: 'review' },
      requestId: 'req-1',
      routeKey: '$default',
      stage: '$default',
      time: '17/Oct/2026:00:00:00 +0000',
      timeEpoch: 0,
    },
    body,
    isBase64Encoded: false,
  };
}

const MCP_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' };
const INIT = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'review', version: '0' } },
});

describe('Lambda deployment (infra/template.yaml + src/server/lambda.ts)', () => {
  it('R-01: POST /mcp initialize works behind serverless-http (body arrives as a Buffer, so every JSON-RPC call is 400)', async () => {
    const handler = await loadLambda({ ...TEMPLATE_DEFAULT_ENV, ALLOWED_HOSTS: HOST, SCAFFOLD_TOKENS: 'T=sam:learner:sam' });
    const res = await handler(urlEvent('/mcp', 'POST', INIT, { ...MCP_HEADERS, authorization: 'Bearer T' }), {});
    expect(res.body).not.toMatch(/not a valid JSON-RPC message/);
    expect(res.statusCode).toBe(200);
    const text = String(res.body);
    const json = JSON.parse(text.includes('data:') ? text.split('data: ')[1]!.split('\n')[0]! : text);
    expect(json.result.protocolVersion).toBe('2025-11-25');
  });

  it('R-01: POST /mcp-json initialize also works behind serverless-http', async () => {
    const handler = await loadLambda({ ...TEMPLATE_DEFAULT_ENV, ALLOWED_HOSTS: HOST, SCAFFOLD_TOKENS: 'T=sam:learner:sam' });
    const res = await handler(urlEvent('/mcp-json', 'POST', INIT, { ...MCP_HEADERS, accept: 'application/json', authorization: 'Bearer T' }), {});
    expect(res.statusCode).toBe(200);
  });

  it('R-02: with the template default AllowedHosts="" the function still serves /healthz (it answers 403 Invalid Host to everything)', async () => {
    const handler = await loadLambda(TEMPLATE_DEFAULT_ENV);
    const res = await handler(urlEvent('/healthz'), {});
    expect(res.body).not.toMatch(/Invalid Host/);
    expect(res.statusCode).toBe(200);
  });

  it('R-03: one failed DynamoDB read during the first-boot seed does not poison the warm instance forever', async () => {
    ddb.reset();
    ddb.on(QueryCommand).rejectsOnce(new Error('ProvisionedThroughputExceededException')).resolves({ Items: [] });
    ddb.on(BatchWriteItemCommand).resolves({});
    const handler = await loadLambda({ ...TEMPLATE_DEFAULT_ENV, ALLOWED_HOSTS: HOST });
    await handler(urlEvent('/healthz'), {}).catch(() => undefined); // first invocation: throttled
    const second = await handler(urlEvent('/healthz'), {}).catch((e: unknown) => ({ statusCode: -1, body: String(e) }));
    expect(second.body).not.toMatch(/ProvisionedThroughputExceeded/);
    expect(second.statusCode).toBe(200);
  });

  it('R-04: a public Function URL (AuthType NONE) rejects an MCP call with no bearer token (anonymous learner fallback is on by default)', async () => {
    const handler = await loadLambda({ ...TEMPLATE_DEFAULT_ENV, ALLOWED_HOSTS: HOST });
    const res = await handler(urlEvent('/mcp', 'POST', INIT, MCP_HEADERS), {});
    expect(res.statusCode).toBe(401);
  });

  it('R-20: the template "Tokens" description ("Empty = built-in demo tokens") matches what authFromEnv does with ""', async () => {
    const { authFromEnv } = await import('../../src/server/auth.ts');
    const tpl = readFileSync(join(packageRoot(), 'infra/template.yaml'), 'utf8');
    const claimsDemoTokens = /Empty = built-in demo tokens/.test(tpl);
    const cfg = authFromEnv({ SCAFFOLD_TOKENS: '' } as NodeJS.ProcessEnv);
    // Do NOT fix this by honouring the doc: the built-in "demo-coach" token is public in the source.
    expect(claimsDemoTokens && cfg.tokens.size === 0).toBe(false);
  });
});

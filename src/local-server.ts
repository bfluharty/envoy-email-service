import { randomUUID } from 'node:crypto';
import { createServer, IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http';
import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { handler } from './index.js';

const PORT = Number(process.env.PORT ?? 8083);

function normalizeHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      normalized[key] = value.join(', ');
    } else if (typeof value === 'string') {
      normalized[key] = value;
    }
  }

  return normalized;
}

function normalizeResponseHeaders(
  headers: APIGatewayProxyStructuredResultV2['headers'] | undefined
): OutgoingHttpHeaders {
  const normalized: OutgoingHttpHeaders = {};

  for (const [key, value] of Object.entries(headers ?? {})) {
    normalized[key] = typeof value === 'boolean' ? String(value) : value;
  }

  return normalized;
}

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString('utf8');
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  const event = {
    version: '2.0',
    routeKey: `${req.method ?? ''} ${url.pathname}`,
    rawPath: url.pathname,
    rawQueryString: url.search.length > 0 ? url.search.slice(1) : '',
    headers: normalizeHeaders(req.headers),
    requestContext: {
      accountId: 'local',
      apiId: 'local',
      domainName: req.headers.host ?? 'localhost',
      domainPrefix: 'local',
      http: {
        method: req.method ?? '',
        path: url.pathname,
        protocol: `HTTP/${req.httpVersion}`,
        sourceIp: req.socket.remoteAddress ?? '',
        userAgent: req.headers['user-agent'] ?? '',
      },
      requestId: randomUUID(),
      routeKey: `${req.method ?? ''} ${url.pathname}`,
      stage: '$default',
      time: new Date().toUTCString(),
      timeEpoch: Date.now(),
    },
    body: rawBody || undefined,
    isBase64Encoded: false,
  } satisfies APIGatewayProxyEventV2;

  const result = await handler(event);

  res.writeHead(result.statusCode ?? 200, normalizeResponseHeaders(result.headers));
  res.end(result.body ?? '');
});

server.listen(PORT, () => {
  console.log(`envoy-email-service listening on port ${PORT}`);
});

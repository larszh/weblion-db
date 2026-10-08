import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  form: URLSearchParams;
}

export type Handler = (
  req: RecordedRequest,
) => { status?: number; statusText?: string; body: unknown } | undefined;

/** Tiny HTTP server that records requests and answers from a route table. */
export async function startMockServer(handler: Handler) {
  const requests: RecordedRequest[] = [];
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const recorded: RecordedRequest = {
        method: req.method ?? 'GET',
        path: url.pathname,
        query: url.searchParams,
        headers: req.headers,
        form: new URLSearchParams(raw),
      };
      requests.push(recorded);
      const answer = handler(recorded) ?? {
        status: 404,
        statusText: 'Not Found',
        body: { message: 'no route' },
      };
      res.statusCode = answer.status ?? 200;
      if (answer.statusText) res.statusMessage = answer.statusText;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

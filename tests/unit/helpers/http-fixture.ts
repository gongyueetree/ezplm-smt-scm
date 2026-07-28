/** 通用本地 JSON 夹具服务:供 DigiKey/Mouser Provider 的合同与行为测试使用 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import type { AddressInfo } from "net";

export interface FixtureRequest {
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
  headers: Record<string, string | undefined>;
  body: unknown;
}

export interface FixtureResponse {
  status?: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

export type FixtureHandler = (req: FixtureRequest) => FixtureResponse | undefined;

export interface JsonFixtureServer {
  baseUrl: string;
  requests: FixtureRequest[];
  close(): Promise<void>;
}

export async function startJsonServer(handler: FixtureHandler): Promise<JsonFixtureServer> {
  const requests: FixtureRequest[] = [];

  const onRequest = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body: unknown = null;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    const record: FixtureRequest = {
      method: req.method ?? "GET",
      pathname: url.pathname,
      searchParams: url.searchParams,
      headers: req.headers as Record<string, string | undefined>,
      body,
    };
    requests.push(record);

    const result = handler(record);
    if (!result) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "no fixture route" }));
      return;
    }
    res.writeHead(result.status ?? 200, {
      "Content-Type": "application/json",
      ...(result.headers ?? {}),
    });
    res.end(result.text ?? JSON.stringify(result.json ?? {}));
  };

  const server: Server = createServer((req, res) => {
    void onRequest(req, res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

/**
 * 本地夹具服务:按 DEFAULT_PATHS 契约草案提供 HTTP 端点,数据委托 MockEzplmProvider。
 * 用于 HttpEzplmProvider 的合同测试与行为测试(无任何真实 ezPLM 依赖)。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import type { AddressInfo } from "net";
import { MockEzplmProvider } from "@/lib/providers/ezplm";

const mock = new MockEzplmProvider();

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : null;
}

export interface FixtureServer {
  baseUrl: string;
  /** 收到的请求记录(路径 + Authorization 头) */
  requests: { path: string; auth?: string }[];
  close(): Promise<void>;
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const requests: FixtureServer["requests"] = [];

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    requests.push({ path: url.pathname, auth: req.headers.authorization });

    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    try {
      if (url.pathname === "/api/parts/search") {
        return json(
          200,
          await mock.searchParts({
            keyword: url.searchParams.get("q") ?? "",
            limit: Number(url.searchParams.get("limit") ?? 20),
          }),
        );
      }
      if (url.pathname === "/api/parts/by-mpn") {
        return json(
          200,
          await mock.getPartByMpn({
            mpn: url.searchParams.get("mpn") ?? "",
            manufacturer: url.searchParams.get("manufacturer") ?? undefined,
          }),
        );
      }
      if (url.pathname === "/api/parts/batch-resolve") {
        const body = (await readBody(req)) as { inputs: [] };
        return json(200, await mock.batchResolve(body.inputs));
      }
      if (url.pathname === "/api/inventory/query") {
        const body = (await readBody(req)) as { partIds: string[] };
        return json(200, await mock.getInventory(body.partIds));
      }
      const mappings = url.pathname.match(/^\/api\/customers\/([^/]+)\/part-mappings$/);
      if (mappings) return json(200, await mock.getCustomerMappings(decodeURIComponent(mappings[1])));
      const alternates = url.pathname.match(/^\/api\/parts\/([^/]+)\/alternates$/);
      if (alternates) return json(200, await mock.getAlternates(decodeURIComponent(alternates[1])));
      const compliance = url.pathname.match(/^\/api\/parts\/([^/]+)\/compliance$/);
      if (compliance) return json(200, await mock.getCompliance(decodeURIComponent(compliance[1])));
      return json(404, { error: "not found" });
    } catch (e) {
      return json(500, { error: String(e) });
    }
  };

  const server: Server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

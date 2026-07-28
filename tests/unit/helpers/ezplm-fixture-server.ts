/**
 * ezPLM API Key 接口的本地夹具服务(按真实契约)。
 *
 * 关键:**服务端独立按手册算法重算签名并校验** ——
 * 这样 HttpEzplmProvider 的签名实现一旦与手册不一致,测试立刻失败,
 * 而不是等到真实联调才发现。
 */
import crypto from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import type { AddressInfo } from "net";

export const FIXTURE_API_KEY = "fixture-api-key-do-not-use-in-prod";

/** 与真实响应同构的样例物料 */
export const FIXTURE_PARTS = [
  {
    id: "018b334d-4580-7cf1-a2d1-9e9f90f4b31d",
    mpn: "STM32F103C8T6",
    description: "主流 Arm Cortex-M3 微控制器,64KB 闪存,72MHz",
    officialUrl: "https://www.st.com/example",
    manufacturer: { id: "mfr-st", name: "STMicroelectronics" },
    category: { id: "cat-mcu", name: "微控制器(MCU)" },
    footprint: {
      id: "fp-1",
      name: "LQFP-48_7x7mm_P0.5mm",
      kicadModFile: { id: "f-mod", url: "https://qn.example/fp.kicad_mod", fname: "LQFP48.kicad_mod" },
      stepFile: { id: "f-step", url: "https://qn.example/fp.step", fname: "LQFP48.step" },
    },
    symbol: {
      id: "sym-1",
      name: "STM32F103C8Tx",
      kicadSymFile: { id: "f-sym", url: "https://qn.example/sym.kicad_sym", fname: "stm32f103.kicad_sym" },
    },
    pdf: { id: "pdf-1", url: "https://qn.example/ds.pdf", fname: "STM32F103.pdf" },
    attributes: [
      { name: "供电电压", value: "3.6" },
      { name: "闪存大小", value: "64" },
      { name: "工作温度", value: "85" },
    ],
  },
  {
    id: "018b334d-4968-7cf1-a2d1-9e9f90f4fafd",
    mpn: "STM32C011F4P7",
    description: "Arm Cortex-M0+ 微控制器",
    manufacturer: { id: "mfr-st", name: "STMicroelectronics" },
    category: { id: "cat-mcu", name: "微控制器(MCU)" },
    // 故意缺 footprint/symbol/pdf:验证"文件缺失"不会导致校验失败
    attributes: [],
  },
];

const FIXTURE_REFS = [
  { id: "rd-1", name: "STM32F103 最小系统参考设计", link: "https://example/rd1", image: null, description: "含晶振与复位电路" },
];

function canonicalQuery(params: URLSearchParams): string {
  return [...params.entries()]
    .filter(([, v]) => v !== "")
    .sort(([lk, lv], [rk, rv]) => (lk === rk ? lv.localeCompare(rv) : lk.localeCompare(rk)))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

export interface FixtureServer {
  origin: string;
  requests: { path: string; nonce: string | undefined }[];
  /** 强制下一次响应的状态码(测试限流/鉴权分支) */
  forceStatus: number | null;
  close(): Promise<void>;
}

export async function startEzplmFixture(): Promise<FixtureServer> {
  const state: Pick<FixtureServer, "requests" | "forceStatus"> = { requests: [], forceStatus: null };

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    const nonce = req.headers["x-nonce"] as string | undefined;
    state.requests.push({ path: url.pathname, nonce });

    if (state.forceStatus) {
      const s = state.forceStatus;
      state.forceStatus = null;
      return json(s, { error: { code: "FORCED", message: "forced by fixture" } });
    }

    // 四个签名头缺一不可
    const apiKey = req.headers["x-api-key"] as string | undefined;
    const ts = req.headers["x-timestamp"] as string | undefined;
    const sig = req.headers["x-signature"] as string | undefined;
    if (!apiKey || !ts || !nonce || !sig) {
      return json(400, { error: { code: "PARAM_INVALID", message: "缺少签名头" } });
    }
    if (apiKey !== FIXTURE_API_KEY) {
      return json(401, { error: { code: "AUTH_INVALID_TOKEN", message: "无效的令牌" } });
    }

    // 服务端独立重算签名
    const expected = crypto
      .createHmac("sha256", FIXTURE_API_KEY)
      .update(["GET", url.pathname, canonicalQuery(url.searchParams), ts, nonce].join("\n"))
      .digest("base64url");
    if (expected !== sig) {
      return json(401, { error: { code: "AUTH_INVALID_TOKEN", message: "签名不匹配" } });
    }

    if (url.pathname === "/api/v1/api-key/parts") {
      const keyword = (url.searchParams.get("keyword") ?? "").toUpperCase();
      const data = FIXTURE_PARTS.filter((p) =>
        `${p.mpn} ${p.description ?? ""}`.toUpperCase().includes(keyword),
      );
      return json(200, {
        data,
        meta: { timestamp: "2026-07-28T10:00:00.000Z", nextCursor: null, hasMore: false },
      });
    }
    if (url.pathname === "/api/v1/api-key/reference-designs") {
      const partlibId = url.searchParams.get("partlibId");
      const data = partlibId === FIXTURE_PARTS[0].id ? FIXTURE_REFS : [];
      return json(200, { data, meta: { timestamp: "2026-07-28T10:00:00.000Z", hasMore: false } });
    }
    return json(404, { error: { code: "RESOURCE_NOT_FOUND", message: "资源不存在" } });
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;

  return {
    origin: `http://127.0.0.1:${port}`,
    get requests() {
      return state.requests;
    },
    get forceStatus() {
      return state.forceStatus;
    },
    set forceStatus(v: number | null) {
      state.forceStatus = v;
    },
    close: () => new Promise((r) => server.close(() => r())),
  } as FixtureServer;
}

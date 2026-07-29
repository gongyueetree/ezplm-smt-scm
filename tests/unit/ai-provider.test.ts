import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import type { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GeminiProvider } from "@/lib/ai/gemini";
import {
  assertAttachmentSupported,
  DEFAULT_MODELS,
  extractJson,
  LlmError,
  llmModel,
  llmStatus,
  llmVendor,
} from "@/lib/ai/provider";

const ENV_KEYS = [
  "AI_PROVIDER",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "GEMINI_API_BASE_URL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
});

describe("llmVendor:厂商选型", () => {
  it("都没配时返回 null —— 调用方据此降级,不得伪装已接入", () => {
    expect(llmVendor()).toBeNull();
    expect(llmStatus()).toEqual({ configured: false, vendor: null, model: null });
  });

  it("默认优先 Gemini", () => {
    process.env.GEMINI_API_KEY = "g";
    process.env.ANTHROPIC_API_KEY = "a";
    expect(llmVendor()).toBe("gemini");
  });

  it("只配 Anthropic 时用 Anthropic", () => {
    process.env.ANTHROPIC_API_KEY = "a";
    expect(llmVendor()).toBe("anthropic");
  });

  it("AI_PROVIDER 可显式指定,大小写与空白不敏感", () => {
    process.env.GEMINI_API_KEY = "g";
    process.env.ANTHROPIC_API_KEY = "a";
    process.env.AI_PROVIDER = " Anthropic ";
    expect(llmVendor()).toBe("anthropic");
  });

  it("AI_PROVIDER 指定了但对应 Key 缺失时返回 null,**不静默换厂商**", () => {
    process.env.ANTHROPIC_API_KEY = "a";
    process.env.AI_PROVIDER = "gemini";
    expect(llmVendor()).toBeNull();
  });

  it("AI_PROVIDER=none 可强制关闭 AI(即使配了 Key)", () => {
    process.env.GEMINI_API_KEY = "g";
    process.env.AI_PROVIDER = "none";
    expect(llmVendor()).toBeNull();
  });
});

describe("llmModel:默认与覆盖", () => {
  it("默认模型", () => {
    expect(llmModel("gemini")).toBe(DEFAULT_MODELS.gemini);
    expect(llmModel("gemini")).toBe("gemini-2.5-flash");
    expect(llmModel("anthropic")).toBe(DEFAULT_MODELS.anthropic);
  });

  it("环境变量可覆盖;空串按未设处理", () => {
    process.env.GEMINI_MODEL = "gemini-2.5-pro";
    expect(llmModel("gemini")).toBe("gemini-2.5-pro");
    process.env.GEMINI_MODEL = "   ";
    expect(llmModel("gemini")).toBe(DEFAULT_MODELS.gemini);
  });

  it("llmStatus 只暴露厂商与模型,不含任何凭据", () => {
    process.env.GEMINI_API_KEY = "super-secret-key";
    const s = llmStatus();
    expect(s).toEqual({ configured: true, vendor: "gemini", model: "gemini-2.5-flash" });
    expect(JSON.stringify(s)).not.toContain("super-secret-key");
  });
});

describe("extractJson:模型输出容错", () => {
  it("裸 JSON / 代码块 / 前后带说明都能取出", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('好的:{"a":1} 以上')).toEqual({ a: 1 });
    expect(extractJson("[1,2]")).toEqual([1, 2]);
  });

  it("没有 JSON / 语法错误时抛错,绝不返回半个对象", () => {
    expect(() => extractJson("我看不清这张图")).toThrow(/找不到 JSON/);
    expect(() => extractJson('{"a":')).toThrow(/不完整|解析失败/);
    expect(() => extractJson('{"a":,}')).toThrow(/解析失败/);
  });
});

describe("assertAttachmentSupported:附件护栏", () => {
  it("放行图片与 PDF", () => {
    expect(() =>
      assertAttachmentSupported({ mimeType: "image/png", data: Buffer.from("x") }),
    ).not.toThrow();
    expect(() =>
      assertAttachmentSupported({ mimeType: "application/pdf", data: Buffer.from("x") }),
    ).not.toThrow();
  });

  it("拒绝不支持的类型与超大附件", () => {
    expect(() =>
      assertAttachmentSupported({ mimeType: "text/csv", data: Buffer.from("x") }),
    ).toThrow(LlmError);
    expect(() =>
      assertAttachmentSupported({ mimeType: "image/png", data: Buffer.alloc(6 * 1024 * 1024) }),
    ).toThrow(/超过/);
  });
});

/** 本地夹具服务:验证发出的请求形状,不需要真实 Key */
async function startGeminiFixture(handler: (body: Record<string, unknown>, req: IncomingMessage) => {
  status: number;
  body: unknown;
}): Promise<{ origin: string; close: () => Promise<void>; lastPath: () => string }> {
  let lastPath = "";
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    lastPath = req.url ?? "";
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const out = handler(parsed, req);
      res.writeHead(out.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
    lastPath: () => lastPath,
  };
}

describe("GeminiProvider:请求形状与响应解析", () => {
  it("未配置 Key 时构造即抛 not_configured", () => {
    expect(() => new GeminiProvider()).toThrow(LlmError);
    expect(() => new GeminiProvider()).toThrow(/GEMINI_API_KEY 未配置/);
  });

  it("Key 走请求头而**不进 URL**(URL 会被日志/代理记下来)", async () => {
    let seenHeaderKey: string | undefined;
    const fx = await startGeminiFixture((_body, req) => {
      seenHeaderKey = req.headers["x-goog-api-key"] as string;
      return { status: 200, body: { candidates: [{ content: { parts: [{ text: "ok" }] } }] } };
    });
    try {
      const p = new GeminiProvider({ apiKey: "secret-key", baseUrl: fx.origin });
      await p.generateText({ prompt: "hi" });
      expect(seenHeaderKey).toBe("secret-key");
      expect(fx.lastPath()).not.toContain("secret-key");
      expect(fx.lastPath()).toContain("gemini-2.5-flash:generateContent");
    } finally {
      await fx.close();
    }
  });

  it("system / json / thinkingBudget / 附件都按 Gemini 的字段发出", async () => {
    let body: Record<string, unknown> = {};
    const fx = await startGeminiFixture((b) => {
      body = b;
      return { status: 200, body: { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] } };
    });
    try {
      const p = new GeminiProvider({ apiKey: "k", baseUrl: fx.origin });
      await p.generateText({
        system: "你只输出 JSON",
        prompt: "转写",
        json: true,
        thinkingBudget: 0,
        attachments: [{ mimeType: "image/png", data: Buffer.from("PNG") }],
      });
      const gen = body.generationConfig as Record<string, unknown>;
      expect(gen.responseMimeType).toBe("application/json");
      expect(gen.thinkingConfig).toEqual({ thinkingBudget: 0 });
      expect(JSON.stringify(body.systemInstruction)).toContain("你只输出 JSON");
      const parts = (body.contents as { parts: Record<string, unknown>[] }[])[0].parts;
      expect(parts[0].inline_data).toMatchObject({ mime_type: "image/png" });
      expect(parts[1].text).toBe("转写");
    } finally {
      await fx.close();
    }
  });

  it("不传 thinkingBudget 时不发该字段(用模型默认)", async () => {
    let body: Record<string, unknown> = {};
    const fx = await startGeminiFixture((b) => {
      body = b;
      return { status: 200, body: { candidates: [{ content: { parts: [{ text: "x" }] } }] } };
    });
    try {
      await new GeminiProvider({ apiKey: "k", baseUrl: fx.origin }).generateText({ prompt: "hi" });
      expect((body.generationConfig as Record<string, unknown>).thinkingConfig).toBeUndefined();
    } finally {
      await fx.close();
    }
  });

  it("思考 token 计入输出用量,否则会低报成本", async () => {
    const fx = await startGeminiFixture(() => ({
      status: 200,
      body: {
        candidates: [{ content: { parts: [{ text: "hi" }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 40 },
      },
    }));
    try {
      const r = await new GeminiProvider({ apiKey: "k", baseUrl: fx.origin }).generateText({ prompt: "hi" });
      expect(r.usage).toEqual({ promptTokens: 10, completionTokens: 45, costUsd: null });
    } finally {
      await fx.close();
    }
  });

  it("HTTP 错误只带状态码,不回显响应体", async () => {
    const fx = await startGeminiFixture(() => ({
      status: 429,
      body: { error: { status: "RESOURCE_EXHAUSTED", message: "quota exceeded for key AIzaSy-SECRET" } },
    }));
    try {
      const p = new GeminiProvider({ apiKey: "k", baseUrl: fx.origin });
      await expect(p.generateText({ prompt: "hi" })).rejects.toThrow(/HTTP 429.*RESOURCE_EXHAUSTED/);
      await expect(p.generateText({ prompt: "hi" })).rejects.not.toThrow(/AIzaSy-SECRET/);
    } finally {
      await fx.close();
    }
  });

  it("模型返回空文本时报错并给出可操作提示,不返回空串冒充结果", async () => {
    const fx = await startGeminiFixture(() => ({
      status: 200,
      body: { candidates: [{ content: { parts: [] }, finishReason: "MAX_TOKENS" }] },
    }));
    try {
      const p = new GeminiProvider({ apiKey: "k", baseUrl: fx.origin });
      await expect(p.generateText({ prompt: "hi" })).rejects.toThrow(/MAX_TOKENS/);
      await expect(p.generateText({ prompt: "hi" })).rejects.toThrow(/thinkingBudget/);
    } finally {
      await fx.close();
    }
  });
});

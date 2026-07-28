import { requireSession } from "@/lib/server/api";
import { processNextBatch } from "@/lib/server/repositories/bom-import";

export const runtime = "nodejs";

/**
 * SSE 进度流(SPEC §15:前端轮询或 SSE)。
 * 每个 tick 处理一批并推送进度,完成即结束流;
 * 上限 MAX_TICKS 防止单次函数调用超时(Vercel 函数时长受限),
 * 未完成时前端可重新连接继续推进 —— 与轮询接口共用同一套拉取式推进逻辑。
 */
const MAX_TICKS = 40;

export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { jobId } = await params;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        for (let i = 0; i < MAX_TICKS; i++) {
          const outcome = await processNextBatch(auth.session, jobId);
          if (!outcome) {
            send("error", { error: "导入作业不存在或不属于当前租户" });
            break;
          }
          send("progress", outcome);
          if (outcome.progress.done) {
            send("done", outcome);
            break;
          }
        }
      } catch (e) {
        send("error", { error: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

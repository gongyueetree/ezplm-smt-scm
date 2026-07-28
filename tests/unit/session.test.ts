import { describe, expect, it } from "vitest";
import { signSession, verifySession } from "@/lib/auth/session";

const SECRET = "unit-test-secret";
const payload = {
  userId: "u1",
  tenantId: "t1",
  name: "王工",
  roles: ["PM" as const],
};

describe("会话 JWT(jose HS256)", () => {
  it("签发→验签往返一致", async () => {
    const token = await signSession(payload, SECRET);
    const back = await verifySession(token, SECRET);
    expect(back).toEqual(payload);
  });

  it("篡改 token 验签失败", async () => {
    const token = await signSession(payload, SECRET);
    const tampered = token.slice(0, -4) + "AAAA";
    expect(await verifySession(tampered, SECRET)).toBeNull();
  });

  it("错误密钥验签失败", async () => {
    const token = await signSession(payload, SECRET);
    expect(await verifySession(token, "other-secret")).toBeNull();
  });

  it("非法载荷返回 null 而非抛错", async () => {
    expect(await verifySession("not-a-jwt", SECRET)).toBeNull();
  });
});

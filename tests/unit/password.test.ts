import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("口令哈希(bcryptjs)", () => {
  it("哈希→校验往返;错误口令拒绝;哈希不含明文", async () => {
    const hash = await hashPassword("demo1234");
    expect(await verifyPassword("demo1234", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
    expect(hash).not.toContain("demo1234");
  });
});

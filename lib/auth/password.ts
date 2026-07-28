/** 口令哈希(bcryptjs 纯 JS 实现,免原生编译,镜像友好)。仅在 Node 运行时使用。 */
import bcrypt from "bcryptjs";

const ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

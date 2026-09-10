/**
 * 把 src/ 同步到云函数目录。
 * 云函数上传时必须自包含，所以 cloudfunctions/api/lib/ 是生成物，不进版本库。
 * 用法: node scripts/sync-lib.mjs
 */
import { cpSync, mkdirSync, rmSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const from = path.join(root, "src");
const to = path.join(root, "cloudfunctions", "api", "lib");

if (!existsSync(from)) {
  console.error(`[sync-lib] 找不到源目录: ${from}`);
  process.exit(1);
}

rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });

const files = readdirSync(from).filter((f) => f.endsWith(".mjs"));
for (const f of files) cpSync(path.join(from, f), path.join(to, f));

console.log(`[sync-lib] 已同步 ${files.length} 个文件 → cloudfunctions/api/lib/`);

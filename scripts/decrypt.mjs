/**
 * 读取加密归档。
 *
 *   PAGE_PASSWORD=xxx node scripts/decrypt.mjs            # 看最近几天
 *   PAGE_PASSWORD=xxx node scripts/decrypt.mjs 002555     # 只看某只标的的区间变化
 *   PAGE_PASSWORD=xxx node scripts/decrypt.mjs --json     # 输出原始 JSON
 *
 * 数据来源是 data/history.enc（每天一行，加密）。如果是本地调试生成的
 * data/history.jsonl，会自动读明文那份。
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { decryptText } from "../src/crypto.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const encPath = path.join(root, "data", "history.enc");
const plainPath = path.join(root, "data", "history.jsonl");

const pw = process.env.PAGE_PASSWORD || "";
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const codeFilter = args.find((a) => /^\d{5,6}$/.test(a)) || null;

async function loadRows() {
  if (existsSync(encPath)) {
    if (!pw) {
      console.error("data/history.enc 是加密的，请设置 PAGE_PASSWORD 环境变量。");
      console.error("  PowerShell:  $env:PAGE_PASSWORD=\"你的密码\"; node scripts/decrypt.mjs");
      process.exit(1);
    }
    const lines = readFileSync(encPath, "utf8").split("\n").filter((l) => l.trim());
    const out = [];
    for (const line of lines) {
      try {
        out.push(JSON.parse(await decryptText(line, pw)));
      } catch {
        console.error("有一行解密失败，密码可能不对。");
        process.exit(1);
      }
    }
    return out;
  }
  if (existsSync(plainPath)) {
    return readFileSync(plainPath, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  }
  console.error("data/ 下没有找到 history.enc 或 history.jsonl。");
  process.exit(1);
}

const rows = await loadRows();

if (asJson) {
  console.log(JSON.stringify(codeFilter ? rows.map((r) => ({
    ...r,
    stocks: r.stocks.filter((s) => s.code === codeFilter),
  })) : rows, null, 2));
  process.exit(0);
}

console.log(`共 ${rows.length} 个交易日：${rows[0]?.date} ~ ${rows.at(-1)?.date}\n`);

if (codeFilter) {
  console.log(`标的 ${codeFilter} 的区间变化：\n`);
  console.log("日期        市场  现价      分位     加仓价    减仓价    状态");
  for (const r of rows) {
    for (const s of r.stocks.filter((x) => x.code === codeFilter)) {
      console.log(
        `${r.date}  ${String(s.m).padEnd(4)}  ${String(s.price).padStart(8)}  ` +
          `${String(s.pct == null ? "-" : s.pct + "%").padStart(7)}  ` +
          `${String(s.addPrice ?? "-").padStart(8)}  ${String(s.trimPrice ?? "-").padStart(8)}  ${s.status || "-"}`
      );
    }
  }
  process.exit(0);
}

console.log("日期        指数       低位区数量  高位区数量  标的数");
for (const r of rows) {
  const low = r.stocks.filter((s) => s.pct != null && s.pct < 30).length;
  const high = r.stocks.filter((s) => s.pct != null && s.pct > 70).length;
  console.log(
    `${r.date}  ${String(r.index ?? "-").padStart(9)}  ${String(low).padStart(10)}  ` +
      `${String(high).padStart(10)}  ${String(r.stocks.length).padStart(6)}`
  );
}
console.log("\n看单只标的: node scripts/decrypt.mjs 002555");

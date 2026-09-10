/**
 * 数据源连通性自检。
 * 在 GitHub Actions 里手动跑一次，看看海外节点能不能抓到国内的数据接口。
 *
 *   node scripts/probe.mjs
 */
import { fetchBoardStocks, fetchBoardSnapshot, fetchValuationHistory, fetchAnnouncements, fetchStockReports } from "../src/eastmoney.mjs";
import { yearsAgo } from "../src/config.mjs";

const cases = [
  {
    name: "板块成分股",
    critical: true,
    run: async () => {
      const r = await fetchBoardStocks("BK1046");
      return `${r.length} 只，示例 ${r[0]?.name}`;
    },
  },
  {
    name: "板块指数快照",
    critical: false,
    run: async () => {
      const r = await fetchBoardSnapshot("BK1046");
      return `${r.name} ${r.price}`;
    },
  },
  {
    name: "估值历史(数据中心)",
    critical: true,
    run: async () => {
      const r = await fetchValuationHistory("002555", yearsAgo(5));
      return `${r.length} 个交易日，最新 ${r[0]?.date} PE ${r[0]?.peTtm?.toFixed(1)}`;
    },
  },
  {
    name: "个股公告",
    critical: false,
    run: async () => {
      const r = await fetchAnnouncements("002555", 30);
      return `${r.length} 条`;
    },
  },
  {
    name: "个股研报",
    critical: false,
    run: async () => {
      const r = await fetchStockReports("002555", yearsAgo(1));
      return `${r.length} 篇`;
    },
  },
];

let criticalFailed = 0;
const rows = [];

for (const c of cases) {
  const t0 = Date.now();
  try {
    const detail = await c.run();
    rows.push({ name: c.name, ok: true, ms: Date.now() - t0, detail });
  } catch (e) {
    if (c.critical) criticalFailed++;
    rows.push({ name: c.name, ok: false, ms: Date.now() - t0, detail: e.message });
  }
}

console.log("\n================ 数据源连通性自检 ================\n");
for (const r of rows) {
  console.log(`${r.ok ? "OK  " : "FAIL"}  ${r.name.padEnd(22)} ${String(r.ms).padStart(6)}ms  ${r.detail}`);
}
console.log("");

if (criticalFailed) {
  console.log(`结论：${criticalFailed} 个关键接口不可用，当前网络位置跑不了这套流程。`);
  console.log("解决方向：把抓取挪到国内节点（腾讯云函数 SCF 有长期免费额度），页面仍然放 GitHub Pages。");
  process.exit(1);
}

console.log("结论：关键接口全部可用，可以正常跑每日任务。");

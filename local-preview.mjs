/**
 * 本地验证脚本（不是小程序的一部分）。
 * 用法: node local-preview.mjs
 * 作用: 完整跑一遍云函数里的数据管道，把结果存成 JSON 并打印摘要。
 */
import { buildSnapshot } from "./src/pipeline.mjs";
import { writeFileSync, mkdirSync } from "node:fs";

const snap = await buildSnapshot({ onProgress: (m) => console.log("  →", m) });

mkdirSync("work", { recursive: true });
writeFileSync("work/snapshot.json", JSON.stringify(snap, null, 2), "utf8");

const { sector, stocks } = snap;
console.log("\n========== 板块 ==========");
console.log(
  `${sector.index.name} ${sector.index.price} (${sector.index.chgPct}%)  ` +
    `5日 ${sector.chg5}%  20日 ${sector.chg20}%  ` +
    `MA20 ${sector.ma20} MA60 ${sector.ma60} MA250 ${sector.ma250}  ` +
    `站上年线: ${sector.aboveMa250}  量比 ${sector.volumeRatio}`
);
console.log(
  `涨跌家数 ${sector.breadth.up}/${sector.breadth.down}  领涨 ${sector.leaders
    .map((l) => `${l.name}${l.chgPct}%`)
    .join(" ")}`
);

console.log("\n========== 关注池 ==========");
const pad = (s, n) => String(s ?? "-").padEnd(n, " ");
const padL = (s, n) => String(s ?? "-").padStart(n, " ");
console.log(
  pad("代码", 8) +
    pad("名称", 12) +
    padL("现价", 8) +
    padL("涨跌%", 8) +
    padL("PE(TTM)", 9) +
    padL("估值分位", 9) +
    padL("加仓价", 8) +
    padL("减仓价", 8) +
    padL("距加仓", 8) +
    padL("距减仓", 8) +
    "  状态"
);
for (const s of stocks) {
  if (s.error) {
    console.log(pad(s.code, 8) + pad(s.name, 12) + "  ERROR: " + s.error);
    continue;
  }
  const b = s.bands;
  console.log(
    pad(s.code, 8) +
      pad(s.name, 12) +
      padL(s.price, 8) +
      padL(s.chgPct, 8) +
      padL(s.peTtm != null ? s.peTtm.toFixed(1) : "-", 9) +
      padL(s.valuation.compositePct != null ? s.valuation.compositePct + "%" : "-", 9) +
      padL(b ? b.addPrice : "-", 8) +
      padL(b ? b.trimPrice : "-", 8) +
      padL(b ? b.toAddPricePct + "%" : "-", 8) +
      padL(b ? b.toTrimPricePct + "%" : "-", 8) +
      "  " +
      s.status.label
  );
}

console.log("\n========== 重点票 ==========");
for (const code of snap.focus) {
  const s = stocks.find((x) => x.code === code);
  const d = snap.details[code];
  console.log(`\n--- ${s?.name} (${code}) ---`);
  console.log("  现价:", s?.price, " 估值分位:", s?.valuation?.compositePct + "%");
  console.log(
    "  PE分位:",
    s?.valuation?.pePct + "%",
    " PB分位:",
    s?.valuation?.pbPct + "%",
    " PS分位:",
    s?.valuation?.psPct + "%"
  );
  console.log(
    "  加仓价:",
    s?.bands?.addPrice,
    `(区间 ${s?.bands?.addLow}-${s?.bands?.addHigh})`,
    " 减仓价:",
    s?.bands?.trimPrice,
    `(区间 ${s?.bands?.trimLow}-${s?.bands?.trimHigh})`
  );
  console.log("  一致预期:", JSON.stringify(s?.consensus));
  console.log("  价格位置:", JSON.stringify(s?.priceContext));
  console.log("  失效条件:", s?.invalidations?.join(" | ") || "无");
  console.log(`  近期公告 ${d?.announcements?.length ?? 0} 条:`);
  (d?.announcements || []).slice(0, 5).forEach((a) => console.log(`    ${a.date} ${a.title}`));
  console.log(`  研报 ${d?.reports?.length ?? 0} 篇:`);
  (d?.reports || []).slice(0, 5).forEach((r) =>
    console.log(`    ${r.date} [${r.org}] ${r.title}`)
  );
}

console.log("\n========== 行业研报 ==========");
snap.industryReports.slice(0, 5).forEach((r) => console.log(`  ${r.date} [${r.org}] ${r.title}`));

console.log("\n完整结果已写入 work/snapshot.json");

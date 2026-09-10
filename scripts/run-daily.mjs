/**
 * 每日任务入口（GitHub Actions 用）。
 *
 *   node scripts/run-daily.mjs
 *
 * 做四件事：
 *   1. 抓数据并算分位 / 区间
 *   2. 落地 data/latest.json、追加 data/history.jsonl、写 reports/YYYY-MM-DD.md
 *   3. 用 web/index.html 模板生成 docs/index.html（GitHub Pages 发布目录）
 *   4. 有 webhook 就推送
 */
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildSnapshot } from "../src/pipeline.mjs";
import { buildMarkdown, buildPushText, renderConsoleTable } from "../src/report.mjs";
import { CONFIG } from "../src/config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const p = (...s) => path.join(root, ...s);
const ensure = (dir) => mkdirSync(dir, { recursive: true });

const log = (...a) => console.log("[daily]", ...a);

async function push({ title, text }) {
  const jobs = [];

  if (process.env.DINGTALK_WEBHOOK) {
    jobs.push(
      fetch(process.env.DINGTALK_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ msgtype: "markdown", markdown: { title, text } }),
      }).then((r) => `钉钉 ${r.status}`)
    );
  }

  if (process.env.WECOM_WEBHOOK) {
    jobs.push(
      fetch(process.env.WECOM_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ msgtype: "markdown", markdown: { content: `**${title}**\n${text}` } }),
      }).then((r) => `企业微信 ${r.status}`)
    );
  }

  if (process.env.SERVERCHAN_KEY) {
    const body = new URLSearchParams({ title, desp: text });
    jobs.push(
      fetch(`https://sctapi.ftqq.com/${process.env.SERVERCHAN_KEY}.send`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      }).then((r) => `Server酱 ${r.status}`)
    );
  }

  if (!jobs.length) {
    log("未配置任何 webhook，跳过推送。");
    return;
  }

  const results = await Promise.allSettled(jobs);
  for (const r of results) {
    log(r.status === "fulfilled" ? `推送成功 ${r.value}` : `推送失败 ${r.reason?.message}`);
  }
}

function buildSite(snap) {
  const tplPath = p("web", "index.html");
  if (!existsSync(tplPath)) {
    log("没有找到 web/index.html，跳过生成页面。");
    return;
  }
  const tpl = readFileSync(tplPath, "utf8");
  const html = tpl.replace("__DATA__", JSON.stringify(snap).replace(/</g, "\\u003c"));
  ensure(p("docs"));
  writeFileSync(p("docs", "index.html"), html, "utf8");
  log(`已生成 docs/index.html（${(html.length / 1024).toFixed(0)} KB）`);
}

function writeHistory(snap) {
  ensure(p("data"));
  const row = {
    date: snap.tradeDate,
    generatedAt: snap.generatedAt,
    index: snap.sector.index.price,
    stocks: snap.stocks
      .filter((s) => !s.error)
      .map((s) => ({
        code: s.code,
        name: s.name,
        price: s.price,
        pct: s.valuation?.compositePct ?? null,
        addPrice: s.bands?.addPrice ?? null,
        trimPrice: s.bands?.trimPrice ?? null,
        status: s.status?.label ?? null,
      })),
  };
  appendFileSync(p("data", "history.jsonl"), JSON.stringify(row) + "\n", "utf8");
  log(`已追加 data/history.jsonl（${row.stocks.length} 条）`);
}

async function main() {
  const snap = await buildSnapshot();

  ensure(p("data"));
  writeFileSync(p("data", "latest.json"), JSON.stringify(snap, null, 2), "utf8");
  writeHistory(snap);

  ensure(p("reports"));
  writeFileSync(p("reports", `${snap.tradeDate}.md`), buildMarkdown(snap), "utf8");
  log(`已写入 reports/${snap.tradeDate}.md`);

  buildSite(snap);

  console.log("\n-- A股 --");
  console.log(renderConsoleTable(snap.stocks, "A"));
  console.log("\n-- 港股 --");
  console.log(renderConsoleTable(snap.hkStocks || [], "HK"));
  console.log("");

  const c = snap.catalysts || {};
  if (c.license?.ok) {
    console.log(
      `-- 版号 -- ${c.license.months[0]?.title || ""}　共 ${c.license.months[0]?.total ?? "-"} 款　` +
        `命中 ${c.license.matched?.length ?? 0} 条`
    );
    for (const m of c.license.matched || []) {
      console.log(`   ${m.date} 《${m.name}》 ${m.companyName || ""}（${m.matchedField}：${m.matchedEntity}）`);
    }
  }
  if (c.pipeline?.length) {
    console.log(`-- 产品管线 -- ${c.pipeline.length} 条`);
    for (const p of c.pipeline.slice(0, 8)) {
      console.log(`   ${p.soon ? "临近 " : "     "}${p.product}　${p.companyName || ""}　${p.stage || ""}　${p.expectedDate || ""}`);
    }
  }
  if (c.highlights?.length) {
    console.log(`-- 近期动态 -- ${c.highlights.length} 条`);
    for (const h of c.highlights.slice(0, 6)) {
      console.log(`   ${h.date} [${h.kind}] ${h.title.slice(0, 44)}`);
    }
  }

  await push(buildPushText(snap));

  const failed = snap.stocks.filter((s) => s.error);
  log(`完成：${snap.stocks.length - failed.length}/${snap.stocks.length} 只成功，交易日 ${snap.tradeDate}`);
  if (failed.length === snap.stocks.length) {
    console.error("全部标的抓取失败，判定为数据源不可用。");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("每日任务失败：", e);
  process.exit(1);
});

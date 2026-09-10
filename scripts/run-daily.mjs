/**
 * 每日任务入口（GitHub Actions 用）。
 *
 *   PAGE_PASSWORD=xxx node scripts/run-daily.mjs
 *
 * 做四件事：
 *   1. 抓数据并算分位 / 区间
 *   2. 追加当天的加密归档（data/history.enc）
 *   3. 生成 docs/index.html —— 数据默认是加密的，没密码打不开
 *   4. 有 webhook 就推送
 *
 * 不设 PAGE_PASSWORD 时会写成明文，方便本地调试。
 */
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildSnapshot } from "../src/pipeline.mjs";
import { buildMarkdown, buildPushText, renderConsoleTable } from "../src/report.mjs";
import { buildPayload, encryptText } from "../src/crypto.mjs";
import { CONFIG } from "../src/config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const p = (...s) => path.join(root, ...s);
const ensure = (dir) => mkdirSync(dir, { recursive: true });
const log = (...a) => console.log("[daily]", ...a);

const PASSWORD = process.env.PAGE_PASSWORD || "";
const encrypted = !!PASSWORD;

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
        body: JSON.stringify({
          msgtype: "markdown",
          markdown: { content: `**${title}**\n${text}` },
        }),
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

async function buildSite(snap) {
  const tplPath = p("web", "index.html");
  if (!existsSync(tplPath)) {
    log("没有找到 web/index.html，跳过生成页面。");
    return;
  }

  // CI 环境下没设密码就只生成占位页，绝不把明文推上去
  if (!PASSWORD && process.env.CI) {
    ensure(p("docs"));
    writeFileSync(p("docs", "index.html"), PLACEHOLDER_HTML, "utf8");
    log("⚠ CI 里没有设置 PAGE_PASSWORD，已生成占位页（不会泄露数据）");
    return;
  }

  const tpl = readFileSync(tplPath, "utf8");
  const payload = await buildPayload(snap, PASSWORD);
  const html = tpl.replace(
    "__PAYLOAD__",
    JSON.stringify(payload).replace(/</g, "\\u003c")
  );
  ensure(p("docs"));
  writeFileSync(p("docs", "index.html"), html, "utf8");
  log(
    `已生成 docs/index.html（${(html.length / 1024).toFixed(0)} KB，` +
      `${encrypted ? "已加密" : "⚠ 明文"}）`
  );
}

const PLACEHOLDER_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>喜好跟踪</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#0f172a;color:#e2e8f0;font:15px/1.8 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;padding:24px}
div{max-width:420px}
h1{font-size:18px;margin:0 0 12px}
p{color:#94a3b8;margin:0 0 12px}
code{background:#1e293b;padding:2px 6px;border-radius:5px;color:#38bdf8}
</style></head><body><div>
<h1>还没有配置密码</h1>
<p>这一步是故意的：在设置密码之前，页面不会发布任何数据。</p>
<p>到仓库的 <code>Settings → Secrets and variables → Actions</code> 添加一个
<code>PAGE_PASSWORD</code>，然后跑一次 <code>每日任务</code>，页面就会用这个密码加密生成。</p>
<p>密码忘了不影响任何东西，换一个再跑一次就行。</p>
</div></body></html>`;

/** 当天记录：加密后追加，用于以后回测 */
async function writeHistory(snap) {
  ensure(p("data"));
  const row = {
    date: snap.tradeDate,
    generatedAt: snap.generatedAt,
    index: snap.sector.index.price,
    stocks: [
      ...snap.stocks.filter((s) => !s.error).map((s) => ({ m: "A", ...pickRow(s) })),
      ...(snap.hkStocks || []).filter((s) => !s.error).map((s) => ({ m: "HK", ...pickRow(s) })),
    ],
  };
  const line = JSON.stringify(row);

  if (encrypted) {
    appendFileSync(p("data", "history.enc"), (await encryptText(line, PASSWORD)) + "\n", "utf8");
    log(`已追加 data/history.enc（${row.stocks.length} 条，加密）`);
  } else {
    appendFileSync(p("data", "history.jsonl"), line + "\n", "utf8");
    log(`已追加 data/history.jsonl（${row.stocks.length} 条，明文）`);
  }
}

function pickRow(s) {
  return {
    code: s.code,
    name: s.name,
    price: s.price,
    pct: s.valuation?.compositePct ?? null,
    addPrice: s.bands?.addPrice ?? null,
    trimPrice: s.bands?.trimPrice ?? null,
    status: s.status?.label ?? null,
  };
}

async function main() {
  if (!encrypted) {
    log("⚠ 没有设置 PAGE_PASSWORD，本次会生成明文页面。本地调试可以，正式跑请务必设置。");
  }

  const snap = await buildSnapshot();

  // 本地明文快照，不进版本库（.gitignore 已排除）
  ensure(p("data"));
  writeFileSync(p("data", "latest.json"), JSON.stringify(snap, null, 2), "utf8");
  await writeHistory(snap);

  // 日报：本地归档用，同样不进版本库
  ensure(p("reports"));
  writeFileSync(p("reports", `${snap.tradeDate}.md`), buildMarkdown(snap), "utf8");

  await buildSite(snap);

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
    for (const x of c.pipeline.slice(0, 8)) {
      console.log(`   ${x.soon ? "临近 " : "     "}${x.product}　${x.companyName || ""}　${x.stage || ""}　${x.expectedDate || ""}`);
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
  log(`完成：A股 ${snap.stocks.length - failed.length}/${snap.stocks.length}，港股 ${snap.hkStocks?.length ?? 0}，交易日 ${snap.tradeDate}`);
  if (failed.length === snap.stocks.length) {
    console.error("全部标的抓取失败，判定为数据源不可用。");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("每日任务失败：", e);
  process.exit(1);
});

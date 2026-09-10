import { CONFIG } from "./config.mjs";

/** 中文字符占两个显示宽度，终端对齐要按显示宽度算 */
function dispWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    const wide =
      (c >= 0x1100 && c <= 0x115f) ||
      c === 0x2329 || c === 0x232a ||
      (c >= 0x2e80 && c <= 0xa4cf && c !== 0x303f) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe6f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6);
    w += wide ? 2 : 1;
  }
  return w;
}

const pad = (s, n) => {
  const t = String(s ?? "-");
  return t + " ".repeat(Math.max(0, n - dispWidth(t)));
};
const padL = (s, n) => {
  const t = String(s ?? "-");
  return " ".repeat(Math.max(0, n - dispWidth(t))) + t;
};
const f2 = (v) => (v == null || !Number.isFinite(v) ? "-" : Number(v).toFixed(2));
const fp = (v) => (v == null || !Number.isFinite(v) ? "-" : `${v}%`);
const sign = (v) => (v == null || !Number.isFinite(v) ? "-" : v > 0 ? `+${v}` : `${v}`);

function statusOf(s) {
  return (s.status && s.status.label) || "-";
}

/** 每日 Markdown 日报，归档到 reports/ */
export function buildMarkdown(snap) {
  const { sector, stocks, tradeDate } = snap;
  const L = [];

  L.push(`# 喜好跟踪 · ${tradeDate}`);
  L.push("");
  L.push(`> 生成时间 ${new Date(snap.generatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`);
  L.push("");

  L.push("## 整体概况");
  L.push("");
  L.push(
    `- 指数 ${sector.index.name} **${f2(sector.index.price)}**（${sign(sector.index.chgPct)}%）` +
      (sector.synthesized ? " · 等权合成" : "")
  );
  L.push(`- 近 5 日 ${sign(sector.chg5)}% ｜ 近 20 日 ${sign(sector.chg20)}%`);
  L.push(
    `- 涨跌家数 ${sector.breadth.up} 涨 / ${sector.breadth.down} 跌 ｜ ` +
      `站上季线 ${sector.trendBreadth.aboveMa60}/${sector.trendBreadth.ma60Total}` +
      (sector.trendBreadth.ma250Total
        ? ` ｜ 站上年线 ${sector.trendBreadth.aboveMa250}/${sector.trendBreadth.ma250Total}`
        : "")
  );
  L.push("");

  L.push("## 跟踪列表");
  L.push("");
  L.push("| 名称 | 现价 | 涨跌 | PE(TTM) | 历史分位 | 加仓价 | 减仓价 | 状态 |");
  L.push("|---|---:|---:|---:|---:|---:|---:|---|");
  for (const s of stocks) {
    if (s.error) {
      L.push(`| ${s.name} | - | - | - | - | - | - | 抓取失败 |`);
      continue;
    }
    L.push(
      `| ${s.name} | ${f2(s.price)} | ${sign(s.chgPct)}% | ${s.peTtm == null ? "-" : s.peTtm.toFixed(1)} | ` +
        `${fp(s.valuation?.compositePct)} | ${s.bands ? f2(s.bands.addPrice) : "-"} | ` +
        `${s.bands ? f2(s.bands.trimPrice) : "-"} | ${statusOf(s)} |`
    );
  }
  L.push("");

  const cheap = stocks.filter((s) => s.valuation?.ok && s.valuation.compositePct < 30);
  const rich = stocks.filter((s) => s.valuation?.ok && s.valuation.compositePct > 70);
  L.push("## 分区");
  L.push("");
  L.push(`**低位区（分位 < 30%）**：${cheap.map((s) => `${s.name} ${s.valuation.compositePct}%`).join("、") || "无"}`);
  L.push("");
  L.push(`**高位区（分位 > 70%）**：${rich.map((s) => `${s.name} ${s.valuation.compositePct}%`).join("、") || "无"}`);
  L.push("");

  L.push(`## 重点跟踪（${CONFIG.focus.join("、")}）`);
  L.push("");
  for (const code of CONFIG.focus) {
    const s = stocks.find((x) => x.code === code);
    if (!s || s.error) continue;
    L.push(`### ${s.name}（${s.code}）`);
    L.push("");
    L.push(`- 现价 ${f2(s.price)}（${sign(s.chgPct)}%）｜ 总市值 ${(s.totalCap / 1e8).toFixed(0)} 亿`);
    L.push(
      `- 历史分位 **${fp(s.valuation.compositePct)}**` +
        `（PE ${fp(s.valuation.pePct)} / PB ${fp(s.valuation.pbPct)} / PS ${fp(s.valuation.psPct)}）`
    );
    if (s.bands) {
      L.push(
        `- 加仓价 **${f2(s.bands.addPrice)}**（区间 ${f2(s.bands.addLow)} ~ ${f2(s.bands.addHigh)}）｜ ` +
          `减仓价 **${f2(s.bands.trimPrice)}**（区间 ${f2(s.bands.trimLow)} ~ ${f2(s.bands.trimHigh)}）`
      );
      L.push(
        `- 现价距加仓价 ${sign(s.bands.toAddPricePct)}% ｜ 距减仓价 ${sign(s.bands.toTrimPricePct)}%`
      );
    } else {
      L.push(`- 区间：${s.valuation.reason || "数据不足"}`);
    }
    if (s.consensus) {
      L.push(
        `- 机构预测：${s.consensus.count} 篇 ｜ 今年 EPS ${s.consensus.epsThisYear ?? "-"}` +
          ` ｜ 明年 EPS ${s.consensus.epsNextYear ?? "-"}` +
          ` ｜ 明年对应 PE ${s.consensus.peOnNextYear ?? "-"}` +
          ` ｜ 趋势 ${({ up: "上调", down: "下调", flat: "持平" })[s.consensus.revTrend] || "-"}`
      );
    }
    if (s.invalidations?.length) {
      L.push(`- **区间失效条件**：${s.invalidations.join("；")}`);
    }
    L.push("");

    const d = snap.details?.[code];
    if (d?.announcements?.length) {
      L.push(`公告（近 ${CONFIG.report.announcementLookbackDays} 天）：`);
      L.push("");
      for (const a of d.announcements) L.push(`- ${a.date} ${a.title}`);
      L.push("");
    }
    if (d?.reports?.length) {
      L.push("机构报告：");
      L.push("");
      for (const r of d.reports.slice(0, CONFIG.report.topReports)) {
        L.push(`- ${r.date}【${r.org}】${r.title}`);
      }
      L.push("");
    }
  }

  if (snap.industryReports?.length) {
    L.push("## 行业报告");
    L.push("");
    for (const r of snap.industryReports.slice(0, 8)) {
      L.push(`- ${r.date}【${r.org}】${r.title}`);
    }
    L.push("");
  }

  if (snap.catalysts?.length) {
    L.push("## 日程提醒");
    L.push("");
    for (const c of snap.catalysts) {
      L.push(`- ${c.date}（${c.daysAway} 天后）**${c.title}** — ${c.note}`);
    }
    L.push("");
  }

  L.push("---");
  L.push("");
  L.push("区间由历史估值分位反推，仅作跟踪记录，不构成投资建议。");
  L.push("");

  return L.join("\n");
}

/** 推送用的精简文案 */
export function buildPushText(snap) {
  const { sector, stocks, tradeDate } = snap;
  const cheap = stocks.filter((s) => s.valuation?.ok && s.valuation.compositePct < 30);
  const rich = stocks.filter((s) => s.valuation?.ok && s.valuation.compositePct > 70);
  const L = [];

  L.push(`**${sector.index.name} ${f2(sector.index.price)}**　${sign(sector.index.chgPct)}%`);
  L.push(
    `近5日 ${sign(sector.chg5)}%　近20日 ${sign(sector.chg20)}%　` +
      `${sector.breadth.up}涨${sector.breadth.down}跌`
  );
  L.push("");
  L.push(
    `**低位区（${cheap.length}）**　` +
      (cheap.map((s) => `${s.name} ${s.valuation.compositePct}%`).join("、") || "无")
  );
  L.push(
    `**高位区（${rich.length}）**　` +
      (rich.map((s) => `${s.name} ${s.valuation.compositePct}%`).join("、") || "无")
  );

  const focusLines = [];
  for (const code of CONFIG.focus) {
    const s = stocks.find((x) => x.code === code);
    if (!s || s.error) continue;
    focusLines.push(
      `**${s.name}** ${f2(s.price)}　分位 ${fp(s.valuation.compositePct)}　` +
        (s.bands ? `加仓 ${f2(s.bands.addPrice)} / 减仓 ${f2(s.bands.trimPrice)}` : "区间不足")
    );
  }
  if (focusLines.length) {
    L.push("");
    L.push("**重点**");
    L.push(...focusLines);
  }

  const news = [];
  for (const code of CONFIG.focus) {
    const d = snap.details?.[code];
    if (!d) continue;
    for (const a of (d.announcements || []).slice(0, 2)) {
      news.push(`${a.date} ${a.title}`);
    }
    for (const r of (d.reports || []).slice(0, 1)) {
      news.push(`${r.date}【${r.org}】${r.title}`);
    }
  }
  if (news.length) {
    L.push("");
    L.push("**新消息**");
    for (const n of news.slice(0, 5)) L.push(`- ${n}`);
  }

  if (snap.industryReports?.length) {
    L.push("");
    L.push("**行业报告**");
    for (const r of snap.industryReports.slice(0, 3)) L.push(`- 【${r.org}】${r.title}`);
  }

  return { title: `喜好跟踪 ${tradeDate}`, text: L.join("\n") };
}

/** 终端里看的宽表 */
export function renderConsoleTable(stocks) {
  const L = [];
  L.push(
    pad("名称", 12) +
      pad("代码", 8) +
      padL("现价", 9) +
      padL("涨跌%", 8) +
      padL("PE", 8) +
      padL("分位", 8) +
      padL("加仓价", 9) +
      padL("减仓价", 9) +
      "  状态"
  );
  for (const s of stocks) {
    if (s.error) {
      L.push(pad(s.name, 12) + pad(s.code, 8) + "  抓取失败: " + s.error);
      continue;
    }
    L.push(
      pad(s.name, 12) +
        pad(s.code, 8) +
        padL(f2(s.price), 9) +
        padL(sign(s.chgPct), 8) +
        padL(s.peTtm == null ? "-" : s.peTtm.toFixed(1), 8) +
        padL(fp(s.valuation?.compositePct), 8) +
        padL(s.bands ? f2(s.bands.addPrice) : "-", 9) +
        padL(s.bands ? f2(s.bands.trimPrice) : "-", 9) +
        "  " +
        statusOf(s)
    );
  }
  return L.join("\n");
}

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
const f3 = (v) => (v == null || !Number.isFinite(v) ? "-" : Number(v).toFixed(3));
const fp = (v) => (v == null || !Number.isFinite(v) ? "-" : `${v}%`);
const sign = (v) => (v == null || !Number.isFinite(v) ? "-" : v > 0 ? `+${v}` : `${v}`);
/** 港股低价股需要 3 位小数，正常的用 2 位 */
const px = (v, market) => {
  if (v == null || !Number.isFinite(v)) return "-";
  if (market === "HK") return Math.abs(v) < 10 ? v.toFixed(3) : v.toFixed(2);
  return v.toFixed(2);
};
/** 优先用 PE(TTM)，港股没有 TTM 时退回动态 PE */
const peOf = (s) => {
  const v = s.peTtm ?? s.peDyn;
  return v == null || !Number.isFinite(v) ? "-" : Number(v).toFixed(1);
};
const cap = (v) => (v ? `${(v / 1e8).toFixed(0)}亿` : "-");
const big = (v) => {
  if (v == null || !Number.isFinite(v)) return "-";
  const a = Math.abs(v);
  if (a >= 1e8) return `${(v / 1e8).toFixed(1)}亿`;
  if (a >= 1e4) return `${(v / 1e4).toFixed(1)}万`;
  return String(Math.round(v));
};
const statusOf = (s) => (s.status && s.status.label) || "-";

const METHOD_LABEL = { valuation: "估值分位", price: "价格分位" };

function stockRow(s) {
  if (s.error) return `| ${s.name} | - | - | - | - | - | - | 抓取失败 |`;
  const m = s.market === "HK" ? "HK" : "A";
  return (
    `| ${s.name}（${m}） | ${px(s.price, s.market)} | ${sign(s.chgPct)}% | ` +
    `${peOf(s)} | ` +
    `${fp(s.valuation?.compositePct)} | ${s.bands ? px(s.bands.addPrice, s.market) : "-"} | ` +
    `${s.bands ? px(s.bands.trimPrice, s.market) : "-"} | ${statusOf(s)} |`
  );
}

const TABLE_HEAD = [
  "| 名称 | 现价 | 涨跌 | PE | 历史分位 | 加仓价 | 减仓价 | 状态 |",
  "|---|---:|---:|---:|---:|---:|---:|---|",
];

/** 每日 Markdown 日报，归档到 reports/ */
export function buildMarkdown(snap) {
  const { sector, stocks = [], hkStocks = [], catalysts = {}, tradeDate } = snap;
  const L = [];

  L.push(`# 喜好跟踪 · ${tradeDate}`);
  L.push("");
  L.push(
    `> 生成时间 ${new Date(snap.generatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}` +
      `　A股 ${stocks.length} 只　港股 ${hkStocks.length} 只`
  );
  L.push("");

  L.push("## 整体概况（A股游戏板块）");
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

  L.push("## 催化剂");
  L.push("");

  const lic = catalysts.license;
  if (lic?.ok && lic.months?.length) {
    const latest = lic.months[0];
    L.push(`### 版号公示`);
    L.push("");
    L.push(`最近一次：**${latest.title}**（${latest.publishDate}，共 ${latest.total ?? "-"} 款）`);
    L.push("");
    if (lic.matched?.length) {
      L.push("跟踪范围内命中：");
      L.push("");
      for (const m of lic.matched) {
        L.push(
          `- ${m.date}　**《${m.name}》**　${m.companyName || ""}（${m.matchedField}：${m.matchedEntity}）`
        );
      }
    } else {
      L.push("最近两个月的公示里，没有匹配到跟踪范围的公司。");
    }
    L.push("");
  }

  const pipe = catalysts.pipeline || [];
  if (pipe.length) {
    L.push("### 产品管线（人工维护）");
    L.push("");
    for (const p of pipe) {
      const when =
        p.expectedDate == null
          ? "时间待定"
          : p.daysAway == null
            ? p.expectedDate
            : `${p.expectedDate}（${p.daysAway >= 0 ? `${p.daysAway} 天后` : `已过 ${-p.daysAway} 天`}）`;
      L.push(
        `- ${p.soon ? "🔔 " : ""}**${p.product}**　${p.companyName || p.company || ""}　` +
          `${p.stage || ""}　${when}${p.note ? `　${p.note}` : ""}`
      );
    }
    L.push("");
  }

  const hl = catalysts.highlights || [];
  if (hl.length) {
    L.push("### 近期动态（标题关键词扫描）");
    L.push("");
    for (const h of hl.slice(0, 12)) {
      L.push(`- ${h.date}　[${h.kind}] ${h.title}${h.tags?.length ? `　（${h.tags.join("/")}）` : ""}`);
    }
    L.push("");
  }

  L.push("## A股跟踪列表");
  L.push("");
  L.push(...TABLE_HEAD);
  for (const s of stocks) L.push(stockRow(s));
  L.push("");

  L.push("## 港股跟踪列表");
  L.push("");
  L.push("> 港股没有免费的历史估值数据，区间用「价格分位」口径（加仓价 = 近 5 年价格的 30 分位，减仓价 = 70 分位）。");
  L.push("");
  L.push(...TABLE_HEAD);
  for (const s of hkStocks) L.push(stockRow(s));
  L.push("");

  const all = [...stocks, ...hkStocks];
  const cheap = all.filter((s) => s.valuation?.ok && s.valuation.compositePct < 30);
  const rich = all.filter((s) => s.valuation?.ok && s.valuation.compositePct > 70);
  L.push("## 分区");
  L.push("");
  L.push(
    `**低位区（分位 < 30%）**：` +
      (cheap.map((s) => `${s.name} ${s.valuation.compositePct}%`).join("、") || "无")
  );
  L.push("");
  L.push(
    `**高位区（分位 > 70%）**：` +
      (rich.map((s) => `${s.name} ${s.valuation.compositePct}%`).join("、") || "无")
  );
  L.push("");

  L.push("## 重点跟踪");
  L.push("");
  const focusList = [
    ...CONFIG.focus.map((code) => stocks.find((x) => x.code === code)),
    ...(CONFIG.hkFocus || []).map((code) => hkStocks.find((x) => x.code === code)),
  ].filter(Boolean);

  for (const s of focusList) {
    if (s.error) continue;
    L.push(`### ${s.name}（${s.code}）`);
    L.push("");
    L.push(
      `- 现价 ${px(s.price, s.market)}（${sign(s.chgPct)}%）｜ 总市值 ${cap(s.totalCap)}` +
        `｜ 区间口径 ${METHOD_LABEL[s.valuation?.method] || "-"}`
    );
    L.push(`- 历史分位 **${fp(s.valuation?.compositePct)}**`);
    if (s.valuation?.pePct != null || s.valuation?.pbPct != null) {
      L.push(
        `  - PE 分位 ${fp(s.valuation.pePct)}　PB 分位 ${fp(s.valuation.pbPct)}　PS 分位 ${fp(s.valuation.psPct)}`
      );
    }
    if (s.bands) {
      L.push(
        `- 加仓价 **${px(s.bands.addPrice, s.market)}**（${px(s.bands.addLow, s.market)} ~ ${px(s.bands.addHigh, s.market)}）` +
          `｜ 减仓价 **${px(s.bands.trimPrice, s.market)}**（${px(s.bands.trimLow, s.market)} ~ ${px(s.bands.trimHigh, s.market)}）`
      );
      L.push(
        `- 现价距加仓价 ${sign(s.bands.toAddPricePct)}%　距减仓价 ${sign(s.bands.toTrimPricePct)}%`
      );
    } else {
      L.push(`- 区间：${s.valuation?.reason || "数据不足"}`);
    }
    if (s.consensus) {
      L.push(
        `- 机构预测：${s.consensus.count} 篇 ｜ 今年 EPS ${s.consensus.epsThisYear ?? "-"}` +
          ` ｜ 明年 EPS ${s.consensus.epsNextYear ?? "-"}` +
          ` ｜ 明年对应 PE ${s.consensus.peOnNextYear ?? "-"}` +
          ` ｜ 趋势 ${({ up: "上调", down: "下调", flat: "持平" })[s.consensus.revTrend] || "-"}`
      );
    }
    if (s.invalidations?.length) L.push(`- **区间失效条件**：${s.invalidations.join("；")}`);

    const prof = snap.profiles?.companies?.[s.code];
    if (prof?.products?.length) {
      L.push("");
      L.push("**产品档案**");
      if (prof.note) L.push(`> ${prof.note}`);
      L.push("");
      for (const p of prof.products) {
        const bits = [];
        if (p.type) bits.push(p.type);
        if (p.status) bits.push(p.status);
        if (p.tap) {
          bits.push(
            `TapTap ${p.tap.score ?? "-"}` +
              (p.tap.goodRate != null ? `（好评 ${p.tap.goodRate}%` : "") +
              (p.tap.reviewCount ? `，${p.tap.reviewCount} 条评价）` : p.tap.goodRate != null ? "）" : "") +
              (p.tap.labels?.length ? ` 状态 ${p.tap.labels.join("/")}` : "")
          );
          const house = p.tap.publisher || p.tap.developer;
          if (house) bits.push(`厂商 ${house}`);
          if (p.verify === "mismatch") bits.push("⚠ 厂商名对不上，归属待复核");
          if (p.tap.reserveCount) bits.push(`预约 ${big(p.tap.reserveCount)}`);
          if (p.tap.fansCount) bits.push(`关注 ${big(p.tap.fansCount)}`);
        }
        if (p.trend?.since) {
          const d = [];
          const sb = (v) => `${v > 0 ? "+" : "-"}${big(Math.abs(v))}`;
          if (p.trend.reserveDelta) d.push(`预约 ${sb(p.trend.reserveDelta)}`);
          if (p.trend.fansDelta) d.push(`关注 ${sb(p.trend.fansDelta)}`);
          if (p.trend.scoreDelta) d.push(`评分 ${p.trend.scoreDelta > 0 ? "+" : ""}${p.trend.scoreDelta}`);
          if (p.trend.reviewDelta) d.push(`评价 ${p.trend.reviewDelta > 0 ? "+" : ""}${p.trend.reviewDelta}`);
          if (d.length) bits.push(`较 ${p.trend.since}：${d.join("、")}`);
        }
        if (p.launchDate) bits.push(`上线 ${p.launchDate}${p.monthsLive != null ? `（${p.monthsLive} 个月）` : ""}`);
        if (p.expectedDate)
          bits.push(
            `预期 ${p.expectedDate}` +
              (p.daysAway != null ? `（${p.daysAway >= 0 ? `${p.daysAway} 天后` : `已过 ${-p.daysAway} 天`}）` : "")
          );
        else if (p.upcoming) bits.push("时间待定");
        L.push(`- ${p.soonDays != null ? "🔔 " : ""}**${p.name}**　${bits.join("　")}`);
        if (p.note) L.push(`  - ${p.note}`);
      }
    }
    L.push("");

    const d = snap.details?.[s.code];
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

  const cal = catalysts.calendar || [];
  if (cal.length) {
    L.push("## 日程提醒");
    L.push("");
    for (const c of cal) L.push(`- ${c.date}（${c.daysAway} 天后）**${c.title}** — ${c.note}`);
    L.push("");
  }

  L.push("---");
  L.push("");
  L.push("A 股区间由历史估值分位反推，港股区间由历史价格分位反推。仅作跟踪记录，不构成投资建议。");
  L.push("");

  return L.join("\n");
}

/** 推送用的精简文案 */
export function buildPushText(snap) {
  const { sector, stocks = [], hkStocks = [], catalysts = {}, tradeDate } = snap;
  const all = [...stocks, ...hkStocks];
  const cheap = all.filter((s) => s.valuation?.ok && s.valuation.compositePct < 30);
  const rich = all.filter((s) => s.valuation?.ok && s.valuation.compositePct > 70);
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
      `**${s.name}** ${px(s.price, s.market)}　分位 ${fp(s.valuation?.compositePct)}　` +
        (s.bands ? `加仓 ${px(s.bands.addPrice, s.market)} / 减仓 ${px(s.bands.trimPrice, s.market)}` : "区间不足")
    );
  }
  for (const code of CONFIG.hkFocus || []) {
    const s = hkStocks.find((x) => x.code === code);
    if (!s || s.error) continue;
    focusLines.push(
      `**${s.name}** ${px(s.price, "HK")}　分位 ${fp(s.valuation?.compositePct)}　` +
        (s.bands ? `加仓 ${px(s.bands.addPrice, "HK")} / 减仓 ${px(s.bands.trimPrice, "HK")}` : "区间不足")
    );
  }
  if (focusLines.length) {
    L.push("");
    L.push("**重点**");
    L.push(...focusLines);
  }

  const lic = catalysts.license;
  if (lic?.ok && lic.matched?.length) {
    L.push("");
    L.push(`**版号（${lic.months[0]?.title || ""}）**`);
    for (const m of lic.matched.slice(0, 6)) {
      L.push(`- ${m.name}${m.companyName ? ` · ${m.companyName}` : ""}`);
    }
  }

  const soon = (catalysts.pipeline || []).filter((p) => p.soon);
  if (soon.length) {
    L.push("");
    L.push("**产品管线（临近）**");
    for (const p of soon.slice(0, 6)) {
      L.push(`- ${p.product}　${p.companyName || ""}　${p.stage || ""}　${p.expectedDate || ""}`);
    }
  }

  const up = (snap.upcoming || []).slice(0, 6);
  if (up.length) {
    L.push("");
    L.push("**在测 / 待上线**");
    for (const p of up) {
      const t = p.tap ? `　TapTap ${p.tap.score ?? "-"}` : "";
      L.push(
        `- ${p.name}　${p.companyName || ""}　${p.status || ""}　` +
          `${p.expectedDate || "时间待定"}（${p.soonDays} 天后）${t}`
      );
    }
  }

  const news = [];
  for (const code of CONFIG.focus) {
    const d = snap.details?.[code];
    if (!d) continue;
    for (const a of (d.announcements || []).slice(0, 2)) news.push(`${a.date} ${a.title}`);
    for (const r of (d.reports || []).slice(0, 1)) news.push(`${r.date}【${r.org}】${r.title}`);
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
export function renderConsoleTable(stocks, market = "A") {
  const L = [];
  L.push(
    pad("名称", 12) +
      pad("代码", 8) +
      padL("现价", 10) +
      padL("涨跌%", 8) +
      padL("PE", 8) +
      padL("分位", 8) +
      padL("加仓价", 10) +
      padL("减仓价", 10) +
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
        padL(px(s.price, s.market || market), 10) +
        padL(sign(s.chgPct), 8) +
        padL(peOf(s), 8) +
        padL(fp(s.valuation?.compositePct), 8) +
        padL(s.bands ? px(s.bands.addPrice, s.market || market) : "-", 10) +
        padL(s.bands ? px(s.bands.trimPrice, s.market || market) : "-", 10) +
        "  " +
        statusOf(s)
    );
  }
  return L.join("\n");
}

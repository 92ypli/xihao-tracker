import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CONFIG } from "./config.mjs";
import { buildCatalysts } from "./calendar.mjs";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * 产品管线是人工维护的——免费数据源拿不到“某款游戏什么时候测试/上线”。
 * 文件放在 config/pipeline.json，格式见该文件里的 _schema。
 */
export function loadPipeline() {
  const candidates = [
    path.resolve(moduleDir, "..", "config", "pipeline.json"),
    path.resolve(moduleDir, "config", "pipeline.json"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const j = JSON.parse(readFileSync(p, "utf8"));
      const items = Array.isArray(j.items) ? j.items : [];
      return items
        .filter((x) => x && x.product)
        .map((x) => {
          const daysAway = x.expectedDate ? daysUntil(x.expectedDate) : null;
          return {
            ...x,
            daysAway,
            /** 预期时间在未来 horizon 天内的标记为临近 */
            soon: daysAway != null && daysAway >= 0 && daysAway <= CONFIG.catalystHorizonDays,
          };
        })
        .sort((a, b) => {
          const da = a.daysAway == null ? 9999 : a.daysAway;
          const db = b.daysAway == null ? 9999 : b.daysAway;
          return da - db;
        });
    } catch (e) {
      return [];
    }
  }
  return [];
}

/** 'YYYY-MM' 或 'YYYY-MM-DD' → 距今天数（月按当月 1 号算） */
function daysUntil(s) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(s).trim());
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = m[3] ? +m[3] : 1;
  const target = Date.UTC(y, mo - 1, d);
  const today = new Date(Date.now() + 8 * 3600 * 1000);
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((target - now) / 86400000);
}

/**
 * 从公告 / 报告标题里扫关键词，抓“近期动态”。
 * 这只是把已经发生的事实打上标签，不是预测，所以不编造日期。
 */
export function scanHighlights(details, { limitPerCompany = 3 } = {}) {
  const kws = CONFIG.catalystKeywords;
  const out = [];
  for (const [code, d] of Object.entries(details || {})) {
    const pool = [
      ...(d.announcements || []).map((a) => ({ ...a, kind: "公告" })),
      ...(d.reports || []).map((r) => ({ ...r, kind: "报告" })),
    ];
    const hit = pool.filter((x) => {
      const t = x.title || "";
      return kws.some((k) => t.includes(k));
    });
    for (const h of hit.slice(0, limitPerCompany)) {
      const matched = kws.filter((k) => (h.title || "").includes(k));
      out.push({
        code,
        kind: h.kind,
        date: h.date,
        title: h.title,
        url: h.url,
        org: h.org || null,
        tags: matched,
      });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** 组装完整的催化剂面板 */
export function buildCatalystBoard({ details, license, licenseKeywords }) {
  return {
    /** 未来日程：财报窗口、版号经验节点 */
    calendar: buildCatalysts(new Date(), CONFIG.catalystHorizonDays),
    /** 最近实际公示的版号，以及跟踪公司命中的产品 */
    license: license || null,
    /** 人工维护的产品管线 */
    pipeline: loadPipeline(),
    /** 公告 / 报告里扫到的近期动态 */
    highlights: scanHighlights(details),
  };
}

/** 构建版号匹配用的关键词表 */
export function buildLicenseKeywords(stocks, hkList) {
  const kws = [];
  const push = (code, name, words) => {
    for (const w of words) {
      const t = String(w || "").trim();
      if (t.length >= 2) kws.push({ code, name, keyword: t });
    }
  };

  for (const s of stocks || []) {
    if (!s?.name) continue;
    push(s.code, s.name, [s.name, s.name.replace(/股份|科技|网络|文化|互娱|娱乐/g, "")]);
  }
  for (const h of hkList || []) {
    push(h.code, h.name, [h.name, ...(h.aliases || [])]);
  }
  for (const e of CONFIG.license.extraAliases || []) {
    push(null, e, [e]);
  }

  // 长的关键词优先匹配，避免「心动」抢先匹配到更具体的名字
  return kws
    .filter((k, i, arr) => arr.findIndex((x) => x.keyword === k.keyword) === i)
    .sort((a, b) => b.keyword.length - a.keyword.length);
}

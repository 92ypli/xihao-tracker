/**
 * 游戏版号公示。
 *
 * 数据来自国家新闻出版署「游戏审批结果 → 国产网络游戏审批信息」，
 * 月度公告是静态 HTML，里面是一张标准表格：
 *   序号 | 名称 | 申报类别 | 出版单位 | 运营单位 | 批复文号 | 出版物号 | 批准时间
 *
 * 注意：该站点的「申报类别」列渲染有 bug，会多出一个空单元格，
 * 所以解析时从行尾往前取，不依赖固定列位。
 */

const BASE = "https://www.nppa.gov.cn/bsfw/jggs/yxspjg/gcwlyxspxx/";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function grab(url, timeout = 25000) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const strip = (s) =>
  String(s)
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

function cellsOf(tr) {
  return [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) => strip(m[1]));
}

/** 列表页 → 月度公告 */
export async function fetchLicenseMonths(limit = 2) {
  const html = await grab(BASE);
  const seen = new Set();
  const months = [];
  for (const m of html.matchAll(/href="([^"]*t(\d{4})(\d{2})(\d{2})_(\d+)\.html)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const href = m[1];
    if (seen.has(href)) continue;
    seen.add(href);
    const title = strip(m[6]);
    // 排除变更/撤销等非新增审批
    if (!/国产网络游戏审批信息/.test(title)) continue;
    months.push({
      title,
      url: new URL(href, BASE).href,
      publishDate: `${m[2]}-${m[3]}-${m[4]}`,
      month: `${m[2]}-${m[3]}`,
    });
  }
  return months.slice(0, limit);
}

/** 详情页 → 审批明细行 */
export async function fetchLicenseDetail(url) {
  const html = await grab(url, 30000);
  const rows = [];
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = cellsOf(m[1]);
    // 数据行至少 8 列，表头行第一列是「序号」
    if (cells.length < 8 || cells[0] === "序号") continue;
    const n = cells.length;
    const name = cells[1];
    if (!name) continue;
    rows.push({
      seq: cells[0],
      name,
      publisher: cells[n - 5],
      operator: cells[n - 4],
      docNo: cells[n - 3],
      isbn: cells[n - 2],
      date: cells[n - 1],
    });
  }
  return rows;
}

/** 用公司关键词匹配审批行 */
export function matchLicense(rows, keywords) {
  if (!keywords.length) return [];
  const hits = [];
  for (const r of rows) {
    const who = keywords.find(
      (k) => (r.publisher || "").includes(k.keyword) || (r.operator || "").includes(k.keyword)
    );
    if (!who) continue;
    const inPublisher = (r.publisher || "").includes(who.keyword);
    hits.push({
      ...r,
      matched: who.keyword,
      companyCode: who.code,
      companyName: who.name,
      /** 匹配到的是哪一个主体，报告里要显示这个而不是笼统的运营单位 */
      matchedField: inPublisher ? "出版单位" : "运营单位",
      matchedEntity: inPublisher ? r.publisher : r.operator,
    });
  }
  return hits;
}

/** 汇总最近若干个月的版号情况 */
export async function fetchLicense({ months = 2, keywords = [] } = {}) {
  const list = await fetchLicenseMonths(months);
  if (!list.length) return { ok: false, reason: "没有取到月度公告", months: [] };

  const out = [];
  for (const item of list) {
    try {
      const rows = await fetchLicenseDetail(item.url);
      out.push({
        ...item,
        total: rows.length,
        matched: matchLicense(rows, keywords),
      });
    } catch (e) {
      out.push({ ...item, total: null, matched: [], error: e.message });
    }
  }
  const matched = out.flatMap((m) => m.matched);
  return { ok: true, months: out, matched };
}

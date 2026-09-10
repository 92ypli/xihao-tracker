import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { fetchTapTapMany, parseTapTapId, searchTapTapCandidates } from "./taptap.mjs";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(moduleDir, "..");

function firstExisting(list) {
  return list.find((p) => existsSync(p)) || null;
}

function profilesPath() {
  return firstExisting([
    path.join(ROOT, "config", "profiles.json"),
    path.join(moduleDir, "config", "profiles.json"),
  ]);
}

function cachePath() {
  return path.join(ROOT, "data", "taptap-cache.json");
}

function trendPath() {
  return path.join(ROOT, "data", "taptap-trend.json");
}

/** 趋势文件：每个产品保留最近 30 次记录，用来算「比上次」的变化 */
const TREND_KEEP = 30;

function loadTrend() {
  const p = trendPath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function saveTrend(trend) {
  try {
    mkdirSync(path.dirname(trendPath()), { recursive: true });
    writeFileSync(trendPath(), JSON.stringify(trend, null, 2) + "\n", "utf8");
  } catch {
    /* 写趋势失败不影响主流程 */
  }
}

export function loadProfiles() {
  const p = profilesPath();
  if (!p) return { companies: {} };
  try {
    return { companies: JSON.parse(readFileSync(p, "utf8")).companies || {} };
  } catch {
    return { companies: {} };
  }
}

function loadCache() {
  const p = cachePath();
  if (!existsSync(p)) return { hits: {}, misses: {} };
  try {
    const j = JSON.parse(readFileSync(p, "utf8"));
    return { hits: j.hits || {}, misses: j.misses || {} };
  } catch {
    return { hits: {}, misses: {} };
  }
}

function saveCache(cache) {
  try {
    mkdirSync(path.dirname(cachePath()), { recursive: true });
    const sortObj = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => (a[0] < b[0] ? -1 : 1)));
    writeFileSync(
      cachePath(),
      JSON.stringify({ hits: sortObj(cache.hits), misses: sortObj(cache.misses) }, null, 2) + "\n",
      "utf8"
    );
  } catch {
    /* 写缓存失败不影响主流程 */
  }
}

/** 搜不到的记 30 天，避免每天白跑一遍 */
const MISS_TTL_DAYS = 30;

function missExpired(at) {
  if (!at) return true;
  const d = (Date.now() - new Date(at + "T00:00:00Z").getTime()) / 86400000;
  return d >= MISS_TTL_DAYS;
}

function today() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function parseYm(s) {
  return /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(s || "").trim());
}

function daysUntil(s) {
  const m = parseYm(s);
  if (!m) return null;
  const target = Date.UTC(+m[1], +m[2] - 1, m[3] ? +m[3] : 1);
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  return Math.round(
    (target - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86400000
  );
}

function monthsSince(s) {
  const m = parseYm(s);
  if (!m) return null;
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  return (now.getUTCFullYear() - +m[1]) * 12 + (now.getUTCMonth() + 1 - +m[2]);
}

const UPCOMING = new Set(["测试中", "已定档", "研发中"]);

/** TapTap 的状态标签比人工判断准，能对上就用它的 */
function statusFromTap(tap, fallback) {
  const L = (tap?.labels || []).join("");
  if (/测试|先行服|抢先|试玩/.test(L)) return "测试中";
  if (/预约|即将|定档/.test(L)) return "已定档";
  return fallback || "运营中";
}

/** 公司关键词，用于核对 TapTap 上的发行商是不是这家公司 */
function companyKeywords(profile, code) {
  const kws = [];
  const push = (s) => {
    const t = String(s || "").trim();
    if (t.length >= 2) kws.push(t);
  };
  push(profile.name);
  push(String(profile.name || "").replace(/股份|科技|网络|文化|互娱|娱乐|公司|控股|集团/g, ""));
  for (const a of profile.aliases || []) push(a);
  return kws;
}

function publisherMatches(tap, keywords) {
  if (!tap) return null;
  const text = `${tap.publisher || ""} ${tap.developer || ""} ${tap.supplier || ""} ${tap.title || ""}`;
  return keywords.some((k) => text.includes(k));
}

const normTitle = (s) => String(s || "").replace(/[\s（）()【】\-—:：·《》]/g, "").toLowerCase();

/** 产品名是否和 TapTap 标题对得上 */
function titleMatches(name, tapTitle) {
  const a = normTitle(name);
  const b = normTitle(tapTitle);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  // 「仙境传说RO2」vs「仙境传说RO：守护永恒的爱2」这类靠前缀兜底
  return a.length >= 3 && b.slice(0, 4) === a.slice(0, 4);
}

/**
 * 读取产品档案，并给每个产品补上 TapTap 数据。
 *
 * 解析顺序：档案里写死的 id → data/taptap-cache.json → 用 Bing 站内搜索找。
 * 搜到的结果会写回缓存，所以只有第一次慢，之后每天只按已知 id 抓。
 */
export async function buildProfiles({ allowSearch = true, searchBudget = 40 } = {}) {
  const { companies } = loadProfiles();
  const codes = Object.keys(companies);
  if (!codes.length) return { companies: {}, taptapFetched: 0, searched: 0, mismatched: [] };

  const cache = loadCache();
  let searched = 0;
  const needed = [];

  // 第一轮：确定每个产品的 id
  const idByName = new Map();
  for (const [code, c] of Object.entries(companies)) {
    const kws = companyKeywords(c, code);
    for (const p of c.products || []) {
      const explicit = parseTapTapId(p.taptap);
      if (explicit) {
        idByName.set(p.name, explicit);
        continue;
      }
      if (cache.hits[p.name]) {
        idByName.set(p.name, String(cache.hits[p.name]));
        continue;
      }
      if (cache.misses[p.name] && !missExpired(cache.misses[p.name])) continue;
      needed.push({ name: p.name, kws });
    }
  }

  // 第二轮：缓存里没有的，做一次搜索（有预算上限，避免首次跑太久）
  if (allowSearch) {
    for (const item of needed) {
      if (searched >= searchBudget) break;
      const { name, kws } = item;
      searched++;
      try {
        const list = await searchTapTapCandidates(name, 6);
        // 先用名字筛掉噪音（搜 FGO 会返回《战舰少女》，搜问道会返回《哈利波特》），
        // 再优先选厂商对得上的那个；厂商对不上也保留，但后面会打 ⚠ 让人复核。
        const titled = (list || []).filter((x) => titleMatches(name, x.title));
        const chosen = titled.find((x) => publisherMatches(x, kws) === true) || titled[0] || null;

        if (chosen) {
          cache.hits[name] = chosen.id;
          delete cache.misses[name];
          idByName.set(name, chosen.id);
        } else {
          cache.misses[name] = today();
        }
      } catch {
        /* 搜索失败就当没找到，下次再试 */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    saveCache(cache);
  }

  // 第三轮：批量抓详情
  const ids = [...new Set([...idByName.values()].filter(Boolean))];
  const taptap = ids.length ? await fetchTapTapMany(ids, 4) : {};

  const mismatched = [];
  const out = {};
  const trend = loadTrend();
  const todayStr = today();

  for (const [code, c] of Object.entries(companies)) {
    const kws = companyKeywords(c, code);
    const products = (c.products || []).map((p) => {
      const id = idByName.get(p.name) || null;
      const t = id ? taptap[id] : null;
      const tap = t && !t.error ? t : null;
      const d = daysUntil(p.expectedDate);

      // 核对发行商：对不上就记下来，页面上会标出来
      let verify = null;
      if (tap) {
        const ok = publisherMatches(tap, kws);
        verify = ok ? "ok" : "mismatch";
        if (!ok) mismatched.push({ code, company: c.name, product: p.name, publisher: tap.publisher || tap.developer || "-" });
      }

      // 记录当天快照并算变化（预约、关注、评分、评价数）
      let tr = null;
      if (tap) {
        const series = trend[p.name] || [];
        const row = {
          d: todayStr,
          r: tap.reserveCount ?? null,
          f: tap.fansCount ?? null,
          s: tap.score ?? null,
          c: tap.reviewCount ?? null,
        };
        const last = series[series.length - 1];
        if (last && last.d === todayStr) series[series.length - 1] = row;
        else series.push(row);
        const trimmed = series.slice(-TREND_KEEP);
        trend[p.name] = trimmed;

        const prev = trimmed.length >= 2 ? trimmed[trimmed.length - 2] : null;
        const delta = (k) =>
          prev && row[k] != null && prev[k] != null ? Math.round((row[k] - prev[k]) * 10) / 10 : null;
        tr = {
          points: trimmed.length,
          since: prev?.d || null,
          reserveDelta: delta("r"),
          fansDelta: delta("f"),
          scoreDelta: delta("s"),
          reviewDelta: delta("c"),
        };
      }

      return {
        ...p,
        status: statusFromTap(tap, p.status),
        taptapId: id,
        tap,
        trend: tr,
        verify,
        tapError: t && t.error ? t.error : null,
        daysAway: d,
        monthsLive: monthsSince(p.launchDate || tap?.launchDate),
        launchDate: p.launchDate || tap?.launchDate || null,
        upcoming: UPCOMING.has(p.status),
        soonDays: d != null && d >= 0 && d <= 90 ? d : null,
      };
    });

    const rank = (x) =>
      x.status === "测试中" ? 0 : x.status === "已定档" ? 1 : x.status === "研发中" ? 2 : 3;
    products.sort((a, b) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return (a.daysAway ?? 9999) - (b.daysAway ?? 9999);
    });

    out[code] = { name: c.name || "", aliases: c.aliases || [], note: c.note || "", products };
  }

  saveTrend(trend);

  return { companies: out, taptapFetched: ids.length, searched, mismatched };
}

/** 临近的在测 / 待上线产品 */
export function upcomingFromProfiles(profiles) {
  const out = [];
  for (const [code, c] of Object.entries(profiles.companies || {})) {
    for (const p of c.products || []) {
      if (p.soonDays != null) out.push({ code, companyName: c.name, ...p });
    }
  }
  return out.sort((a, b) => a.soonDays - b.soonDays);
}

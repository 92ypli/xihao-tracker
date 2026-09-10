const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COLLECTION = "snapshots";

/** 云开发首次使用时集合可能还不存在 */
async function ensureCollection() {
  try {
    await db.createCollection(COLLECTION);
  } catch (e) {
    // 已存在会报错，忽略；其他错误交给后续读写去暴露
  }
}

/** 列表页只需要精简字段，避免响应过大 */
function slim(s) {
  return {
    market: s.market || "A",
    code: s.code,
    name: s.name,
    price: s.price,
    chgPct: s.chgPct,
    turnover: s.turnover,
    totalCap: s.totalCap,
    peTtm: s.peTtm ?? null,
    peDyn: s.peDyn ?? null,
    pb: s.pb ?? null,
    valuation: s.valuation,
    bands: s.bands,
    status: s.status,
    error: s.error || null,
  };
}

/**
 * 抓数据 → 算分位 → 写库。
 * 由定时触发器每天收盘后调用，也可以在小程序里手动下拉刷新。
 */
async function refresh() {
  const { buildSnapshot } = await import("./lib/pipeline.mjs");
  await ensureCollection();

  const snap = await buildSnapshot();

  // 板块指数序列只需要最近 250 根，别把文档撑大
  const compact = {
    ...snap,
    sector: { ...snap.sector, series: snap.sector.series.slice(-250) },
  };

  await db.collection(COLLECTION).doc(snap.tradeDate).set({ data: compact });

  return {
    ok: true,
    tradeDate: snap.tradeDate,
    stocks: snap.stocks.length,
    hkStocks: (snap.hkStocks || []).length,
    licenseHits: snap.catalysts?.license?.matched?.length ?? 0,
    generatedAt: snap.generatedAt,
  };
}

async function latestSnapshot() {
  const res = await db.collection(COLLECTION).orderBy("tradeDate", "desc").limit(1).get();
  return res.data[0] || null;
}

/** 首页：板块温度 + A股/港股列表 + 催化剂摘要 */
async function dashboard() {
  const snap = await latestSnapshot();
  if (!snap) return { ok: false, error: "还没有数据，请先执行一次刷新" };
  const c = snap.catalysts || {};
  return {
    ok: true,
    tradeDate: snap.tradeDate,
    generatedAt: snap.generatedAt,
    focus: snap.focus || [],
    hkFocus: snap.hkFocus || [],
    sector: { ...snap.sector, series: undefined },
    stocks: (snap.stocks || []).map(slim),
    hkStocks: (snap.hkStocks || []).map(slim),
    license: c.license || null,
    pipeline: c.pipeline || [],
    highlights: (c.highlights || []).slice(0, 10),
    calendar: c.calendar || [],
  };
}

/** 单只标的详情，A股和港股都支持 */
async function stock(code) {
  const snap = await latestSnapshot();
  if (!snap) return { ok: false, error: "还没有数据" };
  const all = [...(snap.stocks || []), ...(snap.hkStocks || [])];
  const s = all.find((x) => x.code === code);
  if (!s) return { ok: false, error: "跟踪范围里没有这只" };
  return {
    ok: true,
    tradeDate: snap.tradeDate,
    stock: s,
    detail: snap.details?.[code] || null,
  };
}

/** 详情页：催化剂 + 行业报告 */
async function reports() {
  const snap = await latestSnapshot();
  if (!snap) return { ok: false, error: "还没有数据" };
  const c = snap.catalysts || {};
  const nameOf = (code) =>
    [...(snap.stocks || []), ...(snap.hkStocks || [])].find((s) => s.code === code)?.name || code;
  return {
    ok: true,
    tradeDate: snap.tradeDate,
    industryReports: snap.industryReports || [],
    license: c.license || null,
    pipeline: c.pipeline || [],
    highlights: c.highlights || [],
    calendar: c.calendar || [],
    details: Object.fromEntries(
      Object.entries(snap.details || {}).map(([k, v]) => [
        k,
        {
          name: nameOf(k),
          announcements: v.announcements || [],
          reports: (v.reports || []).slice(0, 8),
        },
      ])
    ),
  };
}

exports.main = async (event) => {
  const action = event?.action || "dashboard";
  try {
    switch (action) {
      case "refresh":
        return await refresh();
      case "dashboard":
        return await dashboard();
      case "stock":
        return await stock(event.code);
      case "reports":
        return await reports();
      default:
        return { ok: false, error: `未知 action: ${action}` };
    }
  } catch (e) {
    console.error(`[${action}] 失败`, e);
    return { ok: false, error: e.message || String(e) };
  }
};

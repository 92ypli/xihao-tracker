const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COLLECTION = "snapshots";

/** 云开发首次使用时集合可能还不存在 */
async function ensureCollection() {
  try {
    await db.createCollection(COLLECTION);
  } catch (e) {
    // -502001 已存在，其他错误交给后续读写去暴露
  }
}

/**
 * 抓数据 → 算分位 → 写库。
 * 由定时触发器每天收盘后调用，也可以在小程序里手动下拉刷新。
 */
async function refresh() {
  const { buildSnapshot } = await import("./lib/pipeline.mjs");
  await ensureCollection();

  const snap = await buildSnapshot();

  // 图表只需要最近 250 根，别把文档撑大
  const compact = {
    ...snap,
    sector: { ...snap.sector, series: snap.sector.series.slice(-250) },
  };

  await db.collection(COLLECTION).doc(snap.tradeDate).set({ data: compact });

  return {
    ok: true,
    tradeDate: snap.tradeDate,
    stocks: snap.stocks.length,
    generatedAt: snap.generatedAt,
  };
}

async function latestSnapshot() {
  const res = await db
    .collection(COLLECTION)
    .orderBy("tradeDate", "desc")
    .limit(1)
    .get();
  return res.data[0] || null;
}

/** 首页：板块温度 + 关注池 */
async function dashboard() {
  const snap = await latestSnapshot();
  if (!snap) return { ok: false, error: "还没有数据，请先执行一次刷新" };
  const { sector, stocks, tradeDate, generatedAt, focus } = snap;
  return {
    ok: true,
    tradeDate,
    generatedAt,
    focus,
    sector: { ...sector, series: undefined },
    stocks: stocks.map((s) => ({
      code: s.code,
      name: s.name,
      price: s.price,
      chgPct: s.chgPct,
      peTtm: s.peTtm,
      pb: s.pb,
      totalCap: s.totalCap,
      valuation: s.valuation,
      bands: s.bands,
      status: s.status,
      error: s.error || null,
    })),
  };
}

/** 个股详情 */
async function stock(code) {
  const snap = await latestSnapshot();
  if (!snap) return { ok: false, error: "还没有数据" };
  const s = snap.stocks.find((x) => x.code === code);
  if (!s) return { ok: false, error: "关注池里没有这只票" };
  return {
    ok: true,
    tradeDate: snap.tradeDate,
    stock: s,
    detail: snap.details?.[code] || null,
    catalysts: snap.catalysts || [],
  };
}

/** 研报与催化剂 */
async function reports() {
  const snap = await latestSnapshot();
  if (!snap) return { ok: false, error: "还没有数据" };
  return {
    ok: true,
    tradeDate: snap.tradeDate,
    industryReports: snap.industryReports || [],
    catalysts: snap.catalysts || [],
    details: Object.fromEntries(
      Object.entries(snap.details || {}).map(([k, v]) => [
        k,
        {
          name: snap.stocks.find((s) => s.code === k)?.name || k,
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

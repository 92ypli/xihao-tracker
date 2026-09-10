import { mapLimit } from "./http.mjs";
import {
  fetchBoardStocks,
  fetchBoardSnapshot,
  fetchBoardKline,
  fetchValuationHistory,
  fetchAnnouncements,
  fetchStockReports,
  fetchIndustryReports,
} from "./eastmoney.mjs";
import { fetchHkSnapshots, fetchHkKline } from "./hk.mjs";
import { fetchLicense } from "./license.mjs";
import { analyzeStock, analyzeSector, analyzeByPrice, buildConsensus, synthesizeIndex } from "./analyze.mjs";
import { buildCatalystBoard, buildLicenseKeywords } from "./catalysts.mjs";
import { CONFIG, yearsAgo, beijingToday } from "./config.mjs";

const log = (msg) => console.log(`[pipeline] ${msg}`);

/** A 股：板块 + 逐票估值历史 */
async function buildAShare({ onProgress }) {
  log("A股：拉取板块指数 / 成分股");
  const [boardSnapshot, rawStocks] = await Promise.all([
    fetchBoardSnapshot(CONFIG.board.code),
    fetchBoardStocks(CONFIG.board.code),
  ]);
  log(`A股成分股 ${rawStocks.length} 只`);
  onProgress?.(`A股 ${rawStocks.length} 只`);

  log("A股：拉取估值历史（含收盘价序列）");
  const enriched = await mapLimit(
    rawStocks,
    5,
    async (s) => {
      const history = await fetchValuationHistory(s.code, yearsAgo(CONFIG.valuation.lookbackYears));
      return { ...s, history, ps: history.at(-1)?.ps ?? null };
    },
    120
  );

  // 板块指数 K 线：东财拉不到就用成分股等权合成
  let boardKline = [];
  let synthesized = false;
  try {
    boardKline = await fetchBoardKline(CONFIG.board.code, yearsAgo(3));
  } catch (e) {
    log(`板块指数 K 线拉取失败，改用等权合成: ${e.message}`);
  }
  if (boardKline.length < 60) {
    boardKline = synthesizeIndex(enriched.filter((s) => !s.__error).map((s) => s.history));
    synthesized = boardKline.length >= 60;
    log(`等权合成指数 ${boardKline.length} 根`);
  }

  return { boardSnapshot, enriched, boardKline, synthesized };
}

/** 港股：批量快照 + 逐票日线（价格分位口径） */
async function buildHk({ onProgress }) {
  if (!CONFIG.hk?.length) return [];
  log(`港股：批量拉取 ${CONFIG.hk.length} 只快照`);
  const snaps = await fetchHkSnapshots(CONFIG.hk.map((h) => h.code));
  const byCode = new Map(snaps.map((s) => [s.code, s]));
  onProgress?.(`港股 ${snaps.length} 只`);

  log("港股：拉取日线用于价格分位");
  const results = await mapLimit(
    CONFIG.hk,
    5,
    async (meta) => {
      const snap = byCode.get(meta.code);
      if (!snap) throw new Error("快照缺失");
      const kline = await fetchHkKline(meta.code, 1400);
      const a = analyzeByPrice({ snapshot: snap, kline, bandsCfg: CONFIG.valuation.bands });
      return { ...a, name: snap.name || meta.name, aliases: meta.aliases || [] };
    },
    130
  );
  return results.map((r, i) =>
    r.__error
      ? { market: "HK", code: CONFIG.hk[i].code, name: CONFIG.hk[i].name, error: r.__error }
      : r
  );
}

/** A 股重点票的公告与报告 */
async function buildDetails() {
  if (!CONFIG.focus.length) return {};
  log(`A股：拉取重点票公告与报告 ${CONFIG.focus.join(", ")}`);
  const detailMap = {};
  await mapLimit(
    CONFIG.focus,
    3,
    async (code) => {
      const [anns, reports] = await Promise.all([
        fetchAnnouncements(code, CONFIG.report.announcementLookbackDays),
        fetchStockReports(code, yearsAgo(Math.max(1, CONFIG.report.researchLookbackMonths / 12))),
      ]);
      detailMap[code] = { announcements: anns, reports };
    },
    150
  );
  return detailMap;
}

export async function buildSnapshot({ onProgress } = {}) {
  const t0 = Date.now();

  const [{ boardSnapshot, enriched, boardKline, synthesized }, hkStocks] = await Promise.all([
    buildAShare({ onProgress }),
    buildHk({ onProgress }),
  ]);

  const detailMap = await buildDetails();
  onProgress?.("公告报告完成");

  let industryReports = [];
  try {
    industryReports = await fetchIndustryReports(CONFIG.board.industryCode, yearsAgo(0.5));
  } catch (e) {
    log(`行业报告拉取失败: ${e.message}`);
  }

  log("计算区间与分区");
  const focusSet = new Set(CONFIG.focus);
  const stocks = enriched.map((s) => {
    if (s.__error) return { code: s.code, name: s.name, price: s.price, error: s.__error };
    const detail = detailMap[s.code];
    const consensus = detail?.reports?.length ? buildConsensus(detail.reports, s.price) : null;
    return analyzeStock({
      snapshot: s,
      history: s.history,
      bandsCfg: CONFIG.valuation.bands,
      consensus,
    });
  });

  stocks.sort((a, b) => {
    const fa = focusSet.has(a.code) ? 1 : 0;
    const fb = focusSet.has(b.code) ? 1 : 0;
    if (fa !== fb) return fb - fa;
    return (a.valuation?.compositePct ?? 999) - (b.valuation?.compositePct ?? 999);
  });

  const hkFocusSet = new Set(CONFIG.hkFocus || []);
  hkStocks.sort((a, b) => {
    const fa = hkFocusSet.has(a.code) ? 1 : 0;
    const fb = hkFocusSet.has(b.code) ? 1 : 0;
    if (fa !== fb) return fb - fa;
    return (a.valuation?.compositePct ?? 999) - (b.valuation?.compositePct ?? 999);
  });

  // 版号公示
  let license = null;
  if (CONFIG.license?.enabled) {
    log("拉取版号公示");
    try {
      const keywords = buildLicenseKeywords(stocks, CONFIG.hk);
      license = await fetchLicense({ months: CONFIG.license.months, keywords });
      log(`版号：命中 ${license.matched?.length ?? 0} 条`);
    } catch (e) {
      log(`版号拉取失败: ${e.message}`);
      license = { ok: false, reason: e.message, months: [], matched: [] };
    }
  }
  onProgress?.("版号完成");

  const catalysts = buildCatalystBoard({ details: detailMap, license });
  const sector = analyzeSector(boardSnapshot, boardKline, stocks, { synthesized });
  log(`完成，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  return {
    generatedAt: new Date().toISOString(),
    /** 报告日期：北京时间今天（定时任务在收盘后跑） */
    tradeDate: beijingToday(),
    /** 价格序列的数据日期：估值接口的日线通常晚一天 */
    dataDate: boardKline.at(-1)?.date || null,
    sector,
    stocks,
    hkStocks,
    details: detailMap,
    industryReports,
    catalysts,
    focus: CONFIG.focus,
    hkFocus: CONFIG.hkFocus || [],
  };
}

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
import { analyzeStock, analyzeSector, buildConsensus, synthesizeIndex } from "./analyze.mjs";
import { CONFIG, yearsAgo, beijingToday } from "./config.mjs";
import { buildCatalysts } from "./calendar.mjs";

const log = (msg) => console.log(`[pipeline] ${msg}`);

/**
 * 拉取当日全量数据并算出分析结果。
 * 返回的对象就是小程序要展示的全部内容。
 */
export async function buildSnapshot({ onProgress } = {}) {
  const t0 = Date.now();
  const cfg = CONFIG;
  const valBegin = yearsAgo(cfg.valuation.lookbackYears);
  const reportBegin = yearsAgo(Math.max(1, cfg.report.researchLookbackMonths / 12));

  log("拉取板块指数 / 成分股");
  const [boardSnapshot, rawStocks] = await Promise.all([
    fetchBoardSnapshot(cfg.board.code),
    fetchBoardStocks(cfg.board.code),
  ]);
  log(`成分股 ${rawStocks.length} 只`);
  onProgress?.(`成分股 ${rawStocks.length} 只`);

  // 估值历史里自带 5 年日收盘价，价格位置直接用它算，省掉一次 K 线请求
  log("拉取估值历史（含收盘价序列）");
  const enriched = await mapLimit(
    rawStocks,
    5,
    async (s) => {
      const history = await fetchValuationHistory(s.code, valBegin);
      return { ...s, history, ps: history.at(-1)?.ps ?? null };
    },
    120
  );
  onProgress?.("估值分位计算完成");

  // 板块指数 K 线：东财拉不到就用成分股等权合成
  let boardKline = [];
  let synthesized = false;
  try {
    boardKline = await fetchBoardKline(cfg.board.code, yearsAgo(3));
  } catch (e) {
    log(`板块指数 K 线拉取失败，改用成分股等权合成: ${e.message}`);
  }
  if (boardKline.length < 60) {
    boardKline = synthesizeIndex(enriched.filter((s) => !s.__error).map((s) => s.history));
    synthesized = boardKline.length >= 60;
    log(`等权合成指数 ${boardKline.length} 根`);
  }

  log(`拉取重点票公告与研报: ${cfg.focus.join(", ")}`);
  const focusSet = new Set(cfg.focus);
  const detailMap = {};
  await mapLimit(
    cfg.focus,
    3,
    async (code) => {
      const [anns, reports] = await Promise.all([
        fetchAnnouncements(code, cfg.report.announcementLookbackDays),
        fetchStockReports(code, reportBegin),
      ]);
      detailMap[code] = { announcements: anns, reports };
    },
    150
  );
  onProgress?.("公告研报拉取完成");

  let industryReports = [];
  try {
    industryReports = await fetchIndustryReports(cfg.board.industryCode, yearsAgo(0.5));
  } catch (e) {
    log(`行业研报拉取失败: ${e.message}`);
  }

  log("计算估值分位与价格区间");
  const stocks = enriched.map((s) => {
    if (s.__error) {
      return { code: s.code, name: s.name, price: s.price, error: s.__error };
    }
    const detail = detailMap[s.code];
    const consensus = detail?.reports?.length ? buildConsensus(detail.reports, s.price) : null;
    return analyzeStock({
      snapshot: s,
      history: s.history,
      bandsCfg: cfg.valuation.bands,
      consensus,
    });
  });

  stocks.sort((a, b) => {
    const fa = focusSet.has(a.code) ? 1 : 0;
    const fb = focusSet.has(b.code) ? 1 : 0;
    if (fa !== fb) return fb - fa;
    return (a.valuation?.compositePct ?? 999) - (b.valuation?.compositePct ?? 999);
  });

  const sector = analyzeSector(boardSnapshot, boardKline, stocks, { synthesized });
  if (synthesized) sector.index = { ...boardSnapshot, label: "等权合成" };
  log(`完成，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  return {
    generatedAt: new Date().toISOString(),
    /** 报告日期：北京时间今天（定时任务在收盘后跑） */
    tradeDate: beijingToday(),
    /** 价格序列的数据日期：估值接口的日线通常晚一天 */
    dataDate: boardKline.at(-1)?.date || null,
    sector,
    stocks,
    details: detailMap,
    industryReports,
    focus: cfg.focus,
    catalysts: buildCatalysts(),
  };
}

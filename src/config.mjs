/** 想改跟踪范围 / 重点票 / 区间参数，只改这个文件就够了 */
export const CONFIG = {
  /** 东财行业板块：BK1046 = 游戏Ⅱ */
  board: { code: "BK1046", name: "游戏", industryCode: 1046 },

  /** 重点跟踪的票（公告、研报、深度分析只对这些票做） */
  focus: ["002555", "002517"],

  valuation: {
    /** 估值分位的回看年限 */
    lookbackYears: 5,
    /**
     * 价格区间的分位锚点：
     * 估值分位低于 addHigh 视为加仓区，高于 trimLow 视为减仓区
     */
    bands: { addLow: 15, addHigh: 30, trimLow: 70, trimHigh: 85 },
  },

  report: {
    announcementLookbackDays: 10,
    researchLookbackMonths: 12,
    topReports: 6,
  },
};

export function dateStr(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

export function yearsAgo(n) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d.toISOString().slice(0, 10);
}

/** 北京时间的今天（报告日期用这个，行情快照是当日收盘） */
export function beijingToday() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

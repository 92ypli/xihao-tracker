/**
 * 唯一需要改的配置文件。
 * 改完直接提交，GitHub Actions 下次运行就会生效。
 */

export const CONFIG = {
  /** A 股：东财行业板块 BK1046 = 游戏Ⅱ */
  board: { code: "BK1046", name: "游戏", industryCode: 1046 },

  /** A 股重点跟踪（公告、报告、深度分析只对这些做） */
  focus: ["002555", "002517"],

  /**
   * 港股游戏股。aliases 用于匹配版号公示里的运营单位/出版单位名称。
   * 港股没有免费的历史估值数据，区间用「价格分位」口径，见 analyze.mjs。
   */
  hk: [
    { code: "00700", name: "腾讯控股", aliases: ["腾讯"] },
    { code: "09999", name: "网易", aliases: ["网易"] },
    { code: "02400", name: "心动公司", aliases: ["心动"] },
    { code: "00302", name: "中手游", aliases: ["中手游"] },
    { code: "00799", name: "IGG", aliases: ["IGG"] },
    { code: "00777", name: "网龙", aliases: ["网龙", "天晴"] },
    { code: "03888", name: "金山软件", aliases: ["金山", "西山居", "wps", "金山数字"] },
    { code: "01119", name: "创梦天地", aliases: ["创梦"] },
    { code: "09990", name: "祖龙娱乐", aliases: ["祖龙"] },
    { code: "06633", name: "青瓷游戏", aliases: ["青瓷"] },
    { code: "09890", name: "贪玩", aliases: ["贪玩", "中旭"] },
    { code: "06820", name: "友谊时光", aliases: ["友谊时光"] },
    { code: "03798", name: "家乡互动", aliases: ["家乡互动"] },
    { code: "02100", name: "百奥家庭互动", aliases: ["百奥"] },
    { code: "02660", name: "禅游科技", aliases: ["禅游"] },
    { code: "09626", name: "哔哩哔哩", aliases: ["哔哩", "bilibili", "b站"] },
  ],

  /** 港股重点跟踪（会做深度分析并出现在推送里） */
  hkFocus: ["09999", "02400"],

  valuation: {
    /** A 股估值分位的回看年限 */
    lookbackYears: 5,
    /** 港股价格分位的回看年限 */
    hkLookbackYears: 5,
    /**
     * 区间锚点（分位百分数）：
     * 低于 addHigh 视为低位区，高于 trimLow 视为高位区
     */
    bands: { addLow: 15, addHigh: 30, trimLow: 70, trimHigh: 85 },
  },

  report: {
    announcementLookbackDays: 10,
    researchLookbackMonths: 12,
    topReports: 6,
  },

  /** 版号公示 */
  license: {
    enabled: true,
    /** 拉最近几个月的审批公告 */
    months: 2,
    /** 额外补充的公司名关键词，用于匹配运营单位/出版单位 */
    extraAliases: [
      "三七",
      "恺英",
      "完美世界",
      "巨人",
      "吉比特",
      "世纪华通",
      "盛趣",
      "游族",
      "掌趣",
      "电魂",
      "冰川",
      "姚记",
      "宝通",
    ],
  },

  /** 催化剂关键词：从公告/报告标题里抓“近期动态” */
  catalystKeywords: [
    "定档",
    "公测",
    "内测",
    "开测",
    "测试",
    "上线",
    "首发",
    "首曝",
    "预约",
    "版号",
    "获批",
    "拿到版号",
    "新游",
    "新品",
    "合作",
    "代理",
    "出海",
  ],

  /** 未来多少天内的日程算“临近” */
  catalystHorizonDays: 60,
};

export function yearsAgo(n) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d.toISOString().slice(0, 10);
}

/** 北京时间的今天（报告日期用这个，行情快照是当日收盘） */
export function beijingToday() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

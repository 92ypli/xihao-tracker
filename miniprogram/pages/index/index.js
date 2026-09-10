const { call } = require("../../utils/api.js");
const fmt = require("../../utils/format.js");

Page({
  data: {
    loading: true,
    syncing: false,
    error: "",
    tradeDate: "",
    sector: null,
    stocks: [],
    catalyst: null,
    sortMode: "valuation",
  },

  onLoad() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    this.setData({ error: "" });
    try {
      const r = await call("dashboard");
      const focus = r.focus || [];
      const stocks = (r.stocks || [])
        .map((s) => {
          const d = fmt.decorateStock(s);
          d.isFocus = focus.indexOf(s.code) >= 0;
          return d;
        })
        .sort(this.comparator(this.data.sortMode));
      this.setData({
        loading: false,
        tradeDate: r.tradeDate,
        sector: this.decorateSector(r.sector),
        stocks,
      });
      return r;
    } catch (e) {
      this.setData({ loading: false, error: e.message || "加载失败" });
    }
  },

  decorateSector(s) {
    if (!s) return null;
    return Object.assign({}, s, {
      chgClass: fmt.tone(s.index && s.index.chgPct),
      chgText: fmt.sign(s.index && s.index.chgPct),
      priceText: fmt.price(s.index && s.index.price),
      chg5Text: fmt.sign(s.chg5),
      chg20Text: fmt.sign(s.chg20),
      distMa60Text: fmt.sign(s.distToMa60Pct),
      distMa250Text: fmt.sign(s.distToMa250Pct),
      aboveMa250Text:
        s.trendBreadth && s.trendBreadth.ma250Total
          ? `${s.trendBreadth.aboveMa250}/${s.trendBreadth.ma250Total}`
          : "-",
      aboveMa60Text:
        s.trendBreadth && s.trendBreadth.ma60Total
          ? `${s.trendBreadth.aboveMa60}/${s.trendBreadth.ma60Total}`
          : "-",
      breadthText: s.breadth ? `${s.breadth.up}涨 ${s.breadth.down}跌` : "-",
    });
  },

  comparator(mode) {
    if (mode === "change") {
      return (a, b) => (b.chgPct || 0) - (a.chgPct || 0);
    }
    if (mode === "cap") {
      return (a, b) => (b.totalCap || 0) - (a.totalCap || 0);
    }
    // 默认按估值分位从低到高，重点票始终置顶
    return (a, b) => {
      if (a.isFocus !== b.isFocus) return a.isFocus ? -1 : 1;
      const pa = a.valuation && a.valuation.ok ? a.valuation.compositePct : 999;
      const pb = b.valuation && b.valuation.ok ? b.valuation.compositePct : 999;
      return pa - pb;
    };
  },

  onSort(e) {
    const mode = e.currentTarget.dataset.mode;
    this.setData({
      sortMode: mode,
      stocks: this.data.stocks.slice().sort(this.comparator(mode)),
    });
  },

  onStock(e) {
    wx.navigateTo({ url: `/pages/stock/stock?code=${e.currentTarget.dataset.code}` });
  },

  onReports() {
    wx.navigateTo({ url: "/pages/reports/reports" });
  },

  async onSync() {
    if (this.data.syncing) return;
    this.setData({ syncing: true });
    wx.showLoading({ title: "抓取中，约 30 秒", mask: true });
    try {
      const r = await call("refresh");
      wx.hideLoading();
      wx.showToast({ title: `已更新 ${r.stocks} 只`, icon: "success" });
      await this.load();
    } catch (e) {
      wx.hideLoading();
      wx.showModal({ title: "同步失败", content: e.message, showCancel: false });
    } finally {
      this.setData({ syncing: false });
    }
  },
});

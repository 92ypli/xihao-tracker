const { call } = require("../../utils/api.js");
const fmt = require("../../utils/format.js");

Page({
  data: {
    loading: true,
    syncing: false,
    error: "",
    tradeDate: "",
    sector: null,
    all: [],
    stocks: [],
    license: null,
    highlights: [],
    sortMode: "pct",
    market: "all",
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
      const focus = (r.focus || []).concat(r.hkFocus || []);
      const all = (r.stocks || [])
        .concat(r.hkStocks || [])
        .map((s) => {
          const d = fmt.decorateStock(s);
          d.isFocus = focus.indexOf(s.code) >= 0;
          d.isHk = s.market === "HK";
          return d;
        });
      this.setData({
        loading: false,
        tradeDate: r.tradeDate,
        sector: this.decorateSector(r.sector),
        all,
        license: r.license && r.license.ok ? r.license : null,
        highlights: (r.highlights || []).slice(0, 6),
      });
      this.applyFilter();
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

  applyFilter() {
    const { all, market, sortMode } = this.data;
    let list = all;
    if (market === "A") list = all.filter((s) => !s.isHk);
    else if (market === "HK") list = all.filter((s) => s.isHk);
    else if (market === "focus") list = all.filter((s) => s.isFocus);
    this.setData({ stocks: list.slice().sort(this.comparator(sortMode)) });
  },

  comparator(mode) {
    if (mode === "chg") return (a, b) => (b.chgPct || 0) - (a.chgPct || 0);
    if (mode === "cap") return (a, b) => (b.totalCap || 0) - (a.totalCap || 0);
    return (a, b) => {
      if (a.isFocus !== b.isFocus) return a.isFocus ? -1 : 1;
      const pa = a.valuation && a.valuation.ok ? a.valuation.compositePct : 999;
      const pb = b.valuation && b.valuation.ok ? b.valuation.compositePct : 999;
      return pa - pb;
    };
  },

  onSort(e) {
    this.setData({ sortMode: e.currentTarget.dataset.mode });
    this.applyFilter();
  },

  onMarket(e) {
    this.setData({ market: e.currentTarget.dataset.mode });
    this.applyFilter();
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
    wx.showLoading({ title: "抓取中，约 40 秒", mask: true });
    try {
      const r = await call("refresh");
      wx.hideLoading();
      wx.showToast({
        title: `已更新 ${r.stocks}+${r.hkStocks} 只`,
        icon: "success",
      });
      await this.load();
    } catch (e) {
      wx.hideLoading();
      wx.showModal({ title: "同步失败", content: e.message, showCancel: false });
    } finally {
      this.setData({ syncing: false });
    }
  },
});

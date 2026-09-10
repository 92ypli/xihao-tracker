const { call } = require("../../utils/api.js");
const fmt = require("../../utils/format.js");

Page({
  data: {
    loading: true,
    error: "",
    code: "",
    tradeDate: "",
    stock: null,
    announcements: [],
    reports: [],
    barStyle: "",
  },

  onLoad(options) {
    this.setData({ code: options.code || "" });
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    try {
      const r = await call("stock", { code: this.data.code });
      const s = fmt.decorateStock(r.stock);
      const pct =
        s.valuation && s.valuation.ok
          ? Math.max(0, Math.min(100, s.valuation.compositePct))
          : null;

      const pc = r.stock.priceContext;
      const detail = r.detail || {};

      this.setData({
        loading: false,
        tradeDate: r.tradeDate,
        stock: Object.assign(s, {
          capText: fmt.cap(s.totalCap),
          turnoverText: fmt.pct(s.turnover),
          pricePctText: pc ? fmt.pct(pc.pricePct) : "-",
          ma60Text: pc ? fmt.priceOf(pc.ma60, s.market) : "-",
          ma250Text: pc ? fmt.priceOf(pc.ma250, s.market) : "-",
          low250Text: pc ? fmt.priceOf(pc.low250, s.market) : "-",
          high250Text: pc ? fmt.priceOf(pc.high250, s.market) : "-",
          aboveMa250: pc && pc.ma250 ? s.price >= pc.ma250 : null,
          consensusText: this.consensusText(s.consensus),
          revTrendText: this.revTrendText(s.consensus),
        }),
        announcements: detail.announcements || [],
        reports: (detail.reports || []).slice(0, 10),
        barStyle: pct === null ? "" : `left:${pct}%`,
      });
    } catch (e) {
      this.setData({ loading: false, error: e.message });
    }
  },

  consensusText(c) {
    if (!c || !c.count) return "暂无覆盖";
    const parts = [`${c.count} 篇研报`];
    if (c.epsThisYear) parts.push(`今年 EPS ${c.epsThisYear}`);
    if (c.epsNextYear) parts.push(`明年 EPS ${c.epsNextYear}`);
    return parts.join(" · ");
  },

  revTrendText(c) {
    if (!c || !c.revTrend) return "持平";
    return { up: "上调", down: "下调", flat: "持平" }[c.revTrend] || "持平";
  },

  onCopy(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: "链接已复制", icon: "none" }),
    });
  },
});

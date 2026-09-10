const { call } = require("../../utils/api.js");

Page({
  data: {
    loading: true,
    error: "",
    tradeDate: "",
    catalysts: [],
    industryReports: [],
    groups: [],
  },

  onLoad() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    try {
      const r = await call("reports");
      const groups = Object.keys(r.details || {}).map((code) => {
        const g = r.details[code];
        return {
          code,
          name: g.name,
          announcements: g.announcements || [],
          reports: g.reports || [],
        };
      });
      this.setData({
        loading: false,
        tradeDate: r.tradeDate,
        catalysts: (r.catalysts || []).map((c) =>
          Object.assign({}, c, {
            awayText: c.daysAway === 0 ? "今天" : `${c.daysAway} 天后`,
          })
        ),
        industryReports: r.industryReports || [],
        groups,
      });
    } catch (e) {
      this.setData({ loading: false, error: e.message });
    }
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

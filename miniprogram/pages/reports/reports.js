const { call } = require("../../utils/api.js");

Page({
  data: {
    loading: true,
    error: "",
    tradeDate: "",
    license: null,
    pipeline: [],
    highlights: [],
    calendar: [],
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
        license: r.license && r.license.ok ? r.license : null,
        pipeline: (r.pipeline || []).map((p) =>
          Object.assign({}, p, { whenText: this.whenText(p) })
        ),
        highlights: r.highlights || [],
        calendar: (r.calendar || []).map((c) =>
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

  whenText(p) {
    if (!p.expectedDate) return "时间待定";
    if (p.daysAway == null) return p.expectedDate;
    return p.daysAway >= 0
      ? `${p.expectedDate}（${p.daysAway} 天后）`
      : `${p.expectedDate}（已过 ${-p.daysAway} 天）`;
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

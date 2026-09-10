const config = require("./config.js");

App({
  globalData: { ready: false },

  onLaunch() {
    if (!wx.cloud) {
      wx.showModal({
        title: "基础库版本过低",
        content: "请在开发者工具里把调试基础库调到 2.2.3 以上",
        showCancel: false,
      });
      return;
    }
    const opts = { traceUser: true };
    if (config.cloudEnv) opts.env = config.cloudEnv;
    wx.cloud.init(opts);
    this.globalData.ready = true;
  },
});

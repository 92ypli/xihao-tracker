function call(action, payload = {}) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: "api",
      data: Object.assign({ action }, payload),
      success(res) {
        const r = res && res.result;
        if (r && r.ok) resolve(r);
        else reject(new Error((r && r.error) || "云函数返回异常"));
      },
      fail(err) {
        reject(new Error((err && err.errMsg) || "网络异常"));
      },
    });
  });
}

module.exports = { call };

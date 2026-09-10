const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/**
 * 东财 push2 主域名在部分网络下会直接断连（UND_ERR_SOCKET），做多域名回退。
 */
const QUOTE_HOSTS = [
  "https://push2delay.eastmoney.com",
  "https://push2.eastmoney.com",
  "https://82.push2.eastmoney.com",
];
const HIST_HOSTS = [
  "https://push2his.eastmoney.com",
  "https://push2delay.eastmoney.com",
];
const DC_HOSTS = ["https://datacenter-web.eastmoney.com"];

async function rawFetch(url, { timeout = 20000, headers } = {}) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Referer: "https://quote.eastmoney.com/",
      ...(headers || {}),
    },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

async function fetchJsonFrom(hosts, path, timeout) {
  let lastErr;
  for (const host of hosts) {
    try {
      const res = await rawFetch(host + path, { timeout });
      const text = await res.text();
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`${lastErr?.message || "unknown"} @ ${path.slice(0, 60)}`);
}

export const quoteJson = (path, timeout) => fetchJsonFrom(QUOTE_HOSTS, path, timeout);
export const histJson = (path, timeout) => fetchJsonFrom(HIST_HOSTS, path, timeout);
export const dataJson = (path, timeout) => fetchJsonFrom(DC_HOSTS, path, timeout);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 限量并发，避免把对端打挂；单个失败不影响整体 */
export async function mapLimit(items, limit, fn, gapMs = 100) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        out[i] = await fn(items[i], i);
      } catch (e) {
        out[i] = { __error: e.message };
      }
      if (gapMs) await sleep(gapMs);
    }
  });
  await Promise.all(workers);
  return out;
}

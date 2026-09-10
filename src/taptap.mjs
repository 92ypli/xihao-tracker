/**
 * TapTap 产品数据。
 *
 * 用 TapTap 的 webapi 详情接口，一次返回：
 *   - stat.rating.score     评分（满分 10）
 *   - stat.review_count     评价数
 *   - stat.fans_count       关注数
 *   - stat.vote_info        1~5 星分布
 *   - title_labels          「测试」「先行服」「预约」等状态标签
 *
 * 注意：TapTap 没有可用的搜索接口（前端全客户端渲染），
 * 所以只能按已知的 app id 查。id 在 TapTap 里打开产品页，
 * 地址栏 /app/ 后面那串数字就是。
 */

const XUA =
  "V=1&PN=WebApp&LANG=zh_CN&VN_CODE=102&LOC=CN&PLT=PC&DS=Android&UID=&OS=Windows&OSV=10";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept-Language": "zh-CN,zh;q=0.9",
  Referer: "https://www.taptap.cn/",
};

/** 从 id 或各种 TapTap 链接里取出纯数字 id */
export function parseTapTapId(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (/^\d{3,9}$/.test(s)) return s;
  const m = s.match(/\/app\/(\d{3,9})/);
  return m ? m[1] : null;
}

export async function fetchTapTap(id) {
  const nid = parseTapTapId(id);
  if (!nid) throw new Error(`无效的 TapTap id: ${id}`);
  const url = `https://www.taptap.cn/webapiv2/app/v4/detail?id=${nid}&X-UA=${encodeURIComponent(XUA)}`;
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const a = j?.data;
  if (!a || !a.title) throw new Error("TapTap 返回为空");

  const votes = a.stat?.vote_info || {};
  const voteTotal = Object.values(votes).reduce((x, y) => x + (Number(y) || 0), 0);
  // 4~5 星占比，作为「好评率」的粗略代理
  const good = (Number(votes["5"]) || 0) + (Number(votes["4"]) || 0);

  // 发行 / 开发 / 上线日期藏在 information 里。
  // 注意字段名不统一：有的产品用「发行」，有的用「厂商」。
  const info = a.information || [];
  const pick = (re) => info.find((x) => re.test(x.title || ""))?.text || null;
  const publisher = pick(/^(发行|厂商|发行商)$/);
  const developer = pick(/^(开发|研发|开发商)$/);
  const supplier = pick(/供应商/);
  const launchText = pick(/正式上线日期|上线日期/);
  const launchDate = launchText
    ? (/^(\d{4})-(\d{2})/.exec(launchText) || []).slice(1, 3).join("-") || null
    : null;

  return {
    id: nid,
    title: a.title,
    labels: a.title_labels || [],
    publisher,
    developer,
    supplier,
    launchDate,
    score: a.stat?.rating?.score ? Number(a.stat.rating.score) : null,
    maxScore: a.stat?.rating?.max ?? 10,
    latestScore: a.stat?.rating?.latest_score && a.stat.rating.latest_score !== "0"
      ? Number(a.stat.rating.latest_score)
      : null,
    reviewCount: a.stat?.review_count ?? null,
    fansCount: a.stat?.fans_count ?? null,
    reserveCount: a.stat?.reserve_count ?? null,
    voteTotal,
    goodRate: voteTotal ? Math.round((good / voteTotal) * 1000) / 10 : null,
    tags: (a.tags || []).map((t) => t.value || t).slice(0, 5),
    url: `https://www.taptap.cn/app/${nid}`,
  };
}

/**
 * 按名字找 TapTap id。
 *
 * TapTap 自己没有可用的搜索接口（前端全客户端渲染），
 * 所以借 Bing 的站内搜索：site:taptap.cn <名字>，从结果 URL 里抠出 /app/<id>。
 */
export async function searchTapTapId(name) {
  // 查询式换几种，Bing 对 site: 后接路径的写法时好时坏
  const queries = [`site:taptap.cn ${name}`, `site:taptap.cn/app ${name}`, `taptap ${name} 评分`];
  const seen = new Set();
  const ids = [];
  for (const q of queries) {
    if (ids.length >= 6) break;
    try {
      const res = await fetch(`https://cn.bing.com/search?q=${encodeURIComponent(q)}`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      for (const m of html.matchAll(/taptap\.cn\/app\/(\d{3,9})/g)) {
        if (!seen.has(m[1])) {
          seen.add(m[1]);
          ids.push(m[1]);
        }
      }
    } catch {
      /* 换下一个查询式 */
    }
    if (ids.length) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!ids.length) return null;

  // 逐个核对标题，避免抓到不相关的页面
  const norm = (s) => String(s || "").replace(/[\s（）()【】\-—:：]/g, "").toLowerCase();
  const target = norm(name);
  for (const id of ids.slice(0, 4)) {
    try {
      const d = await fetchTapTap(id);
      const t = norm(d.title);
      if (t.includes(target) || target.includes(t) || (target.length >= 3 && t.slice(0, 4) === target.slice(0, 4))) {
        return d;
      }
    } catch {
      /* 换下一个 */
    }
  }
  return null;
}

/** 批量取，限量并发 */
export async function fetchTapTapMany(ids, limit = 4) {
  const out = {};
  const queue = [...ids];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (;;) {
      const id = queue.shift();
      if (!id) return;
      const nid = parseTapTapId(id);
      if (!nid) continue;
      try {
        out[nid] = await fetchTapTap(nid);
      } catch (e) {
        out[nid] = { id: nid, error: e.message };
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  });
  await Promise.all(workers);
  return out;
}

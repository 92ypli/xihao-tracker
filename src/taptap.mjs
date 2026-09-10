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

  return {
    id: nid,
    title: a.title,
    labels: a.title_labels || [],
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

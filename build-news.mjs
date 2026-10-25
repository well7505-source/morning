// 언론사 RSS를 받아 news.json 으로 만들어 둔다.
// GitHub Actions 가 주기적으로 실행하므로, 페이지는 중계 서버 없이
// 자기 주소에서 news.json 하나만 읽으면 된다.
import { writeFileSync, readFileSync, existsSync } from "node:fs";

const FEEDS = {
  eco: [
    { url: "https://www.hankyung.com/feed/economy", source: "한국경제" },
    { url: "https://www.yna.co.kr/rss/economy.xml", source: "연합뉴스" },
  ],
  top: [
    { url: "https://www.yna.co.kr/rss/news.xml", source: "연합뉴스" },
  ],
};

const UA = "Mozilla/5.0 (compatible; morning-start-page/1.0; +https://well7505-source.github.io/morning/)";

function unwrap(s) {
  return (s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? unwrap(m[1]) : "";
}

function parseRss(xml) {
  const out = [];
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const block of items) {
    const title = tag(block, "title");
    const link = tag(block, "link");
    const date = tag(block, "pubDate") || tag(block, "dc:date");
    if (title && /^https?:\/\//.test(link)) {
      out.push({ title, link, date: date ? new Date(date).toISOString() : "" });
    }
  }
  return out;
}

async function fetchFeed({ url, source }) {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "application/rss+xml, application/xml, text/xml, */*" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = parseRss(await res.text()).map((it) => ({ ...it, source }));
    console.log(`${source} (${url}) — ${items.length}건`);
    return items;
  } catch (err) {
    console.error(`${source} (${url}) 실패: ${err.message}`);
    return [];
  }
}

async function group(feeds, limit) {
  const lists = await Promise.all(feeds.map(fetchFeed));
  const seen = new Set();
  const merged = [];
  for (const list of lists) {
    for (const it of list) {
      const key = it.title.replace(/\s+/g, "");
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(it);
    }
  }
  merged.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  return merged.slice(0, limit);
}

const eco = await group(FEEDS.eco, 14);
const top = await group(FEEDS.top, 12);

// 두 칸 모두 연합뉴스를 쓰므로, 경제에 실린 기사는 종합에서 뺀다
const ecoLinks = new Set(eco.map((it) => it.link));

// 전부 실패했다면 기존 파일을 지우지 않는다 (오래된 기사가 빈 화면보다 낫다)
if (!eco.length && !top.length) {
  console.error("모든 피드 실패 — news.json 을 그대로 둡니다");
  if (!existsSync("news.json")) {
    writeFileSync("news.json", JSON.stringify({ updated: null, eco: [], top: [] }, null, 1));
  }
  process.exit(0);
}

const payload = {
  updated: new Date().toISOString(),
  eco,
  top: top.filter((it) => !ecoLinks.has(it.link)),
};

const next = JSON.stringify(payload, null, 1);
const prev = existsSync("news.json") ? readFileSync("news.json", "utf8") : "";

// 기사 목록이 같으면 (시각만 다르면) 커밋하지 않는다
const strip = (s) => s.replace(/"updated":\s*"[^"]*",?/, "");
if (strip(prev) === strip(next)) {
  console.log("바뀐 기사 없음");
  process.exit(0);
}

writeFileSync("news.json", next);
console.log(`news.json 갱신 — 경제 ${payload.eco.length}건, 종합 ${payload.top.length}건`);

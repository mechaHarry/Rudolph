const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadApp() {
  const document = {
    body: {
      classList: { contains: () => false, add: () => {}, toggle: () => {} },
      className: '',
      appendChild: () => {},
      style: {}
    },
    addEventListener: () => {},
    querySelector: () => null,
    createElement: () => ({ className: '', style: {}, classList: { add: () => {}, remove: () => {} } }),
    getElementById: () => ({
      style: {}, innerHTML: '', textContent: '', className: '',
      classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} },
      addEventListener: () => {}, getContext: () => ({})
    })
  };
  const context = {
    Chart: function Chart() {},
    GridStack: { init: () => null },
    URL,
    clearInterval: () => {},
    console,
    document,
    fetch: async () => ({ ok: false }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    location: { reload: () => {} },
    module: { exports: {} },
    requestAnimationFrame: (callback) => callback(),
    setInterval: () => 0,
    setTimeout: (callback) => { if (typeof callback === 'function') callback(); return 0; },
    window: { innerWidth: 1200, innerHeight: 800 }
  };
  context.global = context;
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8'),
    context,
    { filename: 'js/app.js' }
  );
  return context.module.exports;
}

test('safeHttpsUrl permits only absolute HTTPS URLs', () => {
  const app = loadApp();

  assert.equal(app.safeHttpsUrl('https://news.example.test/story'), 'https://news.example.test/story');
  assert.equal(app.safeHttpsUrl('http://news.example.test/story'), '');
  assert.equal(app.safeHttpsUrl('javascript:alert(1)'), '');
  assert.equal(app.safeHttpsUrl('data:text/html,unsafe'), '');
  assert.equal(app.safeHttpsUrl('/relative-story'), '');
  assert.equal(app.safeHttpsUrl(null), '');
});

test('normalizeNewsItems handles malformed data, deduplicates links, and caps results', () => {
  const app = loadApp();
  const valid = Array.from({ length: 14 }, (_, index) => ({
    title: `Public headline ${index}`,
    link: `https://news.example.test/${index}`,
    description: `Summary ${index}`,
    publisher: 'Public Wire',
    providerPublishTime: 1_700_000_000 + index,
    thumbnail: {
      resolutions: [
        { url: `https://images.example.test/${index}-small.jpg`, width: 80 },
        { url: `https://images.example.test/${index}-medium.jpg`, width: 200 }
      ]
    }
  }));
  valid.push({ title: 'Duplicate', link: 'https://news.example.test/0' });
  valid.push({ title: 'Unsafe', link: 'javascript:alert(1)' });
  valid.push({ title: '', link: 'https://news.example.test/blank' });

  const items = app.normalizeNewsItems({ news: valid });

  assert.equal(items.length, 12);
  assert.equal(items[0].summary, 'Summary 13');
  assert.equal(items[0].thumbnail, 'https://images.example.test/13-medium.jpg');
  assert.equal(new Set(items.map((item) => item.link)).size, items.length);
  assert.ok(items.every((item) => item.link.startsWith('https://')));
});

test('normalizeNewsItems accepts a larger bounded page for load-more requests', () => {
  const app = loadApp();
  const news = Array.from({ length: 30 }, (_, index) => ({
    title: `Headline ${index}`,
    link: `https://news.example.test/load-more/${index}`
  }));

  assert.equal(app.normalizeNewsItems({ news }, 24).length, 24);
  assert.equal(app.normalizeNewsItems({ news }, 100).length, 30);
});

test('normalizeNewsItems sorts newest first and places invalid dates last', () => {
  const app = loadApp();
  const items = app.normalizeNewsItems({ news: [
    { title: 'No date', link: 'https://news.example.test/no-date', providerPublishTime: -1 },
    { title: 'Older', link: 'https://news.example.test/older', providerPublishTime: 100 },
    { title: 'Newest', link: 'https://news.example.test/newest', providerPublishTime: 300 },
    { title: 'Same time', link: 'https://news.example.test/same', providerPublishTime: 300 }
  ] });

  assert.deepEqual(Array.from(items, (item) => item.title), ['Newest', 'Same time', 'Older', 'No date']);
  assert.equal(app.normalizeNewsTimestamp(-1), 0);
  assert.equal(app.normalizeNewsTimestamp('not-a-date'), 0);
});

test('normalizeNewsItems supports nested canonical URLs and title-only cards', () => {
  const app = loadApp();
  const items = app.normalizeNewsItems({
    news: [{
      title: 'Title only',
      canonicalUrl: { url: 'https://news.example.test/title-only' },
      thumbnail: { resolutions: [{ url: 'http://images.example.test/unsafe.jpg', width: 300 }] }
    }]
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].summary, '');
  assert.equal(items[0].thumbnail, '');
});

test('Google News RSS archive provides older sanitized stories beyond the Yahoo prefix', () => {
  const app = loadApp();
  const items = Array.from({ length: 30 }, (_, index) =>
    `<item><title>Archive story ${index} - Public Wire</title>` +
    `<link>https://news.google.com/rss/articles/${index}?oc=5&amp;hl=en-US</link>` +
    `<pubDate>${new Date(1_700_000_000_000 - index * 60_000).toUTCString()}</pubDate>` +
    `<source url="https://publisher.example.test">Public Wire</source></item>`
  ).join('');
  const parsed = app.normalizeGoogleNewsRss(`<rss><channel>${items}</channel></rss>`, 100);

  assert.equal(parsed.length, 30);
  assert.equal(parsed[0].title, 'Archive story 0');
  assert.equal(parsed[0].publisher, 'Public Wire');
  assert.match(parsed[0].link, /^https:\/\/news\.google\.com\//);
});

test('Google News results enrich matching archive stories with actual thumbnails', () => {
  const app = loadApp();
  const html = '<a class="JtKRv" href="./read/1">Archive story 1</a>' +
    '<div class="story-copy"></div><figure><img alt="" src="/api/attachments/story-1-w200-h112"></figure>';
  const thumbnails = app.normalizeGoogleNewsHtmlThumbnails(html);
  const enriched = app.applyArchiveThumbnails([
    { title: 'Archive story 1', thumbnail: '' },
    { title: 'No image story', thumbnail: '' }
  ], thumbnails);

  assert.equal(enriched[0].thumbnail, 'https://news.google.com/api/attachments/story-1-w200-h112');
  assert.equal(enriched[1].thumbnail, '');
});

test('archive merge keeps richer latest cards and adds unique older headlines', () => {
  const app = loadApp();
  const latest = [{ title: 'Same story', link: 'https://latest.example.test/1', publishedAt: 300, thumbnail: 'https://images.example.test/1.jpg' }];
  const archive = [
    { title: 'Same story', link: 'https://archive.example.test/duplicate', publishedAt: 300, thumbnail: '' },
    { title: 'Older story', link: 'https://archive.example.test/older', publishedAt: 100, thumbnail: '' }
  ];
  const merged = app.mergeNewsItems(latest, archive);

  assert.deepEqual(Array.from(merged, (item) => item.title), ['Same story', 'Older story']);
  assert.equal(merged[0].thumbnail, 'https://images.example.test/1.jpg');
});

test('pagination preserves the visible prefix and appends only unseen stories', () => {
  const app = loadApp();
  const visible = [
    { title: 'Current A', link: 'https://news.example.test/a' },
    { title: 'Current B', link: 'https://news.example.test/b' }
  ];
  const merged = [
    { title: 'Updated B', link: 'https://news.example.test/b' },
    { title: 'Older C', link: 'https://news.example.test/c' }
  ];

  assert.deepEqual(
    JSON.parse(JSON.stringify(app.preserveNewsPrefix(visible, merged))),
    [visible[0], visible[1], merged[1]]
  );

  const olderOnly = app.olderNewsItemsForAppend(
    [{ link: 'https://news.example.test/tail', publishedAt: 1_700_000_000 }],
    [
      { link: 'https://news.example.test/newer', publishedAt: 1_700_000_001 },
      { link: 'https://news.example.test/older', publishedAt: 1_699_999_999 },
      { link: 'https://news.example.test/unknown', publishedAt: 0 }
    ]
  );
  assert.deepEqual(Array.from(olderOnly, (item) => item.link), [
    'https://news.example.test/older',
    'https://news.example.test/unknown'
  ]);
});

test('news date labels distinguish today, yesterday, and earlier dates', () => {
  const app = loadApp();
  const reference = new Date(2026, 6, 9, 12, 0, 0);
  const today = new Date(2026, 6, 9, 8, 30, 0).getTime() / 1000;
  const yesterday = new Date(2026, 6, 8, 18, 0, 0).getTime() / 1000;
  const earlier = new Date(2026, 6, 6, 18, 0, 0).getTime() / 1000;

  assert.equal(app.newsDateGroupLabel(today, reference.getTime()), 'Today');
  assert.equal(app.newsDateGroupLabel(yesterday, reference.getTime()), 'Yesterday');
  assert.match(app.newsDateGroupLabel(earlier, reference.getTime()), /Monday, Jul 6/);
  assert.equal(app.newsDateKey(0), 'earlier');
});

test('load more triggers only near the scroll boundary while more data is available', () => {
  const app = loadApp();

  assert.equal(app.shouldLoadMoreNews({ scrollTop: 600, clientHeight: 400, scrollHeight: 1050, hasMore: true }), true);
  assert.equal(app.shouldLoadMoreNews({ scrollTop: 100, clientHeight: 400, scrollHeight: 1050, hasMore: true }), false);
  assert.equal(app.shouldLoadMoreNews({ scrollTop: 600, clientHeight: 400, scrollHeight: 1050, hasMore: false }), false);
  assert.equal(app.shouldLoadMoreNews({ scrollTop: 600, clientHeight: 400, scrollHeight: 1050, hasMore: true, loading: true }), false);
});

test('news refresh eligibility conserves work while hidden, recent, or in flight', () => {
  const app = loadApp();
  const interval = 300_000;

  assert.equal(app.shouldRefreshNews({ hidden: true, now: interval, interval }), false);
  assert.equal(app.shouldRefreshNews({ loading: true, now: interval, interval }), false);
  assert.equal(app.shouldRefreshNews({ lastFetchAt: 100, now: 100 + interval - 1, interval }), false);
  assert.equal(app.shouldRefreshNews({ lastFetchAt: 100, now: 100 + interval, interval }), true);
});

test('both extension entrypoints include the same accessible news sidebar', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const newtab = fs.readFileSync(path.join(__dirname, '..', 'newtab.html'), 'utf8');
  const sidebarPattern = /<div class="dashboard-shell"[\s\S]*?<\/aside>[\s\S]*?<main class="grid-stack"/;
  const indexSidebar = index.match(sidebarPattern);
  const newtabSidebar = newtab.match(sidebarPattern);

  assert.ok(indexSidebar);
  assert.ok(newtabSidebar);
  assert.equal(indexSidebar[0], newtabSidebar[0]);
  assert.match(index, /id="news-feed" aria-live="polite" aria-busy="true"/);
  assert.match(index, /Market news &middot; Live 5m/);
  assert.match(index, /id="news-refresh-btn" class="news-refresh-btn"[\s\S]*aria-controls="news-feed" aria-busy="false">Refresh Feed<\/button>/);
  assert.doesNotMatch(index, /news-scroll-refresh|Pull down to refresh|Release to refresh/);
  assert.doesNotMatch(index, /news-side-toggle|Move news sidebar/);
});

test('news sidebar CSS stays left and supports refresh, skeletons, and focus', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');

  assert.match(css, /\.dashboard-shell \.news-sidebar\s*\{ order: 0; \}/);
  assert.match(css, /\.dashboard-shell main\.grid-stack\s*\{ order: 1; \}/);
  assert.doesNotMatch(css, /sidebar-left|news-side-toggle/);
  assert.match(css, /\.news-card:focus-visible/);
  assert.match(css, /\.news-card-skeleton/);
  assert.match(css, /\.news-date-separator/);
  assert.match(css, /\.news-load-more-btn/);
  assert.match(css, /\.news-card\s*\{[\s\S]*grid-template-columns:\s*80px minmax\(0, 1fr\);[\s\S]*padding:\s*10px;[\s\S]*overflow:\s*hidden;/);
  assert.match(css, /\.news-thumbnail\s*\{[\s\S]*width:\s*80px;[\s\S]*height:\s*58px;[\s\S]*align-self:\s*start;/);
  assert.match(css, /\.news-thumbnail-placeholder::before\s*\{[\s\S]*background:\s*#8b9098;[\s\S]*icon128\.png/);
  assert.match(css, /\.news-refresh-btn\s*\{[\s\S]*color:\s*var\(--accent\);/);
  assert.match(css, /\.news-refresh-btn:disabled\s*\{[\s\S]*cursor:\s*progress;/);
  assert.match(css, /\.rainbow-red\s*\{ fill: #ef4444; \}/);
  assert.match(css, /\.rainbow-orange\s*\{ fill: #f97316; \}/);
  assert.match(css, /\.rainbow-yellow\s*\{ fill: #facc15; \}/);
  assert.match(css, /\.rainbow-green\s*\{ fill: #22c55e; \}/);
  assert.match(css, /\.rainbow-blue\s*\{ fill: #3b82f6; \}/);
  assert.match(css, /\.rainbow-indigo\s*\{ fill: #4f46e5; \}/);
  assert.match(css, /\.rainbow-violet\s*\{ fill: #a855f7; \}/);
  assert.doesNotMatch(css, /news-scroll-refresh|pull-progress/);
  assert.match(css, /\.news-feed\s*\{[\s\S]*flex:\s*1 1 auto;/);
  assert.match(css, /\.news-sidebar\s*\{[\s\S]*margin:\s*var\(--grid-edge-offset\);/);
});

test('refresh button reloads latest stories and bottom scrolling loads the RSS archive', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

  assert.match(source, /function setNewsRefreshButtonLoading\(loading\)[\s\S]*button\.disabled = !!loading;[\s\S]*Refreshing…/);
  assert.match(source, /refreshButton\.addEventListener\('click'[\s\S]*manualRefresh: true/);
  assert.match(source, /manualVisibleCount = options\.manualRefresh \? newsVisibleCount/);
  assert.match(source, /options\.manualRefresh \? \{[\s\S]*mergeExisting: true,[\s\S]*visibleCount: manualVisibleCount/);
  assert.match(source, /if \(manualFeed\) manualFeed\.scrollTop = manualScrollTop/);
  assert.match(source, /feed\.addEventListener\('scroll',[\s\S]*loadMoreNewsIfNeeded\(feed\)/);
  assert.match(source, /function appendVisibleNewsItems[\s\S]*append: true[\s\S]*previousDateKey/);
  assert.match(source, /feed\.insertBefore\(fragment, existingLoadMore\)/);
  assert.match(source, /function syncNewsLoadMoreButton[\s\S]*if \(!loadMore\)[\s\S]*feed\.appendChild\(loadMore\)/);
  assert.match(source, /function loadOlderNews[\s\S]*appendVisibleNewsItems\(feed, previousVisibleCount, newsVisibleCount/);
  assert.match(source, /preserveNewsPrefix\(visiblePrefix, mergeNewsItems\(newsItems, archiveItems\)\)/);
  assert.match(source, /archiveItems = olderNewsItemsForAppend\(visiblePrefix, archiveItems\)/);
  assert.doesNotMatch(source, /feed\.scrollTop = previousScrollTop/);
  assert.match(source, /fetchNewsArchiveForTicker\(currentTicker, feed\)/);
  assert.match(source, /https:\/\/news\.google\.com\/rss\/search\?q=/);
  assert.match(source, /Promise\.all\(\[[\s\S]*rss\/search[\s\S]*news\.google\.com\/search/);
  assert.match(source, /applyArchiveThumbnails\(archiveItems, normalizeGoogleNewsHtmlThumbnails\(html\)\)/);
  assert.doesNotMatch(source, /shouldTriggerNewsScrollRefresh|newsPull|scrollRefresh|touchstart|touchmove/);
  assert.doesNotMatch(source, /rudolph-news-sidebar-side|normalizeSidebarSide|applyNewsSidebarSide/);
});

test('header order and popup controls match the requested layout', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const newtab = fs.readFileSync(path.join(__dirname, '..', 'newtab.html'), 'utf8');
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

  [index, newtab].forEach((html) => {
    const header = html.match(/<header>[\s\S]*?<\/header>/)[0];
    assert.ok(header.indexOf('class="brand"') < header.indexOf('class="hdr-ticker"'));
    assert.ok(header.indexOf('class="hdr-ticker"') < header.indexOf('class="hdr-price"'));
    assert.ok(header.indexOf('class="hdr-price"') < header.indexOf('class="hdr-meta"'));
    assert.ok(header.indexOf('class="hdr-meta"') < header.indexOf('class="hdr-controls"'));
    assert.match(header, /id="add-widget-btn"[\s\S]*aria-label="Grid options"[\s\S]*<rect[^>]*>[\s\S]*<rect[^>]*>[\s\S]*<rect[^>]*>[\s\S]*<rect/);
    assert.match(header, /id="theme-menu-btn"[\s\S]*class="header-control-icon rainbow-flower-icon"[\s\S]*rainbow-red[\s\S]*rainbow-orange[\s\S]*rainbow-yellow[\s\S]*rainbow-green[\s\S]*rainbow-blue[\s\S]*rainbow-indigo[\s\S]*rainbow-violet/);
    const flower = header.match(/<svg class="header-control-icon rainbow-flower-icon"[\s\S]*?<\/svg>/)[0];
    assert.match(flower, /aria-hidden="true" focusable="false"/);
    assert.equal((flower.match(/class="rainbow-petal /g) || []).length, 7);
    assert.doesNotMatch(header, /paintbrush-icon|paintbrush-paint|paint-bucket-icon|paint-bucket-drop/);
    assert.doesNotMatch(header, /reset-layout-btn|>\+<|&#9881;/);
  });
  assert.match(source, /widget-menu-footer[\s\S]*data-widget-action="reset-grid"[\s\S]*Reset Grid/);
  assert.match(source, /function resetDashboardLayout\(storage, reload\)[\s\S]*removeItem\(GRID_STORAGE_KEY\)[\s\S]*removeItem\(CLOSED_WIDGETS_STORAGE_KEY\)/);
  assert.match(source, /action\.dataset\.widgetAction === 'reset-grid'[\s\S]*resetDashboardLayout\(\)/);
});

test('grid popup always ends with Reset Grid and reset clears both layout keys', () => {
  const app = loadApp();
  const emptyMenu = app.buildWidgetMenuHtml([]);
  const populatedMenu = app.buildWidgetMenuHtml([{ id: 'stock', title: 'Today — Per Minute' }]);

  assert.match(emptyMenu, /All widgets are shown[\s\S]*data-widget-action="reset-grid"[\s\S]*Reset Grid/);
  assert.match(populatedMenu, /data-widget-id="stock"[\s\S]*Today — Per Minute[\s\S]*data-widget-action="reset-grid"/);

  const removed = [];
  let reloaded = false;
  app.resetDashboardLayout({ removeItem: (key) => removed.push(key) }, () => { reloaded = true; });
  assert.deepEqual(removed, ['rudolph-grid-layout', 'rudolph-closed-widgets']);
  assert.equal(reloaded, true);
});

test('missing and failed thumbnails use the matte Rudolph placeholder', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

  assert.match(source, /function createNewsThumbnailPlaceholder\(\)/);
  assert.match(source, /placeholder\.className = 'news-thumbnail news-thumbnail-placeholder'/);
  assert.match(source, /image\.addEventListener\('error',[\s\S]*\{ once: true \}\);[\s\S]*image\.src = item\.thumbnail/);
  assert.match(source, /image\.replaceWith\(createNewsThumbnailPlaceholder\(\)\)/);
});

test('news polling is five-minute and skips work while the page is hidden', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

  assert.match(source, /NEWS_REFRESH_MS = 5 \* 60 \* 1000/);
  assert.match(source, /hidden:\s*document\.hidden/);
  assert.match(source, /newsCount=' \+ NEWS_PAGE_SIZE/);
});

test('manifest grants only the archive host needed for older stories', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));

  assert.ok(manifest.host_permissions.includes('https://news.google.com/*'));
});

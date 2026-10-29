import Chart from 'chart.js/auto';
import { GridStack } from 'gridstack';

// A temporary DOM island while individual dashboard features move into React.
// Every mount gets independent state and one explicit teardown boundary.
export function createDashboardRuntime() {
var disposed = false;
var mounted = false;
var controller = new AbortController();
var timeoutIds = new Set();
var intervalIds = new Set();
var frameIds = new Set();
var pendingWaits = new Set();
var cleanupListeners = [];
var initialGridElement = null;
var initialWidgetNodes = [];
var tickerPanelOrigin = null;
var activeJobs = new Map();
var REQUEST_TIMEOUT_MS = 15000;

function listen(target, type, listener, options) {
  if (!target || disposed) return;
  target.addEventListener(type, listener, options);
  cleanupListeners.push(function() { target.removeEventListener(type, listener, options); });
}

function setTimeout(callback, delay) {
  if (disposed) return null;
  var id = globalThis.setTimeout(function() {
    timeoutIds.delete(id);
    if (!disposed) callback();
  }, delay);
  timeoutIds.add(id);
  return id;
}

function clearTimeout(id) {
  globalThis.clearTimeout(id);
  timeoutIds.delete(id);
}

function setInterval(callback, delay) {
  if (disposed) return null;
  var id = globalThis.setInterval(function() { if (!disposed) callback(); }, delay);
  intervalIds.add(id);
  return id;
}

function clearInterval(id) {
  globalThis.clearInterval(id);
  intervalIds.delete(id);
}

function requestAnimationFrame(callback) {
  if (disposed) return null;
  var id = globalThis.requestAnimationFrame(function(time) {
    frameIds.delete(id);
    if (!disposed) callback(time);
  });
  frameIds.add(id);
  return id;
}

function request(url, options) {
  if (disposed) return Promise.resolve(null);
  return fetch(url, options);
}

async function readResponse(url, format) {
  var requestController = new AbortController();
  var abortRequest = function() { requestController.abort(); };
  // The deadline covers both HTTP headers and the complete response body.
  var deadline = setTimeout(abortRequest, REQUEST_TIMEOUT_MS);
  controller.signal.addEventListener('abort', abortRequest, { once: true });
  try {
    var response = await fetchImpl(url, { signal: requestController.signal });
    if (disposed) return null;
    var value = response.ok ? await response[format]() : null;
    if (disposed) return null;
    return { response: response, value: value };
  } finally {
    clearTimeout(deadline);
    controller.signal.removeEventListener('abort', abortRequest);
  }
}

function runJob(key, work) {
  if (disposed) return Promise.resolve(null);
  if (activeJobs.has(key)) return activeJobs.get(key);
  var requestedTicker = currentTicker;
  var job = Promise.resolve().then(function() {
    if (!disposed) return work();
  }).catch(function() {
    // A malformed or interrupted provider response is retried on the next tick.
    return null;
  }).finally(function() {
    if (activeJobs.get(key) === job) activeJobs.delete(key);
    // Selection changes coalesce into one fresh poll as soon as old work ends.
    if (!disposed && requestedTicker !== currentTicker) return runJob(key, work);
  });
  activeJobs.set(key, job);
  return job;
}

// ─── Utility ─────────────────────────────────────────
var $ = function(id) { return document.getElementById(id); };

function yieldFrame() {
  return new Promise(function(resolve) {
    if (disposed) { resolve(); return; }
    pendingWaits.add(resolve);
    requestAnimationFrame(function() {
      setTimeout(function() { pendingWaits.delete(resolve); resolve(); }, 0);
    });
  });
}

function updateNoseColor(up) {
  var nose = document.querySelector('.nose-ring');
  if (nose) nose.classList.toggle('nose-up', up);
}

function updateClock() {
  $('clock').textContent = new Date().toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}


// ─── Theme Switcher ──────────────────────────────────
var THEME_STORAGE_KEY = 'rudolph-theme';
var APPEARANCE_STORAGE_KEY = 'rudolph-appearance';
var DEFAULT_THEME_FAMILY = 'oneui';
var DEFAULT_APPEARANCE_PREFERENCE = 'auto';
var THEME_FAMILIES = ['oneui', 'glass', 'webex', 'fluent', 'material', 'carbon'];
var APPEARANCE_PREFERENCES = ['auto', 'light', 'dark'];

function getThemeColors() {
  var cs = getComputedStyle(document.body);
  var rSm = parseInt(cs.getPropertyValue('--radius-sm'), 10);
  return {
    text:      cs.getPropertyValue('--text').trim(),
    accent:    cs.getPropertyValue('--accent').trim(),
    surface:   cs.getPropertyValue('--surface').trim(),
    surfaceHi: cs.getPropertyValue('--surface-hi').trim(),
    border:    cs.getPropertyValue('--border').trim(),
    green:     cs.getPropertyValue('--green').trim(),
    red:       cs.getPropertyValue('--red').trim(),
    gridLine:  cs.getPropertyValue('--grid-line').trim(),
    radiusSm:  isNaN(rSm) ? 12 : rSm,
    font:      cs.getPropertyValue('--font').trim(),
    fontMono:  cs.getPropertyValue('--font-mono').trim(),
  };
}

function normalizeThemePreference(themeId) {
  return normalizeThemeFamily(themeId);
}

function normalizeThemeFamily(themeId) {
  return THEME_FAMILIES.indexOf(themeId) !== -1 ? themeId : DEFAULT_THEME_FAMILY;
}

function normalizeAppearancePreference(appearance) {
  if (appearance === 'system') return 'auto';
  return APPEARANCE_PREFERENCES.indexOf(appearance) !== -1
    ? appearance
    : DEFAULT_APPEARANCE_PREFERENCE;
}

function getPreferredColorScheme(win) {
  win = win || (typeof window !== 'undefined' ? window : null);
  if (!win || typeof win.matchMedia !== 'function') return 'dark';

  try {
    if (win.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
    if (win.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  } catch (e) { /* fall through to stable dark default */ }

  return 'dark';
}

function resolveAppearanceMode(appearance, win) {
  var pref = normalizeAppearancePreference(appearance);
  return pref === 'auto' ? getPreferredColorScheme(win) : pref;
}

function resolveThemeId(themeId, win) {
  return resolveAppearanceMode(themeId === 'system' ? 'auto' : themeId, win);
}

function themeClassNameFor(themeFamily, resolvedAppearance) {
  var family = normalizeThemeFamily(themeFamily);
  var appearance = resolvedAppearance === 'light' ? 'light' : 'dark';
  return 'theme-' + family + ' mode-' + appearance;
}

function buildThemeState(themeFamily, appearancePreference, win) {
  var family = normalizeThemeFamily(themeFamily);
  var pref = normalizeAppearancePreference(appearancePreference);
  var resolved = resolveAppearanceMode(pref, win);
  return {
    themeFamily: family,
    appearancePreference: pref,
    resolvedAppearance: resolved,
    className: themeClassNameFor(family, resolved)
  };
}

function getStoredThemeFamily(storage) {
  storage = storage || localStorage;
  var value = storage && typeof storage.getItem === 'function'
    ? storage.getItem(THEME_STORAGE_KEY)
    : null;
  return normalizeThemeFamily(value || DEFAULT_THEME_FAMILY);
}

function getStoredAppearancePreference(storage) {
  storage = storage || localStorage;
  var value = storage && typeof storage.getItem === 'function'
    ? storage.getItem(APPEARANCE_STORAGE_KEY)
    : null;
  if (value) return normalizeAppearancePreference(value);

  var legacyTheme = storage && typeof storage.getItem === 'function'
    ? storage.getItem(THEME_STORAGE_KEY)
    : null;
  if (legacyTheme === 'system') return 'auto';
  if (legacyTheme === 'light' || legacyTheme === 'dark') return legacyTheme;
  return DEFAULT_APPEARANCE_PREFERENCE;
}

function getStoredThemePreference(storage) {
  return getStoredThemeFamily(storage);
}

// ─── External tooltip handler (frosted glass) ───────
var _tooltipEl = null;

function getTooltipEl() {
  if (!_tooltipEl) {
    _tooltipEl = document.createElement('div');
    _tooltipEl.className = 'chart-tooltip';
    document.body.appendChild(_tooltipEl);
  }
  return _tooltipEl;
}

function externalTooltipHandler(context) {
  var tooltip = context.tooltip;
  var el = getTooltipEl();

  if (tooltip.opacity === 0) {
    el.classList.remove('visible');
    return;
  }

  var titleLines = tooltip.title || [];
  var bodyLines = tooltip.body ? tooltip.body.map(function(b) { return b.lines; }) : [];

  var html = '';
  if (titleLines.length) {
    html += '<div class="tt-title">' + esc(titleLines.join(' ')) + '</div>';
  }
  html += '<div class="tt-body">';
  bodyLines.forEach(function(lines, i) {
    var color = tooltip.labelColors && tooltip.labelColors[i]
      ? tooltip.labelColors[i].borderColor : 'var(--accent)';
    lines.forEach(function(line) {
      html += '<div class="tt-row"><span class="tt-swatch" style="background:' + color + '"></span>' + esc(line) + '</div>';
    });
  });
  html += '</div>';
  el.innerHTML = html;

  var canvasRect = context.chart.canvas.getBoundingClientRect();
  var left = canvasRect.left + tooltip.caretX + 12;
  var top = canvasRect.top + tooltip.caretY;
  var elW = el.offsetWidth;
  var elH = el.offsetHeight;
  if (left + elW > window.innerWidth - 8) left = left - elW - 24;
  if (top + elH > window.innerHeight - 8) top = window.innerHeight - elH - 8;
  if (left < 8) left = 8;
  if (top < 8) top = 8;

  el.style.left = left + 'px';
  el.style.top = top + 'px';
  el.classList.add('visible');
}

function refreshAllChartColors() {
  var tc = getThemeColors();
  var allCharts = [];
  if (hourlyChart) allCharts.push(hourlyChart);
  if (stockChart) allCharts.push(stockChart);
  Object.keys(rangeCharts).forEach(function(k) { allCharts.push(rangeCharts[k]); });

  allCharts.forEach(function(chart) {
    chart.options.scales.x.ticks.color = tc.text;
    chart.options.scales.x.ticks.font.family = tc.font;
    chart.options.scales.x.grid.color = tc.gridLine;
    chart.options.scales.y.ticks.color = tc.text;
    chart.options.scales.y.ticks.font.family = tc.fontMono;
    chart.options.scales.y.grid.color = tc.gridLine;
    chart.options.plugins.tooltip.enabled = false;
    chart.options.plugins.tooltip.external = externalTooltipHandler;

    chart.data.datasets.forEach(function(ds) {
      if (ds.label === 'Prior') {
        ds.borderColor = ghostBorderColor();
      } else if (ds.label === 'Extended Hours') {
        ds.borderColor = afterHoursColor();
        ds.backgroundColor = colorToRgba(ds.borderColor, 0.16);
      }
    });

    chart.update('none');
  });
}

// Theme classes and preference listeners are owned by the React provider.

// ─── Ticker Management ──────────────────────────────
var DEFAULT_TICKERS = [
  { sym: 'NVDA', name: 'NVIDIA Corporation' },
  { sym: 'AAPL', name: 'Apple Inc.' },
  { sym: 'MSFT', name: 'Microsoft Corporation' },
  { sym: 'AMZN', name: 'Amazon.com, Inc.' },
  { sym: 'GOOGL', name: 'Alphabet Inc.' }
];

function cloneTickers(tickers) {
  return tickers.map(function(t) {
    return { sym: t.sym, name: t.name };
  });
}

function normalizeTickerList(tickers) {
  if (!Array.isArray(tickers)) return [];

  var seen = {};
  var out = [];
  tickers.forEach(function(t) {
    if (!t || typeof t.sym !== 'string') return;
    var sym = t.sym.trim().toUpperCase();
    if (!sym || seen[sym]) return;
    seen[sym] = true;
    out.push({
      sym: sym,
      name: typeof t.name === 'string' && t.name.trim() ? t.name.trim() : sym
    });
  });
  return out;
}

function getDefaultTickers() {
  return cloneTickers(DEFAULT_TICKERS);
}

function loadSavedTickers(storage) {
  storage = storage || localStorage;
  var raw = storage && typeof storage.getItem === 'function'
    ? storage.getItem('rudolph-tickers')
    : null;
  if (!raw) return getDefaultTickers();

  try {
    var parsed = normalizeTickerList(JSON.parse(raw));
    return parsed.length ? parsed : getDefaultTickers();
  } catch (e) {
    return getDefaultTickers();
  }
}

function getInitialTicker(storage, tickers) {
  storage = storage || localStorage;
  tickers = normalizeTickerList(tickers);
  var stored = storage && typeof storage.getItem === 'function'
    ? storage.getItem('rudolph-ticker')
    : null;
  if (stored) {
    stored = stored.trim().toUpperCase();
    if (tickers.some(function(t) { return t.sym === stored; })) return stored;
  }
  return tickers.length ? tickers[0].sym : DEFAULT_TICKERS[0].sym;
}

function removeTickerFromList(tickers, sym, activeSym) {
  var normalized = normalizeTickerList(tickers);
  var removeSym = String(sym || '').trim().toUpperCase();
  var active = String(activeSym || '').trim().toUpperCase();
  var nextTickers = normalized.filter(function(t) { return t.sym !== removeSym; });
  if (!nextTickers.length) nextTickers = getDefaultTickers();

  return {
    tickers: nextTickers,
    currentTicker: removeSym === active
      ? nextTickers[0].sym
      : getInitialTicker({ getItem: function() { return active; } }, nextTickers)
  };
}

var savedTickers = loadSavedTickers(localStorage);
var currentTicker = getInitialTicker(localStorage, savedTickers);

function saveTickers() {
  localStorage.setItem('rudolph-tickers', JSON.stringify(savedTickers));
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Contextual news sidebar ────────────────────────
var NEWS_REFRESH_MS = 5 * 60 * 1000;
var NEWS_PAGE_SIZE = 12;
var NEWS_MAX_ITEMS = 100;
var newsRequestSequence = 0;
var refreshTimerNews = null;
var newsVisibleCount = NEWS_PAGE_SIZE;
var newsItems = [];
var newsArchiveLoaded = false;
var newsActiveTicker = '';
var newsHasMore = true;
var newsIsLoading = false;
var lastNewsFetchAt = 0;

function safeHttpsUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    var parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.href : '';
  } catch (e) {
    return '';
  }
}

function newsUrlFromItem(item) {
  if (!item) return '';
  return safeHttpsUrl(
    item.link ||
    (item.clickThroughUrl && item.clickThroughUrl.url) ||
    (item.canonicalUrl && item.canonicalUrl.url) ||
    ''
  );
}

function newsThumbnailFromItem(item) {
  var resolutions = item && item.thumbnail && Array.isArray(item.thumbnail.resolutions)
    ? item.thumbnail.resolutions
    : [];
  var candidates = resolutions.map(function(resolution) {
    return {
      url: safeHttpsUrl(resolution && resolution.url),
      width: Number(resolution && resolution.width) || 0
    };
  }).filter(function(candidate) { return !!candidate.url; });
  candidates.sort(function(a, b) { return a.width - b.width; });
  for (var i = 0; i < candidates.length; i++) {
    if (candidates[i].width >= 160) return candidates[i].url;
  }
  return candidates.length ? candidates[candidates.length - 1].url : '';
}

function normalizeNewsTimestamp(value) {
  var seconds = Number(value);
  if (!isFinite(seconds) || seconds <= 0) return 0;
  var date = new Date(seconds * 1000);
  return isNaN(date.getTime()) ? 0 : seconds;
}

function normalizeNewsItems(payload, limit) {
  var rawItems = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.news) ? payload.news : []);
  var seen = {};
  var normalized = [];
  limit = Math.max(1, Math.min(NEWS_MAX_ITEMS, Number(limit) || NEWS_PAGE_SIZE));

  rawItems.forEach(function(item, sourceIndex) {
    if (!item || typeof item.title !== 'string' || !item.title.trim()) return;
    var link = newsUrlFromItem(item);
    if (!link || seen[link]) return;
    seen[link] = true;
    normalized.push({
      title: item.title.trim(),
      summary: typeof item.summary === 'string' ? item.summary.trim()
        : (typeof item.description === 'string' ? item.description.trim() : ''),
      publisher: typeof item.publisher === 'string' ? item.publisher.trim() : '',
      publishedAt: normalizeNewsTimestamp(item.providerPublishTime),
      link: link,
      thumbnail: newsThumbnailFromItem(item),
      sourceIndex: sourceIndex
    });
  });

  normalized.sort(function(a, b) {
    if (a.publishedAt !== b.publishedAt) return b.publishedAt - a.publishedAt;
    return a.sourceIndex - b.sourceIndex;
  });
  return normalized.slice(0, limit).map(function(item) {
    delete item.sourceIndex;
    return item;
  });
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/^<!\[CDATA\[|\]\]>$/g, '')
    .replace(/&#x([0-9a-f]+);/gi, function(_, hex) { return String.fromCodePoint(parseInt(hex, 16)); })
    .replace(/&#(\d+);/g, function(_, dec) { return String.fromCodePoint(parseInt(dec, 10)); })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function xmlTagText(block, tagName) {
  var escapedName = tagName.replace(':', '\\:');
  var match = String(block || '').match(new RegExp('<' + escapedName + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + escapedName + '>', 'i'));
  return match ? decodeXmlEntities(match[1]).trim() : '';
}

function normalizeNewsTitleKey(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeGoogleNewsRss(xml, limit) {
  var rawItems = [];
  var itemPattern = /<item>([\s\S]*?)<\/item>/gi;
  var match;
  while ((match = itemPattern.exec(String(xml || ''))) && rawItems.length < (limit || NEWS_MAX_ITEMS)) {
    var block = match[1];
    var publisher = xmlTagText(block, 'source');
    var title = xmlTagText(block, 'title');
    var publisherSuffix = publisher ? ' - ' + publisher : '';
    if (publisherSuffix && title.slice(-publisherSuffix.length) === publisherSuffix) {
      title = title.slice(0, -publisherSuffix.length);
    }
    rawItems.push({
      title: title,
      link: xmlTagText(block, 'link'),
      publisher: publisher,
      providerPublishTime: Date.parse(xmlTagText(block, 'pubDate')) / 1000
    });
  }
  return normalizeNewsItems({ news: rawItems }, limit || NEWS_MAX_ITEMS);
}

function normalizeGoogleNewsHtmlThumbnails(html) {
  var thumbnails = {};
  var pattern = /<a class="JtKRv"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,3000}?<figure[^>]*>[\s\S]*?<img[^>]*\ssrc="([^"]+)"/gi;
  var match;
  while ((match = pattern.exec(String(html || '')))) {
    var title = decodeXmlEntities(match[1].replace(/<[^>]+>/g, '')).trim();
    var rawUrl = decodeXmlEntities(match[2]);
    var url = rawUrl.charAt(0) === '/' ? 'https://news.google.com' + rawUrl : rawUrl;
    url = safeHttpsUrl(url);
    if (title && url) thumbnails[normalizeNewsTitleKey(title)] = url;
  }
  return thumbnails;
}

function applyArchiveThumbnails(items, thumbnailsByTitle) {
  return items.map(function(item) {
    if (!item.thumbnail) item.thumbnail = thumbnailsByTitle[normalizeNewsTitleKey(item.title)] || '';
    return item;
  });
}

function mergeNewsItems(primaryItems, archiveItems) {
  var seenLinks = {};
  var seenTitles = {};
  var merged = [];
  primaryItems.concat(archiveItems).forEach(function(item) {
    var titleKey = normalizeNewsTitleKey(item && item.title);
    if (!item || !item.link || seenLinks[item.link] || (titleKey && seenTitles[titleKey])) return;
    seenLinks[item.link] = true;
    if (titleKey) seenTitles[titleKey] = true;
    merged.push(item);
  });
  merged.sort(function(a, b) { return (b.publishedAt || 0) - (a.publishedAt || 0); });
  return merged.slice(0, NEWS_MAX_ITEMS);
}

function newsSkeletonHtml() {
  var row = '<div class="news-card news-card-skeleton"><span class="skel news-thumb-skeleton"></span>' +
    '<span class="news-copy-skeleton"><span class="skel"></span><span class="skel"></span><span class="skel"></span></span></div>';
  return row + row + row + row;
}

function formatNewsTime(unixSeconds) {
  if (!unixSeconds || !isFinite(unixSeconds)) return '';
  try {
    return new Date(unixSeconds * 1000).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  } catch (e) {
    return '';
  }
}

function newsDateKey(unixSeconds) {
  if (!unixSeconds || !isFinite(unixSeconds)) return 'earlier';
  var date = new Date(unixSeconds * 1000);
  if (isNaN(date.getTime())) return 'earlier';
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function newsDateGroupLabel(unixSeconds, referenceTimeMs) {
  if (!unixSeconds || !isFinite(unixSeconds)) return 'Earlier';
  var date = new Date(unixSeconds * 1000);
  var reference = new Date(referenceTimeMs == null ? Date.now() : referenceTimeMs);
  if (isNaN(date.getTime()) || isNaN(reference.getTime())) return 'Earlier';
  var dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  var referenceStart = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  var daysAgo = Math.round((referenceStart.getTime() - dateStart.getTime()) / 86400000);
  if (daysAgo === 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function shouldLoadMoreNews(metrics) {
  if (!metrics || metrics.loading || !metrics.hasMore) return false;
  var scrollTop = Math.max(0, Number(metrics.scrollTop) || 0);
  var clientHeight = Math.max(0, Number(metrics.clientHeight) || 0);
  var scrollHeight = Math.max(0, Number(metrics.scrollHeight) || 0);
  var threshold = Math.max(0, Number(metrics.threshold) || 80);
  return scrollHeight > 0 && scrollTop + clientHeight >= scrollHeight - threshold;
}

function shouldRefreshNews(metrics) {
  if (!metrics || metrics.hidden || metrics.loading) return false;
  var now = Number(metrics.now) || 0;
  var lastFetchAt = Number(metrics.lastFetchAt) || 0;
  var interval = Math.max(1, Number(metrics.interval) || NEWS_REFRESH_MS);
  return !lastFetchAt || now - lastFetchAt >= interval;
}

function setNewsLoading(symbol) {
  var feed = $('news-feed');
  var symbolEl = $('news-symbol');
  if (symbolEl) symbolEl.textContent = symbol;
  if (!feed) return;
  feed.setAttribute('aria-busy', 'true');
  feed.innerHTML = newsSkeletonHtml();
}

function createNewsThumbnailPlaceholder() {
  var placeholder = document.createElement('span');
  placeholder.className = 'news-thumbnail news-thumbnail-placeholder';
  placeholder.setAttribute('aria-hidden', 'true');
  return placeholder;
}

function replaceFailedNewsThumbnail(image) {
  if (!image || !image.parentNode || !image.replaceWith) return;
  image.replaceWith(createNewsThumbnailPlaceholder());
}

function syncNewsLoadMoreButton(feed) {
  if (!feed) return null;
  var loadMore = feed.querySelector ? feed.querySelector('.news-load-more-btn') : null;
  if (!newsHasMore) {
    if (loadMore && loadMore.remove) loadMore.remove();
    return null;
  }
  if (!loadMore) {
    loadMore = document.createElement('button');
    loadMore.className = 'news-load-more-btn';
    loadMore.type = 'button';
    loadMore.setAttribute('aria-busy', 'false');
    loadMore.textContent = 'Load older stories';
    feed.appendChild(loadMore);
  }
  return loadMore;
}

function renderNewsItems(items, symbol, options) {
  options = options || {};
  var feed = $('news-feed');
  if (!feed) return;
  var existingLoadMore = options.append && feed.querySelector
    ? feed.querySelector('.news-load-more-btn')
    : null;
  if (!options.append) {
    feed.innerHTML = '';
  }
  feed.setAttribute('aria-busy', 'false');

  if (!items.length) {
    if (options.append) {
      syncNewsLoadMoreButton(feed);
      return;
    }
    var empty = document.createElement('div');
    empty.className = 'news-empty';
    empty.textContent = 'No major headlines are available for ' + symbol + ' right now.';
    feed.appendChild(empty);
    return;
  }

  var fragment = document.createDocumentFragment();
  var previousDateKey = options.previousDateKey || null;
  items.forEach(function(item) {
    var dateKey = newsDateKey(item.publishedAt);
    if (dateKey !== previousDateKey) {
      var separator = document.createElement('div');
      separator.className = 'news-date-separator';
      separator.setAttribute('role', 'heading');
      separator.setAttribute('aria-level', '3');
      var dateLabel = document.createElement('time');
      if (dateKey !== 'earlier') dateLabel.dateTime = dateKey;
      dateLabel.textContent = newsDateGroupLabel(item.publishedAt);
      separator.appendChild(dateLabel);
      fragment.appendChild(separator);
      previousDateKey = dateKey;
    }

    var card = document.createElement('a');
    card.className = 'news-card';
    card.href = item.link;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';

    if (item.thumbnail) {
      var image = document.createElement('img');
      image.className = 'news-thumbnail';
      image.alt = '';
      image.width = 80;
      image.height = 58;
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.addEventListener('error', function() {
        replaceFailedNewsThumbnail(image);
      }, { once: true });
      image.src = item.thumbnail;
      card.appendChild(image);
    } else {
      card.appendChild(createNewsThumbnailPlaceholder());
    }

    var copy = document.createElement('span');
    copy.className = 'news-copy';
    var title = document.createElement('span');
    title.className = 'news-title';
    title.textContent = item.title;
    copy.appendChild(title);

    if (item.summary) {
      var summary = document.createElement('span');
      summary.className = 'news-summary';
      summary.textContent = item.summary;
      copy.appendChild(summary);
    }

    var metaText = [item.publisher, formatNewsTime(item.publishedAt)].filter(Boolean).join(' · ');
    if (metaText) {
      var meta = document.createElement('span');
      meta.className = 'news-meta';
      meta.textContent = metaText;
      copy.appendChild(meta);
    }
    card.appendChild(copy);
    fragment.appendChild(card);
  });
  if (existingLoadMore && feed.insertBefore) feed.insertBefore(fragment, existingLoadMore);
  else feed.appendChild(fragment);
  syncNewsLoadMoreButton(feed);
}

function appendVisibleNewsItems(feed, startIndex, endIndex, symbol) {
  if (!feed) return;
  if (endIndex <= startIndex) {
    syncNewsLoadMoreButton(feed);
    return;
  }
  var previousItem = startIndex > 0 ? newsItems[startIndex - 1] : null;
  renderNewsItems(newsItems.slice(startIndex, endIndex), symbol, {
    append: true,
    previousDateKey: previousItem ? newsDateKey(previousItem.publishedAt) : null
  });
}

function preserveNewsPrefix(prefix, mergedItems) {
  prefix = Array.isArray(prefix) ? prefix : [];
  mergedItems = Array.isArray(mergedItems) ? mergedItems : [];
  var seen = {};
  prefix.forEach(function(item) { if (item && item.link) seen[item.link] = true; });
  return prefix.concat(mergedItems.filter(function(item) {
    return item && item.link && !seen[item.link];
  }));
}

function olderNewsItemsForAppend(visiblePrefix, candidates) {
  visiblePrefix = Array.isArray(visiblePrefix) ? visiblePrefix : [];
  candidates = Array.isArray(candidates) ? candidates : [];
  var tail = visiblePrefix.length ? visiblePrefix[visiblePrefix.length - 1] : null;
  var tailTimestamp = normalizeNewsTimestamp(tail && tail.publishedAt);
  if (!tailTimestamp) return candidates;
  return candidates.filter(function(item) {
    var timestamp = normalizeNewsTimestamp(item && item.publishedAt);
    return !timestamp || timestamp <= tailTimestamp;
  });
}

async function fetchNewsForTicker(symbol, options) {
  options = options || {};
  symbol = String(symbol || '').trim().toUpperCase();
  if (!symbol) return;
  var manualVisibleCount = options.manualRefresh ? newsVisibleCount : null;
  var manualFeed = options.manualRefresh ? $('news-feed') : null;
  var manualScrollTop = manualFeed ? manualFeed.scrollTop : 0;
  var tickerChanged = newsActiveTicker !== symbol;
  if (tickerChanged) {
    newsActiveTicker = symbol;
    newsArchiveLoaded = false;
    newsVisibleCount = NEWS_PAGE_SIZE;
    newsItems = [];
    newsHasMore = true;
    var changedFeed = $('news-feed');
    if (changedFeed) changedFeed.scrollTop = 0;
  }
  var requestId = ++newsRequestSequence;
  newsIsLoading = true;
  if (options.manualRefresh) setNewsRefreshButtonLoading(true);
  if (!options.background) setNewsLoading(symbol);
  var url = 'https://query1.finance.yahoo.com/v1/finance/search?q=' +
    encodeURIComponent(symbol) + '&quotesCount=0&newsCount=' + NEWS_PAGE_SIZE + '&enableFuzzyQuery=false';
  var json = null;
  try { json = await yahooFetch(url); }
  catch (e) { /* keep the last good feed on unexpected provider failures */ }
  if (disposed) return;
  if (requestId !== newsRequestSequence || symbol !== currentTicker) {
    if (options.manualRefresh) setNewsRefreshButtonLoading(false);
    return;
  }
  if (!json) {
    newsIsLoading = false;
    if (options.manualRefresh) setNewsRefreshButtonLoading(false);
    var failedFeed = $('news-feed');
    if (failedFeed) failedFeed.setAttribute('aria-busy', 'false');
    if (!newsItems.length) renderNewsItems([], symbol);
    return;
  }
  var normalizedItems = normalizeNewsItems(json, NEWS_PAGE_SIZE);
  newsIsLoading = false;
  commitNewsItems(normalizedItems, symbol, options.manualRefresh ? {
    mergeExisting: true,
    visibleCount: manualVisibleCount
  } : {});
  if (options.manualRefresh) {
    setNewsRefreshButtonLoading(false);
    if (manualFeed) manualFeed.scrollTop = manualScrollTop;
  }
}

function setNewsRefreshButtonLoading(loading) {
  var button = $('news-refresh-btn');
  if (!button) return;
  button.disabled = !!loading;
  button.textContent = loading ? 'Refreshing…' : 'Refresh Feed';
  button.setAttribute('aria-busy', loading ? 'true' : 'false');
}

function commitNewsItems(items, symbol, options) {
  options = options || {};
  if (options.resetArchive) newsArchiveLoaded = false;
  newsItems = options.mergeExisting || (newsArchiveLoaded && !options.resetArchive)
    ? mergeNewsItems(items, newsItems)
    : items;
  if (options.resetVisibleCount) newsVisibleCount = NEWS_PAGE_SIZE;
  if (Number(options.visibleCount) > 0) newsVisibleCount = Number(options.visibleCount);
  newsVisibleCount = Math.min(Math.max(NEWS_PAGE_SIZE, newsVisibleCount), newsItems.length || NEWS_PAGE_SIZE);
  newsHasMore = newsVisibleCount < newsItems.length || (!newsArchiveLoaded && newsItems.length > 0);
  lastNewsFetchAt = nowMs();
  renderNewsItems(newsItems.slice(0, newsVisibleCount), symbol);
}

function setNewsOlderLoading(loading) {
  var feed = $('news-feed');
  var loadMore = feed && feed.querySelector ? feed.querySelector('.news-load-more-btn') : null;
  if (!loadMore) return;
  loadMore.disabled = !!loading;
  loadMore.textContent = loading ? 'Loading older stories…' : 'Load older stories';
  loadMore.setAttribute('aria-busy', loading ? 'true' : 'false');
}

function loadOlderNews(feed) {
  if (!feed || newsIsLoading || !newsHasMore) return;
  if (newsVisibleCount < newsItems.length) {
    var previousVisibleCount = newsVisibleCount;
    newsVisibleCount = Math.min(newsItems.length, newsVisibleCount + NEWS_PAGE_SIZE);
    newsHasMore = newsVisibleCount < newsItems.length || !newsArchiveLoaded;
    appendVisibleNewsItems(feed, previousVisibleCount, newsVisibleCount, currentTicker);
    return;
  }
  fetchNewsArchiveForTicker(currentTicker, feed);
}

async function fetchNewsArchiveForTicker(symbol, feed) {
  var requestId = ++newsRequestSequence;
  var previousVisibleCount = newsVisibleCount;
  var visiblePrefix = newsItems.slice(0, previousVisibleCount);
  newsIsLoading = true;
  setNewsOlderLoading(true);
  var query = encodeURIComponent(symbol + ' stock');
  var suffix = '&hl=en-US&gl=US&ceid=US:en';
  var responses = await Promise.all([
    fetchTextWithBackoff('https://news.google.com/rss/search?q=' + query + suffix, 2),
    fetchTextWithBackoff('https://news.google.com/search?q=' + query + suffix, 2, false)
  ]);
  if (disposed) return;
  var xml = responses[0];
  var html = responses[1];
  if (requestId !== newsRequestSequence || symbol !== currentTicker) return;
  newsIsLoading = false;
  if (!xml) {
    setNewsOlderLoading(false);
    return;
  }
  newsArchiveLoaded = true;
  var archiveItems = normalizeGoogleNewsRss(xml, NEWS_MAX_ITEMS);
  if (html) archiveItems = applyArchiveThumbnails(archiveItems, normalizeGoogleNewsHtmlThumbnails(html));
  archiveItems = olderNewsItemsForAppend(visiblePrefix, archiveItems);
  newsItems = preserveNewsPrefix(visiblePrefix, mergeNewsItems(newsItems, archiveItems));
  newsVisibleCount = Math.min(newsItems.length, newsVisibleCount + NEWS_PAGE_SIZE);
  newsHasMore = newsVisibleCount < newsItems.length;
  appendVisibleNewsItems(feed, previousVisibleCount, newsVisibleCount, symbol);
}

function loadMoreNewsIfNeeded(feed) {
  if (!feed || newsIsLoading || !newsHasMore) return;
  if (!shouldLoadMoreNews({
    scrollTop: feed.scrollTop,
    clientHeight: feed.clientHeight,
    scrollHeight: feed.scrollHeight,
    loading: newsIsLoading,
    hasMore: newsHasMore
  })) return;
  loadOlderNews(feed);
}

function initNewsFeedControls() {
  var feed = $('news-feed');
  if (feed) {
    listen(feed, 'scroll', function() {
      loadMoreNewsIfNeeded(feed);
    }, { passive: true });
    listen(feed, 'click', function(e) {
      if (e.target && e.target.closest && e.target.closest('.news-load-more-btn')) loadOlderNews(feed);
    });
  }
  var refreshButton = $('news-refresh-btn');
  if (refreshButton) listen(refreshButton, 'click', function() {
    if (newsIsLoading) return;
    fetchNewsForTicker(currentTicker, { background: newsItems.length > 0, manualRefresh: true });
  });
  listen(document, 'visibilitychange', function() {
    if (document.hidden) return;
    if (shouldRefreshNews({
      hidden: document.hidden,
      loading: newsIsLoading,
      lastFetchAt: lastNewsFetchAt,
      now: nowMs(),
      interval: NEWS_REFRESH_MS
    })) {
      fetchNewsForTicker(currentTicker, { background: newsItems.length > 0 });
    }
  });
}

function chartUrl(params) {
  return 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(currentTicker) + '?' + params;
}

function renderTickerList(searchResults) {
  var el = $('ticker-list');
  var html = '';

  if (searchResults && searchResults.length) {
    html += '<div class="ticker-section-label">Results</div>';
    for (var i = 0; i < searchResults.length; i++) {
      var r = searchResults[i];
      var already = savedTickers.some(function(t) { return t.sym === r.symbol; });
      html += '<div class="ticker-item" data-sym="' + esc(r.symbol) + '" data-name="' + esc(r.shortname || r.symbol) + '" data-action="add">' +
        '<span class="ticker-item-sym">' + esc(r.symbol) + '</span>' +
        '<span class="ticker-item-name">' + esc(r.shortname || r.longname || '') + '</span>' +
        (r.exchDisp ? '<span class="ticker-item-exch">' + esc(r.exchDisp) + '</span>' : '') +
        (already
          ? '<span class="ticker-item-check">\u2713</span>'
          : '<button class="ticker-item-action add" type="button">+</button>') +
      '</div>';
    }
    html += '<div class="ticker-divider"></div>';
  }

  if (savedTickers.length) {
    html += '<div class="ticker-section-label">Watchlist</div>';
    for (var j = 0; j < savedTickers.length; j++) {
      var t = savedTickers[j];
      var isActive = t.sym === currentTicker;
      html += '<div class="ticker-item' + (isActive ? ' active' : '') + '" data-sym="' + esc(t.sym) + '" data-name="' + esc(t.name) + '" data-action="select">' +
        '<span class="ticker-item-sym">' + esc(t.sym) + '</span>' +
        '<span class="ticker-item-name">' + esc(t.name) + '</span>' +
        '<button class="ticker-item-action remove" data-action="remove" type="button" aria-label="Remove ' + esc(t.sym) + '">\u00d7</button>' +
      '</div>';
    }
  }

  el.innerHTML = html || '<div class="ticker-empty">Type to search stocks</div>';
}

var tickerSearchTimer = null;

async function searchTickers(query) {
  var url = 'https://query1.finance.yahoo.com/v1/finance/search?q=' +
    encodeURIComponent(query) + '&quotesCount=8&newsCount=0';
  var json = await yahooFetch(url);
  if (disposed) return null;
  if (json && json.quotes) {
    var filtered = json.quotes.filter(function(r) {
      return r.quoteType === 'EQUITY' || r.quoteType === 'ETF' || r.quoteType === 'INDEX';
    });
    renderTickerList(filtered);
  }
}

function addTicker(sym, name) {
  if (!savedTickers.some(function(t) { return t.sym === sym; })) {
    savedTickers.push({ sym: sym, name: name });
    saveTickers();
  }
  selectTicker(sym);
}

function removeTicker(sym) {
  var previousTicker = currentTicker;
  var result = removeTickerFromList(savedTickers, sym, currentTicker);
  savedTickers = result.tickers;
  currentTicker = result.currentTicker;
  saveTickers();
  localStorage.setItem('rudolph-ticker', currentTicker);
  $('ticker-btn').textContent = currentTicker;
  renderTickerList();
  if (currentTicker !== previousTicker) resetDashboard();
}

function selectTicker(sym) {
  if (sym === currentTicker) {
    $('ticker-panel').classList.remove('open');
    return;
  }
  currentTicker = sym;
  localStorage.setItem('rudolph-ticker', sym);
  $('ticker-btn').textContent = sym;
  $('ticker-panel').classList.remove('open');
  resetDashboard();
}

function resetDashboard() {
  if (hourlyChart)  { hourlyChart.destroy(); hourlyChart = null; }
  if (stockChart)   { stockChart.destroy();  stockChart = null; }
  Object.keys(rangeCharts).forEach(function(k) { rangeCharts[k].destroy(); });
  rangeCharts = {};
  megaData = null;

  ['hourly-loader','stock-loader','month-loader','year-loader','alltime-loader'].forEach(function(id) {
    var el = $(id);
    if (!el) return;
    el.style.display = '';
    el.className = 'skel skel-chart';
    el.innerHTML = '';
  });

  var pills2 = new Array(3).join('<span class="skel skel-pill"></span>');
  ['hourly-stats','today-stats','month-stats','year-stats','alltime-stats'].forEach(function(id) {
    var el = $(id);
    if (el) el.innerHTML = pills2;
  });

  if ($('stock-price')) $('stock-price').innerHTML  = '<span class="skel skel-price"></span>';
  if ($('stock-change')) $('stock-change').innerHTML = '<span class="skel skel-change"></span>';

  fetchMegaData();
  fetchHourly();
  fetchStockWithFallback();
  fetchAllRanges();
  fetchNewsForTicker(currentTicker);
}

function positionTickerPanel() {
  var btn = $('ticker-btn');
  var panel = $('ticker-panel');
  if (!btn || !panel) return;
  var r = btn.getBoundingClientRect();
  var panelWidth = Math.max(r.width, 300);
  var direction = chooseDropdownMenuDirection({
    buttonLeft: r.left,
    buttonRight: r.right,
    menuWidth: panelWidth,
    viewportWidth: window.innerWidth
  });
  panel.style.left = dropdownMenuLeftForDirection({
    buttonLeft: r.left,
    buttonRight: r.right,
    menuWidth: panelWidth,
    viewportWidth: window.innerWidth,
    direction: direction
  }) + 'px';
  panel.style.top = (r.bottom + 6) + 'px';
  panel.style.minWidth = panelWidth + 'px';
}

function initTickerCombo() {
  $('ticker-btn').textContent = currentTicker;

  var panel = $('ticker-panel');
  if (panel && panel.parentElement !== document.body) {
    document.body.appendChild(panel);
  }

  listen($('ticker-btn'), 'click', function(e) {
    e.stopPropagation();
    var p = $('ticker-panel');
    var opening = !p.classList.contains('open');
    p.classList.toggle('open');
    if (opening) {
      positionTickerPanel();
      $('ticker-search').value = '';
      renderTickerList();
      setTimeout(function() { $('ticker-search').focus(); }, 50);
    }
  });

  listen(document, 'click', function(e) {
    if (!e.target.closest('#ticker-combo') && !e.target.closest('#ticker-panel')) {
      $('ticker-panel').classList.remove('open');
    }
  });

  listen($('ticker-search'), 'input', function() {
    var q = this.value.trim();
    clearTimeout(tickerSearchTimer);
    if (q.length < 1) { renderTickerList(); return; }
    tickerSearchTimer = setTimeout(function() { searchTickers(q); }, 250);
  });

  listen($('ticker-search'), 'keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      var first = $('ticker-list').querySelector('.ticker-item[data-action="add"]');
      if (first) addTicker(first.dataset.sym, first.dataset.name);
    }
  });

  listen($('ticker-list'), 'click', function(e) {
    e.stopPropagation();
    var removeBtn = e.target.closest('.remove');
    if (removeBtn) {
      var item = removeBtn.closest('.ticker-item');
      if (item) removeTicker(item.dataset.sym);
      return;
    }

    var addBtn = e.target.closest('.add');
    var item = e.target.closest('.ticker-item');
    if (!item) return;

    if (addBtn || item.dataset.action === 'add') {
      addTicker(item.dataset.sym, item.dataset.name);
    } else {
      selectTicker(item.dataset.sym);
    }
  });
}

// ─── Yahoo Finance fetch helper ──────────────────────
// Extension host_permissions bypass CORS, so we fetch directly.
// Requests stay on the declared providers; no third-party proxy receives symbols.
function wait(ms) {
  return new Promise(function(resolve) {
    if (disposed) { resolve(); return; }
    pendingWaits.add(resolve);
    setTimeout(function() { pendingWaits.delete(resolve); resolve(); }, ms);
  });
}

var fetchImpl = request;
var waitImpl = wait;
var RATE_LIMIT_MIN_COOLDOWN_MS = 5000;
var RATE_LIMIT_MAX_COOLDOWN_MS = 5 * 60 * 1000;
var fetchStateByProvider = {};

function nowMs() {
  return Date.now();
}

function providerKeyForUrl(url) {
  if (String(url).indexOf('query1.finance.yahoo.com') !== -1) return 'yahoo';
  try {
    return new URL(url).origin;
  } catch (e) {
    return String(url).split('?')[0];
  }
}

function retryAfterMs(res) {
  if (!res || !res.headers || typeof res.headers.get !== 'function') return null;
  var raw = res.headers.get('Retry-After') || res.headers.get('retry-after');
  if (!raw) return null;
  var seconds = Number(raw);
  if (isFinite(seconds) && seconds >= 0) return seconds * 1000;
  var dateMs = Date.parse(raw);
  if (isFinite(dateMs)) return Math.max(0, dateMs - nowMs());
  return null;
}

function isRateLimitResponse(res) {
  if (!res) return false;
  return res.status === 429 || res.status === 999 || res.status === 403;
}

function getFetchState(providerKey) {
  if (!fetchStateByProvider[providerKey]) {
    fetchStateByProvider[providerKey] = {
      cooldownUntil: 0,
      failures: 0,
      cache: {}
    };
  }
  return fetchStateByProvider[providerKey];
}

function cacheKeyForUrl(url) {
  return String(url);
}

function cachedJsonForUrl(state, url) {
  var cached = state.cache[cacheKeyForUrl(url)];
  return cached ? cached.json : null;
}

function storeCachedResponse(state, url, value) {
  var keys = Object.keys(state.cache);
  if (keys.length >= 100 && !Object.prototype.hasOwnProperty.call(state.cache, cacheKeyForUrl(url))) {
    delete state.cache[keys[0]];
  }
  state.cache[cacheKeyForUrl(url)] = { json: value, at: nowMs() };
}

function setRateLimitCooldown(state, res) {
  var retryMs = retryAfterMs(res);
  if (retryMs === null) {
    retryMs = Math.min(RATE_LIMIT_MAX_COOLDOWN_MS, RATE_LIMIT_MIN_COOLDOWN_MS * Math.pow(2, state.failures));
  }
  state.failures += 1;
  state.cooldownUntil = nowMs() + Math.min(RATE_LIMIT_MAX_COOLDOWN_MS, retryMs);
}

async function fetchJsonWithBackoff(url, attempts) {
  var baseDelay = 250;
  var providerKey = providerKeyForUrl(url);
  var state = getFetchState(providerKey);
  if (state.cooldownUntil > nowMs()) return cachedJsonForUrl(state, url);

  for (var i = 0; i < attempts; i++) {
    if (disposed) return null;
    try {
      var result = await readResponse(url, 'json');
      if (disposed || !result) return null;
      var res = result.response;
      if (res.ok) {
        var json = result.value;
        state.failures = 0;
        state.cooldownUntil = 0;
        storeCachedResponse(state, url, json);
        return json;
      }
      if (isRateLimitResponse(res)) {
        setRateLimitCooldown(state, res);
        return cachedJsonForUrl(state, url);
      }
    } catch (e) { /* try again below */ }
    if (i < attempts - 1) {
      var jitter = Math.floor(Math.random() * 100);
      await waitImpl(baseDelay * Math.pow(2, i) + jitter);
      if (disposed) return null;
    }
  }
  return cachedJsonForUrl(state, url);
}

async function fetchTextWithBackoff(url, attempts, cacheResult) {
  var baseDelay = 250;
  var providerKey = providerKeyForUrl(url);
  var state = getFetchState(providerKey);
  if (state.cooldownUntil > nowMs()) return cacheResult === false ? null : cachedJsonForUrl(state, url);

  for (var i = 0; i < attempts; i++) {
    if (disposed) return null;
    try {
      var result = await readResponse(url, 'text');
      if (disposed || !result) return null;
      var res = result.response;
      if (res.ok) {
        var value = result.value;
        state.failures = 0;
        state.cooldownUntil = 0;
        if (cacheResult !== false) storeCachedResponse(state, url, value);
        return value;
      }
      if (isRateLimitResponse(res)) {
        setRateLimitCooldown(state, res);
        return cacheResult === false ? null : cachedJsonForUrl(state, url);
      }
    } catch (e) { /* try again below */ }
    if (i < attempts - 1) {
      var jitter = Math.floor(Math.random() * 100);
      await waitImpl(baseDelay * Math.pow(2, i) + jitter);
      if (disposed) return null;
    }
  }
  return cacheResult === false ? null : cachedJsonForUrl(state, url);
}

async function yahooFetch(url) {
  return fetchJsonWithBackoff(url, 2);
}

// ─── Per-segment gradient coloring ───────────────────
// Each line segment between two points is colored green (up) or red (down)
// with alpha intensity proportional to the magnitude of the change.
function segmentBorderColor(ctx) {
  var p0 = ctx.p0.parsed.y;
  var p1 = ctx.p1.parsed.y;
  if (p0 == null || p1 == null) return 'rgba(138,150,170,0.3)';
  var cs = getComputedStyle(document.body);
  return p1 >= p0 ? cs.getPropertyValue('--green').trim() : cs.getPropertyValue('--red').trim();
}

function segmentFillColor(ctx) {
  var p0 = ctx.p0.parsed.y;
  var p1 = ctx.p1.parsed.y;
  if (p0 == null || p1 == null) return 'transparent';
  var cs = getComputedStyle(document.body);
  var c = p1 >= p0 ? cs.getPropertyValue('--green').trim() : cs.getPropertyValue('--red').trim();
  var m = c.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (m) return 'rgba(' + parseInt(m[1],16) + ',' + parseInt(m[2],16) + ',' + parseInt(m[3],16) + ',0.12)';
  return c.replace('rgb(', 'rgba(').replace(')', ',0.12)');
}

var segmentStyle = {
  borderColor: function(ctx) { return segmentBorderColor(ctx); },
  backgroundColor: function(ctx) { return segmentFillColor(ctx); }
};

// ─── Mega dataset: all-time daily OHLC for accurate min/max ──
var megaData = null; // { timestamps:[], highs:[], lows:[], closes:[] }

function fetchMegaData() {
  return runJob('mega', fetchMegaDataJob);
}

async function fetchMegaDataJob() {
  var requestedTicker = currentTicker;
  var json = await yahooFetch(chartUrl('range=max&interval=1d'));
  if (disposed || requestedTicker !== currentTicker) return null;
  if (json && json.chart && json.chart.result) {
    var result = json.chart.result[0];
    var ts = result.timestamp || [];
    var q = result.indicators.quote[0];
    megaData = {
      timestamps: ts,
      highs: q.high || [],
      lows: q.low || [],
      closes: q.close || []
    };
  }
}

function sliceMega(daysBack) {
  if (!megaData) return null;
  var cutoffTs = daysBack > 0
    ? Math.floor(Date.now() / 1000) - daysBack * 86400
    : 0;
  var closes = [], lo = Infinity, hi = -Infinity;
  for (var i = 0; i < megaData.timestamps.length; i++) {
    if (megaData.timestamps[i] < cutoffTs) continue;
    var c = megaData.closes[i];
    if (c !== null && isFinite(c)) closes.push(c);
    var l = megaData.lows[i];
    var h = megaData.highs[i];
    if (l !== null && isFinite(l) && l < lo) lo = l;
    if (h !== null && isFinite(h) && h > hi) hi = h;
  }
  if (!isFinite(lo) || !isFinite(hi) || closes.length === 0) return null;
  return { closes: closes, min: lo, max: hi };
}

function computeStatsFromMega(daysBack) {
  var s = sliceMega(daysBack);
  if (!s) return null;
  return {
    diff: s.max - s.min,
    pct: s.min !== 0 ? ((s.max - s.min) / s.min) * 100 : 0,
    up: s.closes[s.closes.length - 1] >= s.closes[0],
    min: s.min,
    max: s.max
  };
}

function minMaxFromDataArrays(dataArrays) {
  var lo = Infinity, hi = -Infinity;
  if (!Array.isArray(dataArrays)) return { min: lo, max: hi };
  for (var i = 0; i < dataArrays.length; i++) {
    var arr = dataArrays[i];
    if (!arr) continue;
    for (var j = 0; j < arr.length; j++) {
      var v = arr[j];
      if (v !== null && v !== undefined && isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
  }
  return { min: lo, max: hi };
}

function mergeStatsMinMax(stats, dataArrays) {
  var mm = minMaxFromDataArrays(dataArrays);
  if (isFinite(mm.min)) stats.min = isFinite(stats.min) ? Math.min(stats.min, mm.min) : mm.min;
  if (isFinite(mm.max)) stats.max = isFinite(stats.max) ? Math.max(stats.max, mm.max) : mm.max;
  return stats;
}

function getBounds(daysBack, dataArrays) {
  var lo = Infinity, hi = -Infinity;

  var s = sliceMega(daysBack);
  if (s) { lo = s.min; hi = s.max; }

  for (var i = 0; i < dataArrays.length; i++) {
    var arr = dataArrays[i];
    if (!arr) continue;
    for (var j = 0; j < arr.length; j++) {
      var v = arr[j];
      if (v !== null && v !== undefined && isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
  }
  return { lo: Math.floor(lo), hi: Math.ceil(hi) };
}

function applyBounds(chart, bounds) {
  if (isFinite(bounds.lo) && isFinite(bounds.hi)) {
    chart.options.scales.y.min = bounds.lo;
    chart.options.scales.y.max = bounds.hi;
  }
}

function chartOptions(xPadding) {
  var tc = getThemeColors();
  return {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    animation: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        enabled: false,
        external: externalTooltipHandler,
        callbacks: { label: function(c) { return c.dataset.label + ': $' + (c.parsed.y != null ? c.parsed.y.toFixed(2) : '--'); } }
      }
    },
    scales: {
      x: { ticks: { color: tc.text, maxRotation: 0, autoSkipPadding: xPadding || 30, font: { size: 12, family: tc.font } }, grid: { color: tc.gridLine } },
      y: {
        ticks: { color: tc.text, font: { size: 12, family: tc.fontMono }, callback: function(v) { return '$' + (v >= 100 ? Math.round(v) : v.toFixed(2)); } },
        grid: { color: tc.gridLine }
      }
    }
  };
}

// Helper: find first and last non-null values in an array
function firstLast(data) {
  var first = null, last = null;
  for (var i = 0; i < data.length; i++) { if (data[i] !== null) { first = data[i]; break; } }
  for (var j = data.length - 1; j >= 0; j--) { if (data[j] !== null) { last = data[j]; break; } }
  return { first: first, last: last };
}

// Grow/shrink always from chart data (native granularity).
// Diff/pct/min/max/up from mega when available, chart data as fallback.
function computeStats(data, daysBack, extraDataArrays) {
  var minMaxArrays = [data].concat(extraDataArrays || []);
  var growing = 0, shrinking = 0, segments = 0;
  for (var i = 1; i < data.length; i++) {
    if (data[i] !== null && data[i - 1] !== null) {
      segments++;
      if (data[i] > data[i - 1]) growing++;
      else if (data[i] < data[i - 1]) shrinking++;
    }
  }
  var growPct = segments > 0 ? (growing / segments) * 100 : 0;
  var shrinkPct = segments > 0 ? (shrinking / segments) * 100 : 0;

  if (daysBack !== undefined) {
    var mega = computeStatsFromMega(daysBack);
    if (mega) {
      mega.growPct = growPct;
      mega.shrinkPct = shrinkPct;
      return mergeStatsMinMax(mega, minMaxArrays);
    }
  }

  var fl = firstLast(data);
  var diff = 0, pct = 0;
  if (fl.first !== null && fl.last !== null) {
    diff = fl.last - fl.first;
    pct = fl.first !== 0 ? (diff / fl.first) * 100 : 0;
  }

  var lo = Infinity, hi = -Infinity;
  for (var k = 0; k < data.length; k++) {
    if (data[k] !== null && isFinite(data[k])) {
      if (data[k] < lo) lo = data[k];
      if (data[k] > hi) hi = data[k];
    }
  }

  return mergeStatsMinMax(
    { diff: diff, pct: pct, growPct: growPct, shrinkPct: shrinkPct, up: diff >= 0, min: lo, max: hi },
    minMaxArrays
  );
}

function buildStatsHtml(stats) {
  if (!stats) return '';
  return (isFinite(stats.min) ? '<span class="stat-pill"><span class="stat-label">Min</span> $' + stats.min.toFixed(2) + '</span>' : '') +
    (isFinite(stats.max) ? '<span class="stat-pill"><span class="stat-label">Max</span> $' + stats.max.toFixed(2) + '</span>' : '');
}

// Render min/max graph pills into a container element.
function renderStats(statsElId, stats) {
  var el = $(statsElId);
  if (!el) return;
  el.innerHTML = buildStatsHtml(stats);
}

// ─── Ghost dataset helper ────────────────────────────
function ghostBorderColor() {
  var accent = getComputedStyle(document.body).getPropertyValue('--accent').trim();
  var m = accent.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (m) return 'rgba(' + parseInt(m[1],16) + ',' + parseInt(m[2],16) + ',' + parseInt(m[3],16) + ',0.45)';
  return accent.replace('rgb(', 'rgba(').replace(')', ',0.45)');
}

function makeGhostDs(priorData) {
  return {
    label: 'Prior', data: priorData,
    borderColor: ghostBorderColor(),
    borderWidth: 1.5,
    pointRadius: 0,
    pointHoverRadius: 0,
    tension: 0.3,
    fill: false,
  };
}

function padAlign(arr, targetLen) {
  var out = arr.slice();
  while (out.length < targetLen) out.push(null);
  if (out.length > targetLen) out = out.slice(out.length - targetLen);
  return out;
}

var REGULAR_MARKET_START_MINUTES = 9 * 60 + 30;
var REGULAR_MARKET_END_MINUTES = 16 * 60;

function normalizePrice(value) {
  var n = Number(value);
  return isFinite(n) && n > 0 ? +n.toFixed(2) : null;
}

function hasPriceData(data) {
  if (!data) return false;
  for (var i = 0; i < data.length; i++) {
    if (data[i] !== null && data[i] !== undefined && isFinite(data[i])) return true;
  }
  return false;
}

function lastPrice(data) {
  if (!data) return null;
  for (var i = data.length - 1; i >= 0; i--) {
    if (data[i] !== null && data[i] !== undefined && isFinite(data[i])) return data[i];
  }
  return null;
}

function lastPoint(data) {
  if (!data) return { index: -1, value: null };
  for (var i = data.length - 1; i >= 0; i--) {
    if (data[i] !== null && data[i] !== undefined && isFinite(data[i])) {
      return { index: i, value: data[i] };
    }
  }
  return { index: -1, value: null };
}

function exchangeMinutes(timestamp, gmtoffset) {
  var exchangeDate = new Date((timestamp + (gmtoffset || 0)) * 1000);
  return exchangeDate.getUTCHours() * 60 + exchangeDate.getUTCMinutes();
}

function isRegularMarketTimestamp(timestamp, gmtoffset) {
  var minutes = exchangeMinutes(timestamp, gmtoffset);
  return minutes >= REGULAR_MARKET_START_MINUTES && minutes < REGULAR_MARKET_END_MINUTES;
}

function splitIntradaySeries(timestamps, closes, gmtoffset) {
  var regular = [];
  var extended = [];
  var combined = [];
  var hasExtended = false;

  for (var i = 0; i < timestamps.length; i++) {
    var price = normalizePrice(closes[i]);
    combined.push(price);

    if (price === null) {
      regular.push(null);
      extended.push(null);
      continue;
    }

    if (isRegularMarketTimestamp(timestamps[i], gmtoffset)) {
      regular.push(price);
      extended.push(null);
    } else {
      regular.push(null);
      extended.push(price);
      hasExtended = true;
    }
  }

  return {
    regular: regular,
    extended: extended,
    combined: combined,
    hasExtended: hasExtended
  };
}

function afterHoursColor() {
  var color = getComputedStyle(document.body).getPropertyValue('--after-hours').trim();
  return color || '#f5b642';
}

function colorToRgba(color, alpha) {
  var m = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (m) return 'rgba(' + parseInt(m[1],16) + ',' + parseInt(m[2],16) + ',' + parseInt(m[3],16) + ',' + alpha + ')';
  var rgb = color.match(/^rgb\(\s*([0-9]+)\s*,\s*([0-9]+)\s*,\s*([0-9]+)\s*\)$/i);
  if (rgb) return 'rgba(' + rgb[1] + ',' + rgb[2] + ',' + rgb[3] + ',' + alpha + ')';
  return color;
}

function makeExtendedHoursDs(extendedData) {
  var color = afterHoursColor();
  return {
    label: 'Extended Hours', data: extendedData,
    borderColor: color,
    backgroundColor: colorToRgba(color, 0.16),
    borderWidth: 2.5,
    pointRadius: 0,
    pointHoverRadius: 3,
    tension: 0.3,
    fill: true,
  };
}

function buildIntradayDatasets(args) {
  var dataset = {
    label: currentTicker, data: args.regularData,
    borderColor: 'rgba(138,150,170,0.4)',
    backgroundColor: 'rgba(138,150,170,0.08)',
    segment: segmentStyle,
    borderWidth: 3, pointRadius: 0, pointHoverRadius: 3, tension: 0.3, fill: true,
  };
  var prevDs = {
    label: 'Prev Close', data: Array(args.labels.length).fill(args.prevClose),
    borderColor: 'rgba(138,150,170,.25)', borderWidth: 1, borderDash: [6, 4],
    pointRadius: 0, fill: false,
  };
  var datasets = [dataset];
  if (hasPriceData(args.extendedData)) datasets.push(makeExtendedHoursDs(args.extendedData));
  datasets.push(prevDs);
  if (args.priorData) datasets.push(makeGhostDs(args.priorData));
  return datasets;
}

function getSessionQuote(meta, data, extendedData) {
  var state = String(meta.marketState || '').toUpperCase();
  var regularPrice = normalizePrice(meta.regularMarketPrice);
  var price = regularPrice;
  var extendedPrice = null;
  var extendedLabel = '';
  var session = 'today';
  var latestExtended = lastPoint(extendedData);

  if (state.indexOf('PRE') === 0) {
    var prePrice = normalizePrice(meta.preMarketPrice);
    var fallbackPrePrice = prePrice !== null ? prePrice : latestExtended.value;
    if (fallbackPrePrice !== null) {
      price = fallbackPrePrice;
      extendedPrice = fallbackPrePrice;
      extendedLabel = 'Pre';
      session = 'pre-market';
    }
  } else if (state.indexOf('POST') === 0 || state === 'CLOSED') {
    var postPrice = normalizePrice(meta.postMarketPrice);
    var fallbackPostPrice = postPrice !== null ? postPrice : latestExtended.value;
    if (fallbackPostPrice !== null) {
      price = fallbackPostPrice;
      extendedPrice = fallbackPostPrice;
      extendedLabel = 'AH';
      session = 'after hours';
    }
  } else if (latestExtended.value !== null && latestExtended.index === lastPoint(data).index) {
    var latestExtendedPrice = latestExtended.value;
    if (latestExtendedPrice !== null) {
      var label = regularPrice === null ? 'Ext' : 'AH';
      price = latestExtendedPrice;
      extendedPrice = latestExtendedPrice;
      extendedLabel = label;
      session = label === 'AH' ? 'after hours' : 'extended hours';
    }
  }

  if (price === null) price = lastPrice(data);
  if (regularPrice === null) regularPrice = price;
  return {
    price: price,
    regularPrice: regularPrice,
    extendedPrice: extendedPrice,
    extendedLabel: extendedLabel,
    session: session
  };
}

function buildHeaderPriceHtml(quote) {
  var mainPrice = quote.regularPrice !== null && quote.regularPrice !== undefined
    ? quote.regularPrice
    : quote.price;
  var html = '$' + mainPrice.toFixed(2);
  if (quote.extendedPrice !== null && quote.extendedPrice !== undefined) {
    html += '<span class="extended-price">' +
      esc(quote.extendedLabel) + ' $' + quote.extendedPrice.toFixed(2) +
    '</span>';
  }
  return html;
}

function renderHeaderPrice(quote) {
  $('stock-price').innerHTML = buildHeaderPriceHtml(quote);
}

// ─── Hour Chart (last 60 minutes) ────────────────────
var hourlyChart;

function fetchHourly() {
  return runJob('hourly', fetchHourlyJob);
}

async function fetchHourlyJob() {
  var requestedTicker = currentTicker;
  var json = await yahooFetch(chartUrl('range=1d&interval=1m&includePrePost=true'));
  if (disposed || requestedTicker !== currentTicker) return null;
  if (json && json.chart && json.chart.result) {
    return processHourlyData(json);
  } else {
    var loader = $('hourly-loader');
    if (loader) {
      loader.innerHTML =
        '<div style="text-align:center;line-height:1.5">' +
          '<div style="color:var(--red);margin-bottom:6px;font-size:13px;">Unable to load live stock data</div>' +
          '<div style="font-size:12px;color:var(--text);">Retrying\u2026</div>' +
        '</div>';
    }
    loadDemoHourlyData();
  }
}

async function processHourlyData(json) {
  var requestedTicker = currentTicker;
  var result = json.chart.result[0];
  var meta = result.meta;
  var timestamps = result.timestamp || [];
  var closes = result.indicators.quote[0].close || [];
  var series = splitIntradaySeries(timestamps, closes, meta.gmtoffset || 0);

  var allLabels = timestamps.map(function(t) {
    return new Date(t * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  });
  var allData = series.combined;
  var allRegularData = series.regular;
  var allExtendedData = series.extended;

  var n = allData.length;
  var cutoff = Math.max(0, n - 60);
  var labels = allLabels.slice(cutoff);
  var data = allRegularData.slice(cutoff);
  var extendedData = allExtendedData.slice(cutoff);
  var combinedData = allData.slice(cutoff);

  var priorStart = Math.max(0, cutoff - 60);
  var priorData = padAlign(allData.slice(priorStart, cutoff), data.length);

  var quote = getSessionQuote(meta, allData, allExtendedData);
  var price = quote.price;
  var prevClose = meta.chartPreviousClose || meta.previousClose;
  var diff = price - prevClose;

  if (diff === 0 && combinedData.length > 1) {
    var fl = firstLast(combinedData);
    if (fl.first !== null && fl.last !== null) {
      diff = fl.last - fl.first;
      price = fl.last;
      prevClose = fl.first;
    }
  }

  var pct = prevClose ? ((diff / prevClose) * 100).toFixed(2) : '0.00';
  var up = diff >= 0;

  renderHeaderPrice(quote);
  $('stock-change').innerHTML =
    '<span style="color:' + (up ? 'var(--green)' : 'var(--red)') + '">' +
      (up ? '+' : '') + diff.toFixed(2) + ' (' + (up ? '+' : '') + pct + '%) ' + quote.session +
    '</span>';

  var stats = computeStats(combinedData, 1);
  renderStats('hourly-stats', stats, true);
  updateNoseColor(up);

  await yieldFrame();
  if (disposed || requestedTicker !== currentTicker) return null;
  renderHourlyChart(labels, data, prevClose, priorData, extendedData);
  if ($('hourly-loader')) $('hourly-loader').style.display = 'none';
  markChartLoaded('hourly');
}

function loadDemoHourlyData() {
  var basePrice = 62.50;
  var allLabels = [];
  var allData = [];
  var now = new Date();
  now.setHours(9, 30, 0, 0);

  for (var i = 0; i < 390; i++) {
    var t = new Date(now.getTime() + i * 60000);
    allLabels.push(t.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
    var noise = (Math.random() - 0.48) * 0.3;
    var trend = i * 0.002;
    allData.push(+(basePrice + trend + noise + Math.sin(i / 40) * 0.4).toFixed(2));
  }

  var n = allData.length;
  var cutoff = Math.max(0, n - 60);
  var labels = allLabels.slice(cutoff);
  var data = allData.slice(cutoff);
  var priorData = padAlign(allData.slice(Math.max(0, cutoff - 60), cutoff), data.length);

  var price = data[data.length - 1];
  var prevClose = basePrice;
  var diff = price - prevClose;
  var pct = ((diff / prevClose) * 100).toFixed(2);
  var up = diff >= 0;

  if ($('stock-price')) $('stock-price').textContent = '$' + price.toFixed(2);
  if ($('stock-change')) $('stock-change').innerHTML =
    '<span style="color:' + (up ? 'var(--green)' : 'var(--red)') + '">' +
      (up ? '+' : '') + diff.toFixed(2) + ' (' + (up ? '+' : '') + pct + '%)' +
    '</span> <span style="color:var(--text);">(demo)</span>';

  var stats = computeStats(data, 1);
  renderStats('hourly-stats', stats, true);

  updateNoseColor(up);
  renderHourlyChart(labels, data, prevClose, priorData);
  if ($('hourly-loader')) $('hourly-loader').style.display = 'none';
  markChartLoaded('hourly');
}

function renderHourlyChart(labels, data, prevClose, priorData, extendedData) {
  var datasets = buildIntradayDatasets({
    labels: labels,
    regularData: data,
    extendedData: extendedData,
    prevClose: prevClose,
    priorData: priorData
  });

  var bounds = getBounds(1, [data, extendedData, priorData]);

  if (hourlyChart) {
    hourlyChart.data.labels = labels;
    hourlyChart.data.datasets = datasets;
    applyBounds(hourlyChart, bounds);
    hourlyChart.update('none');
  } else {
    var opts = chartOptions(30);
    opts.scales.y.min = bounds.lo;
    opts.scales.y.max = bounds.hi;
    var canvas = $('hourlyChart');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    hourlyChart = new Chart(ctx, {
      type: 'line',
      data: { labels: labels, datasets: datasets },
      options: opts
    });
  }
}

// ─── Daily Chart (per-minute intervals, prior day ghost) ─
var stockChart;

function fetchStockWithFallback() {
  return runJob('stock', fetchStockWithFallbackJob);
}

async function fetchStockWithFallbackJob() {
  var requestedTicker = currentTicker;
  if (loadClosedWidgetIds().indexOf('stock') !== -1) {
    markChartLoaded('stock');
    return;
  }
  var json = await yahooFetch(chartUrl('range=5d&interval=1m&includePrePost=true'));
  if (disposed || requestedTicker !== currentTicker) return null;
  if (json && json.chart && json.chart.result) {
    return processStockData(json);
  } else {
    var loader = $('stock-loader');
    if (loader) {
      loader.innerHTML =
        '<div style="text-align:center;line-height:1.5">' +
          '<div style="color:var(--red);margin-bottom:6px;font-size:13px;">Unable to load data</div>' +
          '<div style="font-size:12px;color:var(--text);">Retrying\u2026</div>' +
        '</div>';
    }
  }
}

async function processStockData(json) {
  var requestedTicker = currentTicker;
  var result = json.chart.result[0];
  var meta = result.meta;
  var timestamps = result.timestamp || [];
  var closes = result.indicators.quote[0].close || [];
  var series = splitIntradaySeries(timestamps, closes, meta.gmtoffset || 0);

  var byDate = {};
  for (var i = 0; i < timestamps.length; i++) {
    var d = new Date(timestamps[i] * 1000);
    var dateKey = d.toDateString();
    if (!byDate[dateKey]) byDate[dateKey] = { labels: [], regular: [], extended: [], combined: [] };
    byDate[dateKey].labels.push(d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
    byDate[dateKey].regular.push(series.regular[i]);
    byDate[dateKey].extended.push(series.extended[i]);
    byDate[dateKey].combined.push(series.combined[i]);
  }

  var dates = Object.keys(byDate).sort(function(a, b) { return new Date(a) - new Date(b); });
  var cur = byDate[dates[dates.length - 1]] || { labels: [], regular: [], extended: [], combined: [] };
  var prev = dates.length >= 2 ? byDate[dates[dates.length - 2]] : null;

  var labels = cur.labels;
  var data = cur.regular;
  var extendedData = cur.extended;
  var combinedData = cur.combined;
  var priorData = prev ? padAlign(prev.combined, combinedData.length) : null;

  var prevClose = meta.chartPreviousClose || meta.previousClose;
  var stats = computeStats(combinedData, 2);
  renderStats('today-stats', stats, true);

  await yieldFrame();
  if (disposed || requestedTicker !== currentTicker) return null;
  renderStockChart(labels, data, prevClose, priorData, extendedData);
  if ($('stock-loader')) $('stock-loader').style.display = 'none';
  markChartLoaded('stock');
}

function renderStockChart(labels, data, prevClose, priorData, extendedData) {
  var datasets = buildIntradayDatasets({
    labels: labels,
    regularData: data,
    extendedData: extendedData,
    prevClose: prevClose,
    priorData: priorData
  });

  var bounds = getBounds(2, [data, extendedData, priorData]);

  if (stockChart) {
    stockChart.data.labels = labels;
    stockChart.data.datasets = datasets;
    applyBounds(stockChart, bounds);
    stockChart.update('none');
  } else {
    var opts = chartOptions(30);
    opts.scales.y.min = bounds.lo;
    opts.scales.y.max = bounds.hi;
    var canvas = $('stockChart');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    stockChart = new Chart(ctx, {
      type: 'line',
      data: { labels: labels, datasets: datasets },
      options: opts
    });
  }
}

// ─── Range Charts (1 Month, 1 Year, All-Time) ───────
var rangeCharts = {};

var ranges = [
  { id: 'month',   canvasId: 'monthChart',   loaderId: 'month-loader',   statsId: 'month-stats',   range: '3mo',  interval: '1d',  labelFmt: { month: 'short', day: 'numeric' }, hasPrior: true,  showDays: 30,  megaDays: 90 },
  { id: 'year',    canvasId: 'yearChart',     loaderId: 'year-loader',    statsId: 'year-stats',    range: '2y',   interval: '1d',  labelFmt: { year: 'numeric', month: 'short' }, hasPrior: true,  showDays: 365, megaDays: 730 },
  { id: 'alltime', canvasId: 'alltimeChart',  loaderId: 'alltime-loader', statsId: 'alltime-stats', range: 'max',  interval: '1mo', labelFmt: { year: 'numeric', month: 'short' }, hasPrior: false, showDays: 0,   megaDays: 0 },
];

function fetchRange(cfg) {
  return runJob('range:' + cfg.id, function() { return fetchRangeJob(cfg); });
}

async function fetchRangeJob(cfg) {
  var requestedTicker = currentTicker;
  var json = await yahooFetch(chartUrl('range=' + cfg.range + '&interval=' + cfg.interval));
  if (disposed || requestedTicker !== currentTicker) return null;
  if (json && json.chart && json.chart.result) {
    var result = json.chart.result[0];
    var timestamps = result.timestamp || [];
    var closes = result.indicators.quote[0].close || [];

    var allLabels = timestamps.map(function(t) {
      return new Date(t * 1000).toLocaleDateString('en-US', cfg.labelFmt);
    });
    var allData = closes.map(function(c) { return c !== null ? +c.toFixed(2) : null; });

    var labels, data, priorData = null;
    if (cfg.hasPrior && cfg.showDays > 0) {
      var cutoffTs = Math.floor(Date.now() / 1000) - cfg.showDays * 86400;
      var cutIdx = timestamps.length;
      for (var k = 0; k < timestamps.length; k++) {
        if (timestamps[k] >= cutoffTs) { cutIdx = k; break; }
      }
      priorData = allData.slice(0, cutIdx);
      data = allData.slice(cutIdx);
      labels = allLabels.slice(cutIdx);
      priorData = padAlign(priorData, data.length);
    } else {
      labels = allLabels;
      data = allData;
    }

    var stats = computeStats(data, cfg.megaDays);
    renderStats(cfg.statsId, stats, cfg.hasPrior);
    await yieldFrame();
    if (disposed || requestedTicker !== currentTicker) return null;
    renderRangeChart(cfg, labels, data, priorData);
    if ($(cfg.loaderId)) $(cfg.loaderId).style.display = 'none';
    markChartLoaded(cfg.id);
  } else {
    var loader = $(cfg.loaderId);
    if (loader) {
      loader.innerHTML =
        '<div style="text-align:center;line-height:1.5">' +
          '<div style="color:var(--red);margin-bottom:6px;font-size:13px;">Unable to load data</div>' +
          '<div style="font-size:12px;color:var(--text);">Retrying&hellip;</div>' +
        '</div>';
    }
  }
}

function renderRangeChart(cfg, labels, data, priorData) {
  var dataset = {
    label: currentTicker, data: data,
    borderColor: 'rgba(138,150,170,0.4)',
    backgroundColor: 'rgba(138,150,170,0.08)',
    segment: segmentStyle,
    borderWidth: 3, pointRadius: 0, pointHoverRadius: 3, tension: 0.3, fill: true,
  };
  var datasets = [dataset];
  if (priorData) datasets.push(makeGhostDs(priorData));

  var bounds = getBounds(cfg.megaDays, [data, priorData]);

  if (rangeCharts[cfg.id]) {
    var ch = rangeCharts[cfg.id];
    ch.data.labels = labels;
    ch.data.datasets = datasets;
    applyBounds(ch, bounds);
    ch.update('none');
  } else {
    var opts = chartOptions(40);
    opts.scales.y.min = bounds.lo;
    opts.scales.y.max = bounds.hi;
    var canvas = $(cfg.canvasId);
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    rangeCharts[cfg.id] = new Chart(ctx, {
      type: 'line',
      data: { labels: labels, datasets: datasets },
      options: opts
    });
  }
}

function fetchAllRanges() {
  var closed = loadClosedWidgetIds();
  ranges.forEach(function(cfg) {
    if (closed.indexOf(cfg.id) !== -1) markChartLoaded(cfg.id);
    else fetchRange(cfg);
  });
}

// ─── Refresh Interval Setting ────────────────────────
var refreshTimerStock = null;
var refreshTimerRanges = null;

var REFRESH_MS = 1000;
var refreshTimerHourly = null;

function startTimers(ms) {
  if (refreshTimerHourly) clearInterval(refreshTimerHourly);
  if (refreshTimerStock) clearInterval(refreshTimerStock);
  if (refreshTimerRanges) clearInterval(refreshTimerRanges);
  if (refreshTimerNews) clearInterval(refreshTimerNews);
  refreshTimerHourly = setInterval(fetchHourly, ms);
  var dailyMs = Math.max(ms * 5, 5000);
  refreshTimerStock = setInterval(fetchStockWithFallback, dailyMs);
  var rangeMs = Math.max(ms * 10, 30000);
  refreshTimerRanges = setInterval(function() { fetchMegaData(); fetchAllRanges(); }, rangeMs);
  refreshTimerNews = setInterval(function() {
    if (!shouldRefreshNews({
      hidden: document.hidden,
      loading: newsIsLoading,
      lastFetchAt: lastNewsFetchAt,
      now: nowMs(),
      interval: NEWS_REFRESH_MS
    })) return;
    fetchNewsForTicker(currentTicker, { background: newsItems.length > 0 });
  }, NEWS_REFRESH_MS);
}

// ─── Loader dismiss ──────────────────────────────────
var _loaderDismissed = false;
var _chartsLoaded = {};

function markChartLoaded(id) {
  _chartsLoaded[id] = true;
  var needed = ['hourly', 'stock', 'month', 'year', 'alltime'];
  for (var i = 0; i < needed.length; i++) {
    if (!_chartsLoaded[needed[i]]) return;
  }
  dismissLoader();
}

function dismissLoader() {
  if (_loaderDismissed) return;
  _loaderDismissed = true;
  var el = $('loader');
  if (!el) return;
  el.classList.add('fade-out');
  el.addEventListener('transitionend', function() { el.remove(); });
  setTimeout(function() { el.remove(); }, 600);
}

// ─── Gridstack Dashboard ─────────────────────────────
var GRID_STORAGE_KEY = 'rudolph-grid-layout';
var CLOSED_WIDGETS_STORAGE_KEY = 'rudolph-closed-widgets';
var GRID_VERSION = 5;
var dashGrid = null;

var DEFAULT_LAYOUT = [
  { id: 'hourly',  x: 0, y: 0, w: 12, h: 3 },
  { id: 'stock',   x: 0, y: 3, w: 6,  h: 3 },
  { id: 'month',   x: 6, y: 3, w: 6,  h: 3 },
  { id: 'year',    x: 0, y: 6, w: 6,  h: 3 },
  { id: 'alltime', x: 6, y: 6, w: 6,  h: 3 },
];

var WIDGETS = [
  { id: 'hourly', title: 'Hour' },
  { id: 'stock', title: 'Today' },
  { id: 'month', title: '1 Month' },
  { id: 'year', title: '1 Year' },
  { id: 'alltime', title: 'All-Time' },
];

var DEFAULT_GRID_ROWS = 9;
var detachedWidgetElements = {};

function getStorageItem(storage, key) {
  if (storage && typeof storage.getItem === 'function') return storage.getItem(key);
  return storage ? storage[key] : null;
}

function setStorageItem(storage, key, value) {
  if (storage && typeof storage.setItem === 'function') storage.setItem(key, value);
  else if (storage) storage[key] = value;
}

function removeStorageItem(storage, key) {
  if (storage && typeof storage.removeItem === 'function') storage.removeItem(key);
  else if (storage) delete storage[key];
}

function widgetExists(id, widgets) {
  widgets = widgets || WIDGETS;
  return widgets.some(function(w) { return w.id === id; });
}

function normalizeWidgetIds(ids, widgets) {
  var out = [];
  if (!Array.isArray(ids)) return out;
  ids.forEach(function(id) {
    if (widgetExists(id, widgets) && out.indexOf(id) === -1) out.push(id);
  });
  return out;
}

function saveClosedWidgetIds(ids, storage) {
  storage = storage || localStorage;
  setStorageItem(storage, CLOSED_WIDGETS_STORAGE_KEY, JSON.stringify(normalizeWidgetIds(ids)));
}

function loadClosedWidgetIds(storage) {
  storage = storage || localStorage;
  try {
    return normalizeWidgetIds(JSON.parse(getStorageItem(storage, CLOSED_WIDGETS_STORAGE_KEY) || '[]'));
  } catch (e) {
    removeStorageItem(storage, CLOSED_WIDGETS_STORAGE_KEY);
    return [];
  }
}

function getClosedWidgetOptions(closedIds, widgets) {
  widgets = widgets || WIDGETS;
  closedIds = normalizeWidgetIds(closedIds, widgets);
  return closedIds.map(function(id) {
    return widgets.find(function(w) { return w.id === id; });
  }).filter(Boolean);
}

function defaultLayoutFor(id) {
  return DEFAULT_LAYOUT.find(function(item) { return item.id === id; });
}

function storedLayoutFor(id) {
  var layout = loadGridLayout();
  var item = layout && layout.find(function(n) { return n.id === id; });
  return item || defaultLayoutFor(id);
}

function getOpenWidgetLayout(layout, closedIds) {
  closedIds = normalizeWidgetIds(closedIds || []);
  return (layout || []).filter(function(item) {
    return item && closedIds.indexOf(item.id) === -1;
  });
}

function cacheWidgetElement(el) {
  if (!el) return null;
  var id = el.getAttribute('gs-id');
  if (id) detachedWidgetElements[id] = el;
  return el;
}

function findWidgetElement(id) {
  return document.querySelector('[gs-id="' + id + '"]') || detachedWidgetElements[id] || null;
}

function detachClosedWidgetsBeforeGridInit(gridEl, closedIds) {
  closedIds = normalizeWidgetIds(closedIds);
  closedIds.forEach(function(id) {
    var el = gridEl.querySelector('[gs-id="' + id + '"]');
    if (!el) return;
    cacheWidgetElement(el);
    el.classList.add('widget-hidden');
    gridEl.removeChild(el);
  });
}

function layoutFromNode(node) {
  if (!node) return null;
  return { id: node.id, x: node.x, y: node.y, w: node.w, h: node.h };
}

function saveWidgetLayoutEntry(id, layout) {
  if (!layout) return;
  var existing = loadGridLayout() || DEFAULT_LAYOUT;
  var found = false;
  var items = existing.map(function(item) {
    if (item.id !== id) return item;
    found = true;
    return { id: id, x: layout.x, y: layout.y, w: layout.w, h: layout.h };
  });
  if (!found) items.push({ id: id, x: layout.x, y: layout.y, w: layout.w, h: layout.h });
  localStorage.setItem(GRID_STORAGE_KEY, JSON.stringify({ v: GRID_VERSION, items: items }));
}

function destroyWidgetChart(id) {
  if (id === 'hourly' && hourlyChart) {
    hourlyChart.destroy();
    hourlyChart = null;
  } else if (id === 'stock' && stockChart) {
    stockChart.destroy();
    stockChart = null;
  } else if (rangeCharts[id]) {
    rangeCharts[id].destroy();
    delete rangeCharts[id];
  }
}

function refreshWidget(id) {
  if (id === 'hourly') fetchHourly();
  else if (id === 'stock') fetchStockWithFallback();
  else {
    var cfg = ranges.find(function(range) { return range.id === id; });
    if (cfg) fetchRange(cfg);
  }
}

function saveGridLayout() {
  if (!dashGrid) return;
  var existing = loadGridLayout() || DEFAULT_LAYOUT;
  var byId = {};
  existing.forEach(function(n) { byId[n.id] = n; });
  var nodes = dashGrid.engine.nodes;
  nodes.forEach(function(n) {
    byId[n.id] = { id: n.id, x: n.x, y: n.y, w: n.w, h: n.h };
  });
  var items = WIDGETS.map(function(widget) {
    return byId[widget.id] || defaultLayoutFor(widget.id);
  }).filter(Boolean);
  localStorage.setItem(GRID_STORAGE_KEY, JSON.stringify({ v: GRID_VERSION, items: items }));
}

function buildGridOptions(args) {
  return {
    column: 12,
    cellHeight: args.cellHeight,
    maxRow: args.rows,
    margin: args.margin,
    animate: true,
    float: true,
    handle: '.card-header',
    resizable: { handles: 'e,se,s,sw,w' },
  };
}

function buildWidgetMenuHtml(closed) {
  closed = Array.isArray(closed) ? closed : [];
  var widgetItems = closed.map(function(widget) {
    return '<button type="button" data-widget-id="' + esc(widget.id) + '">' + esc(widget.title) + '</button>';
  }).join('');
  if (!widgetItems) widgetItems = '<div class="widget-menu-empty">All widgets are shown</div>';
  return '<div class="widget-menu-items">' + widgetItems + '</div>' +
    '<div class="widget-menu-footer"><button type="button" data-widget-action="reset-grid" role="menuitem">Reset Grid</button></div>';
}

function renderWidgetMenu() {
  var menu = $('widget-menu');
  if (!menu) return;
  menu.innerHTML = buildWidgetMenuHtml(getClosedWidgetOptions(loadClosedWidgetIds()));
}

function resetDashboardLayout(storage, reload) {
  var targetStorage = storage || localStorage;
  targetStorage.removeItem(GRID_STORAGE_KEY);
  targetStorage.removeItem(CLOSED_WIDGETS_STORAGE_KEY);
  (reload || function() { location.reload(); })();
}

function chooseDropdownMenuDirection(metrics) {
  var gutter = typeof metrics.gutter === 'number' ? metrics.gutter : 8;
  var viewportWidth = Math.max(0, Number(metrics.viewportWidth) || 0);
  var buttonLeft = Number(metrics.buttonLeft) || 0;
  var buttonRight = Number(metrics.buttonRight) || buttonLeft;
  var menuWidth = Math.max(0, Number(metrics.menuWidth) || 0);
  if (!viewportWidth || !menuWidth) return 'left';

  var rightOverflow = buttonLeft + menuWidth - (viewportWidth - gutter);
  var leftOverflow = gutter - (buttonRight - menuWidth);
  var rightFits = rightOverflow <= 0;
  var leftFits = leftOverflow <= 0;

  if (rightFits) return 'right';
  if (leftFits) return 'left';
  return rightOverflow <= leftOverflow ? 'right' : 'left';
}

function dropdownMenuLeftForDirection(metrics) {
  var gutter = typeof metrics.gutter === 'number' ? metrics.gutter : 8;
  var viewportWidth = Math.max(0, Number(metrics.viewportWidth) || 0);
  var buttonLeft = Number(metrics.buttonLeft) || 0;
  var buttonRight = Number(metrics.buttonRight) || buttonLeft;
  var menuWidth = Math.max(0, Number(metrics.menuWidth) || 0);
  var left = metrics.direction === 'left' ? buttonRight - menuWidth : buttonLeft;
  if (!viewportWidth || !menuWidth) return Math.max(gutter, left);
  return Math.max(gutter, Math.min(left, viewportWidth - menuWidth - gutter));
}

function setDropdownMenuDirection(menu, direction) {
  if (!menu || !menu.classList) return;
  menu.classList.remove('menu-open-left');
  menu.classList.remove('menu-open-right');
  menu.classList.add(direction === 'right' ? 'menu-open-right' : 'menu-open-left');
}

function positionAnchoredDropdownMenu(menu, button) {
  if (!menu || !button || typeof button.getBoundingClientRect !== 'function') return;
  var buttonRect = button.getBoundingClientRect();
  var menuRect = typeof menu.getBoundingClientRect === 'function' ? menu.getBoundingClientRect() : { width: 0 };
  var menuWidth = menuRect.width || menu.offsetWidth || 210;
  setDropdownMenuDirection(menu, chooseDropdownMenuDirection({
    buttonLeft: buttonRect.left,
    buttonRight: buttonRect.right,
    menuWidth: menuWidth,
    viewportWidth: window.innerWidth
  }));
}

function positionOpenDropdownMenus() {
  var widgetMenu = $('widget-menu');
  var tickerPanel = $('ticker-panel');
  if (widgetMenu && widgetMenu.classList.contains('open')) {
    positionAnchoredDropdownMenu(widgetMenu, $('add-widget-btn'));
  }
  if (tickerPanel && tickerPanel.classList.contains('open')) {
    positionTickerPanel();
  }
}

function setWidgetMenuOpen(open) {
  var menu = $('widget-menu');
  if (!menu) return;
  menu.classList.toggle('open', open);
  if (open) {
    positionAnchoredDropdownMenu(menu, $('add-widget-btn'));
  } else {
    menu.classList.remove('menu-open-left');
    menu.classList.remove('menu-open-right');
  }
}

function isThemeMenuSelectionTarget(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return !!(target.closest('[data-theme]') || target.closest('[data-appearance]'));
}

function closeWidget(id) {
  if (!dashGrid || !widgetExists(id)) return;
  var el = findWidgetElement(id);
  if (!el) return;
  var node = el.gridstackNode;
  if (node) {
    saveWidgetLayoutEntry(id, layoutFromNode(node));
    node._isAboutToRemove = true;
  }
  destroyWidgetChart(id);
  cacheWidgetElement(el);
  dashGrid.removeWidget(el, true, true);
  el.classList.add('widget-hidden');
  var closed = loadClosedWidgetIds();
  if (closed.indexOf(id) === -1) closed.push(id);
  saveClosedWidgetIds(closed);
  renderWidgetMenu();
  fitGridToViewport();
}

function addWidget(id) {
  if (!dashGrid || !widgetExists(id)) return;
  var el = findWidgetElement(id);
  if (!el) return;
  var layout = storedLayoutFor(id);
  allowGridInsertionOverflow(dashGrid);
  el.classList.remove('widget-hidden');
  dashGrid.addWidget(el, layout);
  var closed = loadClosedWidgetIds().filter(function(closedId) { return closedId !== id; });
  saveClosedWidgetIds(closed);
  rebalanceOpenGridWidgets(dashGrid);
  renderWidgetMenu();
  setWidgetMenuOpen(false);
  saveGridLayout();
  fitGridToViewport();
  refreshWidget(id);
}

function applyClosedWidgets() {
  renderWidgetMenu();
}

function initWidgetControls() {
  if (document.querySelectorAll) {
    document.querySelectorAll('.widget-close-btn').forEach(function(btn) {
      listen(btn, 'click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        closeWidget(btn.dataset.widgetId);
      });
    });
  }

  var addBtn = $('add-widget-btn');
  if (addBtn) {
    listen(addBtn, 'click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      renderWidgetMenu();
      setWidgetMenuOpen(!$('widget-menu').classList.contains('open'));
    });
  }

  var menu = $('widget-menu');
  if (menu) {
    listen(menu, 'click', function(e) {
      var action = e.target.closest('[data-widget-action]');
      if (action && action.dataset.widgetAction === 'reset-grid') {
        setWidgetMenuOpen(false);
        resetDashboardLayout();
        return;
      }
      var item = e.target.closest('[data-widget-id]');
      if (!item) return;
      addWidget(item.dataset.widgetId);
    });
  }
}

function loadGridLayout() {
  try {
    var raw = localStorage.getItem(GRID_STORAGE_KEY);
    if (!raw) return null;
    var data = JSON.parse(raw);
    if (data && data.v === GRID_VERSION && Array.isArray(data.items)) return data.items;
    localStorage.removeItem(GRID_STORAGE_KEY);
  } catch (e) {
    localStorage.removeItem(GRID_STORAGE_KEY);
  }
  return null;
}

function resizeAllCharts() {
  [hourlyChart, stockChart].forEach(function(c) { if (c) c.resize(); });
  Object.keys(rangeCharts).forEach(function(k) { if (rangeCharts[k]) rangeCharts[k].resize(); });
}

function getThemeGap() {
  var v = getComputedStyle(document.body).getPropertyValue('--gap-grid').trim();
  return parseInt(v, 10) || 8;
}

function getMaxRow(layout) {
  if (!layout) layout = DEFAULT_LAYOUT;
  var max = 0;
  layout.forEach(function(n) { max = Math.max(max, (n.y || 0) + (n.h || 1)); });
  return Math.max(max || DEFAULT_GRID_ROWS, DEFAULT_GRID_ROWS);
}

function allowGridInsertionOverflow(grid) {
  if (!grid || !grid.engine) return;
  if (grid.opts) grid.opts.maxRow = 0;
  grid.engine.maxRow = 0;
}

function buildBalancedWidgetLayout(widgetIds, rows) {
  widgetIds = normalizeWidgetIds(widgetIds || []);
  var count = widgetIds.length;
  if (!count) return [];

  var totalRows = Math.max(parseInt(rows, 10) || DEFAULT_GRID_ROWS, count);
  var columns = count <= 3 ? count : Math.min(3, Math.ceil(Math.sqrt(count)));
  var rowCount = Math.ceil(count / columns);
  var baseRowHeight = Math.floor(totalRows / rowCount);
  var extraRows = totalRows % rowCount;
  var layout = [];
  var widgetIndex = 0;
  var y = 0;

  for (var row = 0; row < rowCount; row++) {
    var remaining = count - widgetIndex;
    var itemsInRow = Math.min(columns, remaining);
    var rowHeight = baseRowHeight + (row < extraRows ? 1 : 0);
    var baseWidth = Math.floor(12 / itemsInRow);
    var extraWidth = 12 % itemsInRow;
    var x = 0;

    for (var col = 0; col < itemsInRow; col++) {
      var width = baseWidth + (col < extraWidth ? 1 : 0);
      layout.push({
        id: widgetIds[widgetIndex],
        x: x,
        y: y,
        w: width,
        h: rowHeight
      });
      x += width;
      widgetIndex += 1;
    }
    y += rowHeight;
  }

  return layout;
}

function getOpenWidgetIdsFromGrid(grid) {
  if (!grid || !grid.engine || !Array.isArray(grid.engine.nodes)) return [];
  var present = {};
  grid.engine.nodes.forEach(function(node) {
    if (node && widgetExists(node.id)) present[node.id] = true;
  });
  return WIDGETS.map(function(widget) { return widget.id; }).filter(function(id) {
    return present[id];
  });
}

function rebalanceOpenGridWidgets(grid) {
  if (!grid || typeof grid.load !== 'function') return;
  var layout = buildBalancedWidgetLayout(getOpenWidgetIdsFromGrid(grid), DEFAULT_GRID_ROWS);
  if (!layout.length) return;
  allowGridInsertionOverflow(grid);
  grid.load(layout, false);
}

function calculateCellHeight(availableHeight, rows) {
  var safeRows = Math.max(parseInt(rows, 10) || DEFAULT_GRID_ROWS, 1);
  var safeHeight = parseFloat(availableHeight) || 0;
  return Math.max(30, safeHeight / safeRows);
}

function readCssPx(styles, name) {
  return parseFloat(styles.getPropertyValue(name)) || 0;
}

function getGridAvailableHeight() {
  var grid = document.getElementById('dashboard-grid');
  if (grid) {
    var gridHeight = grid.clientHeight ||
      grid.offsetHeight ||
      (grid.getBoundingClientRect ? grid.getBoundingClientRect().height : 0);
    if (gridHeight > 0) return gridHeight;
  }

  var hdr = document.querySelector('header');
  var bodyStyles = getComputedStyle(document.body);
  var frameY = readCssPx(bodyStyles, 'padding-top') + readCssPx(bodyStyles, 'padding-bottom');
  var bodyGap = readCssPx(bodyStyles, 'row-gap') || readCssPx(bodyStyles, 'gap');
  return window.innerHeight - (hdr ? hdr.offsetHeight : 0) - frameY - bodyGap;
}

function computeCellH(rows) {
  return calculateCellHeight(getGridAvailableHeight(), rows);
}

function fitGridToViewport() {
  if (!dashGrid) return;
  var m = Math.round(getThemeGap() / 2);
  var nodes = dashGrid.engine.nodes;
  var saved = loadGridLayout();
  var closed = loadClosedWidgetIds();
  var layout = saved && saved.length ? getOpenWidgetLayout(saved, closed) : (nodes.length ? nodes : null);
  var rows = getMaxRow(layout);
  var ch = computeCellH(rows);
  dashGrid.batchUpdate();
  dashGrid.margin(m);
  dashGrid.cellHeight(ch);
  dashGrid.opts.maxRow = rows;
  dashGrid.engine.maxRow = rows;
  dashGrid.batchUpdate(false);
  setTimeout(resizeAllCharts, 60);
}

function syncGridToTheme() {
  fitGridToViewport();
}

function initDashboardGrid() {
  var el = document.getElementById('dashboard-grid');
  if (!el) { console.warn('Grid element not found'); return; }
  if (typeof GridStack === 'undefined') { console.warn('GridStack not loaded'); return; }

  var saved = loadGridLayout();
  var closed = loadClosedWidgetIds();
  detachClosedWidgetsBeforeGridInit(el, closed);
  var layout = getOpenWidgetLayout((saved && saved.length) ? saved : DEFAULT_LAYOUT, closed);

  layout.forEach(function(item) {
    var node = el.querySelector('[gs-id="' + item.id + '"]');
    if (node) {
      node.setAttribute('gs-x', item.x != null ? item.x : 0);
      node.setAttribute('gs-y', item.y != null ? item.y : 0);
      node.setAttribute('gs-w', item.w != null ? item.w : 6);
      node.setAttribute('gs-h', item.h != null ? item.h : 3);
    }
  });

  var gap = getThemeGap();
  var m = Math.round(gap / 2);
  var rows = getMaxRow(layout);
  var ch = computeCellH(rows);

  try {
    dashGrid = GridStack.init(buildGridOptions({
      cellHeight: ch,
      margin: m,
      rows: rows
    }), el);
  } catch (e) {
    console.error('GridStack.init() threw:', e);
    return;
  }

  if (!dashGrid) { console.error('GridStack.init() returned null'); return; }

  dashGrid.on('change', function() {
    saveGridLayout();
    setTimeout(resizeAllCharts, 60);
  });
  dashGrid.on('resizestop', function() { setTimeout(resizeAllCharts, 60); });
  dashGrid.on('dragstop', function() { setTimeout(resizeAllCharts, 60); });

  applyClosedWidgets();
  setTimeout(fitGridToViewport, 100);

  var resizeTimer;
  listen(window, 'resize', function() {
    clearTimeout(resizeTimer);
    positionOpenDropdownMenus();
    resizeTimer = setTimeout(fitGridToViewport, 150);
  });
}

// ─── Header bookmarks menu ──────────────────────────
var bookmarkRefreshTimer = null;
var bookmarkRootNodes = [];
var bookmarkRootFolder = { title: 'Bookmarks', children: [] };
var bookmarkStatusMessage = 'Loading Chrome bookmarks…';
var bookmarkMenuStack = [];
var bookmarkMenuAnchor = null;
var bookmarkMenuEl = null;

function bookmarkWebUrl(value) {
  if (typeof value !== 'string' || !value) return '';
  try {
    var parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
  } catch (e) {
    return '';
  }
}

function bookmarkEntries(nodes) {
  return (nodes || []).filter(function(node) {
    return node && (Array.isArray(node.children) || !!bookmarkWebUrl(node.url));
  });
}

function positionBookmarkMenu() {
  if (!bookmarkMenuEl || !bookmarkMenuAnchor || !bookmarkMenuEl.matches(':popover-open')) return;
  var anchorRect = bookmarkMenuAnchor.getBoundingClientRect();
  var menuRect = bookmarkMenuEl.getBoundingClientRect();
  var left = Math.max(10, Math.min(anchorRect.left, window.innerWidth - menuRect.width - 10));
  var top = anchorRect.bottom + 6;
  if (top + menuRect.height > window.innerHeight - 10 && anchorRect.top > menuRect.height + 16) {
    top = anchorRect.top - menuRect.height - 6;
  }
  bookmarkMenuEl.style.left = left + 'px';
  bookmarkMenuEl.style.top = Math.max(10, Math.min(top, window.innerHeight - menuRect.height - 10)) + 'px';
}

function closeBookmarkMenu(restoreFocus) {
  if (bookmarkMenuEl && bookmarkMenuEl.matches(':popover-open')) bookmarkMenuEl.hidePopover();
  bookmarkMenuStack = [];
  var anchor = bookmarkMenuAnchor;
  bookmarkMenuAnchor = null;
  if (anchor) anchor.setAttribute('aria-expanded', 'false');
  if (restoreFocus && anchor && document.contains(anchor)) anchor.focus();
}

function focusBookmarkMenu() {
  var firstItem = bookmarkMenuEl && bookmarkMenuEl.querySelector('.bookmark-menu-back, .bookmark-menu-item');
  if (firstItem) firstItem.focus();
}

function renderBookmarkMenu() {
  if (!bookmarkMenuEl || !bookmarkMenuStack.length) return;
  bookmarkMenuEl.textContent = '';
  var currentFolder = bookmarkMenuStack[bookmarkMenuStack.length - 1];
  var header = document.createElement('div');
  header.className = 'bookmark-menu-header';

  if (bookmarkMenuStack.length > 1) {
    var back = document.createElement('button');
    back.type = 'button';
    back.className = 'bookmark-menu-back';
    back.setAttribute('role', 'menuitem');
    back.textContent = '‹ Back';
    back.addEventListener('click', function() {
      bookmarkMenuStack.pop();
      renderBookmarkMenu();
      focusBookmarkMenu();
    });
    header.appendChild(back);
  }

  var title = document.createElement('span');
  title.className = 'bookmark-menu-title';
  title.textContent = bookmarkMenuStack.map(function(folder) {
    return folder.title || 'Untitled folder';
  }).join(' › ');
  header.appendChild(title);
  bookmarkMenuEl.appendChild(header);

  var items = document.createElement('div');
  items.className = 'bookmark-menu-items';
  var entries = bookmarkEntries(currentFolder.children);
  entries.forEach(function(node) {
    var label = node.title || (node.url ? bookmarkWebUrl(node.url) : 'Untitled folder');
    if (Array.isArray(node.children)) {
      var folderButton = document.createElement('button');
      folderButton.type = 'button';
      folderButton.className = 'bookmark-menu-item';
      folderButton.setAttribute('role', 'menuitem');
      var folderLabel = document.createElement('span');
      folderLabel.className = 'bookmark-menu-item-label';
      folderLabel.textContent = label;
      var chevron = document.createElement('span');
      chevron.setAttribute('aria-hidden', 'true');
      chevron.textContent = '›';
      folderButton.appendChild(folderLabel);
      folderButton.appendChild(chevron);
      folderButton.addEventListener('click', function() {
        bookmarkMenuStack.push(node);
        renderBookmarkMenu();
        focusBookmarkMenu();
      });
      items.appendChild(folderButton);
    } else {
      var link = document.createElement('a');
      link.className = 'bookmark-menu-item';
      link.setAttribute('role', 'menuitem');
      link.href = bookmarkWebUrl(node.url);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      var linkLabel = document.createElement('span');
      linkLabel.className = 'bookmark-menu-item-label';
      linkLabel.textContent = label;
      link.appendChild(linkLabel);
      link.addEventListener('click', function() { closeBookmarkMenu(false); });
      items.appendChild(link);
    }
  });
  if (!entries.length) {
    var empty = document.createElement('span');
    empty.className = 'bookmark-menu-empty';
    empty.textContent = bookmarkStatusMessage || 'No web bookmarks in this folder';
    items.appendChild(empty);
  }
  bookmarkMenuEl.appendChild(items);
}

function openBookmarkMenu(folder, anchor) {
  if (!bookmarkMenuEl || typeof bookmarkMenuEl.showPopover !== 'function') return;
  if (bookmarkMenuAnchor === anchor && bookmarkMenuEl.matches(':popover-open')) {
    closeBookmarkMenu(false);
    return;
  }
  if (bookmarkMenuAnchor && bookmarkMenuAnchor !== anchor) closeBookmarkMenu(false);
  bookmarkMenuAnchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  bookmarkMenuStack = [folder];
  renderBookmarkMenu();
  if (!bookmarkMenuEl.matches(':popover-open')) bookmarkMenuEl.showPopover();
  positionBookmarkMenu();
  focusBookmarkMenu();
}

function showBookmarkMessage(message) {
  bookmarkStatusMessage = message;
  var button = $('bookmark-root-btn');
  if (button) button.setAttribute('aria-busy', 'false');
  if (bookmarkMenuStack.length) renderBookmarkMenu();
}

function loadChromeBookmarks() {
  var button = $('bookmark-root-btn');
  if (!button) return;

  var api = typeof chrome !== 'undefined' && chrome.bookmarks;
  if (!api || typeof api.getTree !== 'function') {
    showBookmarkMessage('Chrome bookmarks are available in the installed extension');
    return;
  }

  try {
    api.getTree(function(tree) {
      if (disposed) return;
      if (chrome.runtime && chrome.runtime.lastError) {
        showBookmarkMessage('Could not load Chrome bookmarks');
        return;
      }
      bookmarkRootNodes = tree && tree[0] && Array.isArray(tree[0].children) ? tree[0].children : [];
      bookmarkRootFolder.children = bookmarkRootNodes;
      bookmarkStatusMessage = '';
      button.setAttribute('aria-busy', 'false');
      if (bookmarkMenuStack.length === 1 && bookmarkMenuStack[0] === bookmarkRootFolder) renderBookmarkMenu();
      else closeBookmarkMenu(false);
    });
  } catch (e) {
    showBookmarkMessage('Could not load Chrome bookmarks');
  }
}

function scheduleBookmarkRefresh() {
  clearTimeout(bookmarkRefreshTimer);
  bookmarkRefreshTimer = setTimeout(loadChromeBookmarks, 120);
}

function initChromeBookmarks() {
  var button = $('bookmark-root-btn');
  if (!button) return;

  bookmarkMenuEl = document.createElement('div');
  bookmarkMenuEl.className = 'bookmark-menu';
  bookmarkMenuEl.setAttribute('popover', 'manual');
  bookmarkMenuEl.setAttribute('role', 'menu');
  bookmarkMenuEl.setAttribute('aria-label', 'Chrome bookmark folders');
  document.body.appendChild(bookmarkMenuEl);

  listen(button, 'click', function() { openBookmarkMenu(bookmarkRootFolder, button); });
  listen(window, 'resize', function() {
    positionBookmarkMenu();
  });
  listen(window, 'scroll', function(e) {
    if (bookmarkMenuEl && bookmarkMenuEl.contains(e.target)) return;
    closeBookmarkMenu(false);
  }, true);
  listen(document, 'pointerdown', function(e) {
    if (!bookmarkMenuStack.length || !bookmarkMenuEl) return;
    if (bookmarkMenuEl.contains(e.target) || button.contains(e.target)) return;
    closeBookmarkMenu(false);
  });
  listen(document, 'keydown', function(e) {
    if (e.key === 'Escape' && bookmarkMenuStack.length) {
      e.preventDefault();
      closeBookmarkMenu(true);
    }
  });

  loadChromeBookmarks();
  var api = typeof chrome !== 'undefined' && chrome.bookmarks;
  if (!api) return;
  ['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onChildrenReordered', 'onImportEnded'].forEach(function(eventName) {
    var event = api[eventName];
    if (event && typeof event.addListener === 'function') {
      event.addListener(scheduleBookmarkRefresh);
      cleanupListeners.push(function() { event.removeListener(scheduleBookmarkRefresh); });
    }
  });
}

function mount() {
  if (mounted || disposed) return destroy;
  mounted = true;
  var tickerPanel = $('ticker-panel');
  tickerPanelOrigin = tickerPanel && tickerPanel.parentNode ? {
    element: tickerPanel, parent: tickerPanel.parentNode, nextSibling: tickerPanel.nextSibling
  } : null;
  initialGridElement = $('dashboard-grid');
  initialWidgetNodes = initialGridElement ? Array.from(initialGridElement.children) : [];
  updateClock();
  setInterval(updateClock, 1000);
  initWidgetControls();
  initNewsFeedControls();
  initChromeBookmarks();
  initTickerCombo();
  initDashboardGrid();
  document.body.style.background = '';
  listen(document, 'click', function(e) {
    if (!e.target.closest('#widget-menu-wrap')) setWidgetMenuOpen(false);
  });
  setTimeout(dismissLoader, 6000);
  initApp();
  return destroy;
}

function refreshTheme() {
  if (disposed) return;
  refreshAllChartColors();
  syncGridToTheme();
}

function destroy() {
  if (disposed) return;
  disposed = true;
  controller.abort();
  timeoutIds.forEach(function(id) { globalThis.clearTimeout(id); });
  intervalIds.forEach(function(id) { globalThis.clearInterval(id); });
  frameIds.forEach(function(id) { globalThis.cancelAnimationFrame(id); });
  timeoutIds.clear();
  intervalIds.clear();
  frameIds.clear();
  pendingWaits.forEach(function(resolve) { resolve(); });
  pendingWaits.clear();
  cleanupListeners.forEach(function(cleanup) { cleanup(); });
  cleanupListeners.length = 0;
  [hourlyChart, stockChart].concat(Object.values(rangeCharts)).forEach(function(chart) {
    if (chart) chart.destroy();
  });
  hourlyChart = stockChart = null;
  rangeCharts = {};
  if (dashGrid) { dashGrid.destroy(false); dashGrid = null; }
  // Restore original nodes before React's next effect mount. GridStack can detach
  // closed widgets and removes its own classes/styles during destroy(false).
  if (initialGridElement) {
    initialGridElement.classList.add('grid-stack');
    initialWidgetNodes.forEach(function(node) {
      node.classList.remove('widget-hidden');
      initialGridElement.appendChild(node);
    });
  }
  initialWidgetNodes = [];
  initialGridElement = null;
  if (tickerPanelOrigin) {
    var origin = tickerPanelOrigin;
    var next = origin.nextSibling && origin.nextSibling.parentNode === origin.parent ? origin.nextSibling : null;
    origin.parent.insertBefore(origin.element, next);
    tickerPanelOrigin = null;
  }
  activeJobs.clear();
  if (_tooltipEl) { _tooltipEl.remove(); _tooltipEl = null; }
  if (bookmarkMenuEl) { bookmarkMenuEl.remove(); bookmarkMenuEl = null; }
}

// ─── Init ────────────────────────────────────────────
function initApp() {
  fetchMegaData();
  fetchHourly();
  fetchStockWithFallback();
  fetchAllRanges();
  fetchNewsForTicker(currentTicker);
  startTimers(REFRESH_MS);
}

return {
    mount: mount,
    destroy: destroy,
    refreshTheme: refreshTheme,
    __setMegaDataForTest: function(data) { megaData = data; },
    __setFetchForTest: function(fn) { fetchImpl = fn; },
    __setWaitForTest: function(fn) { waitImpl = fn; },
    __resetFetchStateForTest: function() {
      fetchImpl = request;
      waitImpl = wait;
      fetchStateByProvider = {};
    },
    allowGridInsertionOverflow: allowGridInsertionOverflow,
    buildBalancedWidgetLayout: buildBalancedWidgetLayout,
    buildWidgetMenuHtml: buildWidgetMenuHtml,
    buildGridOptions: buildGridOptions,
    buildIntradayDatasets: buildIntradayDatasets,
    buildStatsHtml: buildStatsHtml,
    buildHeaderPriceHtml: buildHeaderPriceHtml,
    buildThemeState: buildThemeState,
    calculateCellHeight: calculateCellHeight,
    safeHttpsUrl: safeHttpsUrl,
    normalizeNewsItems: normalizeNewsItems,
    normalizeNewsTimestamp: normalizeNewsTimestamp,
    normalizeGoogleNewsRss: normalizeGoogleNewsRss,
    normalizeGoogleNewsHtmlThumbnails: normalizeGoogleNewsHtmlThumbnails,
    applyArchiveThumbnails: applyArchiveThumbnails,
    mergeNewsItems: mergeNewsItems,
    preserveNewsPrefix: preserveNewsPrefix,
    olderNewsItemsForAppend: olderNewsItemsForAppend,
    newsDateGroupLabel: newsDateGroupLabel,
    newsDateKey: newsDateKey,
    shouldLoadMoreNews: shouldLoadMoreNews,
    shouldRefreshNews: shouldRefreshNews,
    colorToRgba: colorToRgba,
    computeStats: computeStats,
    exchangeMinutes: exchangeMinutes,
    getClosedWidgetOptions: getClosedWidgetOptions,
    getDefaultTickers: getDefaultTickers,
    getInitialTicker: getInitialTicker,
    getOpenWidgetLayout: getOpenWidgetLayout,
    getSessionQuote: getSessionQuote,
    getStoredAppearancePreference: getStoredAppearancePreference,
    getStoredThemeFamily: getStoredThemeFamily,
    getStoredThemePreference: getStoredThemePreference,
    fetchJsonWithBackoff: fetchJsonWithBackoff,
    fetchTextWithBackoff: fetchTextWithBackoff,
    hasPriceData: hasPriceData,
    isThemeMenuSelectionTarget: isThemeMenuSelectionTarget,
    chooseDropdownMenuDirection: chooseDropdownMenuDirection,
    isRegularMarketTimestamp: isRegularMarketTimestamp,
    loadSavedTickers: loadSavedTickers,
    loadClosedWidgetIds: loadClosedWidgetIds,
    rebalanceOpenGridWidgets: rebalanceOpenGridWidgets,
    removeTickerFromList: removeTickerFromList,
    resetDashboardLayout: resetDashboardLayout,
    resolveAppearanceMode: resolveAppearanceMode,
    resolveThemeId: resolveThemeId,
    saveClosedWidgetIds: saveClosedWidgetIds,
    splitIntradaySeries: splitIntradaySeries,
    themeClassNameFor: themeClassNameFor
};
}

let activeRuntime;

export function mountDashboard() {
  if (activeRuntime) activeRuntime.destroy();
  const runtime = createDashboardRuntime();
  activeRuntime = runtime;
  try {
    runtime.mount();
  } catch (error) {
    runtime.destroy();
    activeRuntime = undefined;
    throw error;
  }
  return () => {
    runtime.destroy();
    if (activeRuntime === runtime) activeRuntime = undefined;
  };
}

export function refreshDashboardTheme() {
  activeRuntime?.refreshTheme();
}

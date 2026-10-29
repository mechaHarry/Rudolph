const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function loadApp(overrides = {}) {
  const elements = new Map();
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
    getElementById: (id) => {
      if (!elements.has(id)) {
        elements.set(id, {
          id,
          style: {},
          innerHTML: '',
          textContent: '',
          className: '',
          classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} },
          addEventListener: () => {},
          getContext: () => ({})
        });
      }
      return elements.get(id);
    }
  };
  const context = {
    Chart: function Chart(ctx, config) {
      this.ctx = ctx;
      this.data = config.data;
      this.options = config.options;
      this.update = () => {};
      this.resize = () => {};
      this.destroy = () => {};
    },
    GridStack: { init: () => null },
    clearInterval: () => {},
    clearTimeout: () => {},
    console,
    document,
    fetch: async () => ({ ok: false }),
    getComputedStyle: () => ({
      getPropertyValue: (name) => ({
        '--accent': '#5b9bf4',
        '--after-hours': '#f5b642',
        '--green': '#3ddc84',
        '--red': '#f4605a',
        '--text': '#edf0f7',
        '--surface': '#171c28',
        '--surface-hi': '#1e2538',
        '--border': 'rgba(255,255,255,.06)',
        '--grid-line': 'rgba(255,255,255,.03)',
        '--radius-sm': '14px',
        '--font': 'Arial',
        '--font-mono': 'monospace'
      }[name] || '')
    }),
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    location: { reload: () => {} },
    module: { exports: {} },
    requestAnimationFrame: (cb) => cb(),
    setInterval: () => 0,
    setTimeout: (cb) => { if (typeof cb === 'function') cb(); return 0; },
    window: { innerWidth: 1200, innerHeight: 800 }
  };
  Object.assign(context, overrides);
  context.AbortController = AbortController;
  context.exports = context.module.exports;
  context.require = (id) => {
    if (id === 'chart.js/auto') return { default: context.Chart };
    if (id === 'gridstack') return { GridStack: context.GridStack };
    throw new Error('Unexpected runtime dependency: ' + id);
  };
  context.global = context;
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'legacy', 'dashboard.js'), 'utf8');
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context, { filename: 'src/legacy/dashboard.js' });
  return context.module.exports.createDashboardRuntime();
}

function loadGridStackEngine() {
  global.self = global;
  return require('gridstack/dist/gridstack-all.js').Engine;
}

function buildExpandedHourGrid(Engine, maxRow) {
  const engine = new Engine({ column: 12, maxRow, float: true, nodes: [] });
  engine.addNode({ id: 'hourly', x: 0, y: 0, w: 12, h: 6 });
  engine.addNode({ id: 'year', x: 0, y: 6, w: 6, h: 3 });
  engine.addNode({ id: 'alltime', x: 6, y: 6, w: 6, h: 3 });
  return engine;
}

function gridNodeRects(engine) {
  return engine.nodes.map((node) => ({
    id: node.id,
    x: node.x,
    y: node.y,
    w: node.w,
    h: node.h
  })).sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
}

function gridOverlaps(nodes) {
  const pairs = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const overlaps = !(
        a.y >= b.y + b.h ||
        a.y + a.h <= b.y ||
        a.x + a.w <= b.x ||
        a.x >= b.x + b.w
      );
      if (overlaps) pairs.push([a.id, b.id]);
    }
  }
  return pairs;
}

function cssRuleBlock(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(escaped + '\\s*\\{([\\s\\S]*?)\\n\\}'));
  assert.ok(match, `Missing CSS rule for ${selector}`);
  return match[1];
}

test('splitIntradaySeries separates premarket and postmarket prices from regular prices', () => {
  const app = loadApp();
  const timestamps = [
    Date.UTC(2026, 4, 13, 8, 0) / 1000,
    Date.UTC(2026, 4, 13, 9, 30) / 1000,
    Date.UTC(2026, 4, 13, 15, 59) / 1000,
    Date.UTC(2026, 4, 13, 16, 1) / 1000
  ];
  const closes = [101.111, 102.222, 103.333, 104.444];

  const series = app.splitIntradaySeries(timestamps, closes, 0);

  assert.deepEqual(Array.from(series.regular), [null, 102.22, 103.33, null]);
  assert.deepEqual(Array.from(series.extended), [101.11, null, null, 104.44]);
  assert.deepEqual(Array.from(series.combined), [101.11, 102.22, 103.33, 104.44]);
  assert.equal(series.hasExtended, true);
});

test('splitIntradaySeries treats non-positive prices as missing data', () => {
  const app = loadApp();
  const timestamps = [
    Date.UTC(2026, 4, 19, 13, 30) / 1000,
    Date.UTC(2026, 4, 19, 13, 31) / 1000,
    Date.UTC(2026, 4, 19, 13, 32) / 1000,
    Date.UTC(2026, 4, 19, 13, 33) / 1000
  ];
  const closes = [116.55, 0, -1, 116.57];

  const series = app.splitIntradaySeries(timestamps, closes, 0);

  assert.deepEqual(JSON.parse(JSON.stringify(series.combined)), [116.55, null, null, 116.57]);
  assert.deepEqual(JSON.parse(JSON.stringify(series.regular)), [116.55, null, null, 116.57]);
});

test('rate limited fetches honor Retry-After and skip provider during cooldown', async () => {
  const app = loadApp();
  let calls = 0;
  const waits = [];
  app.__setWaitForTest(async (ms) => { waits.push(ms); });
  app.__setFetchForTest(async () => {
    calls += 1;
    return {
      ok: false,
      status: 429,
      headers: { get: (name) => name.toLowerCase() === 'retry-after' ? '2' : null }
    };
  });

  const first = await app.fetchJsonWithBackoff('https://query1.finance.yahoo.com/v8/finance/chart/CSCO', 3);
  const second = await app.fetchJsonWithBackoff('https://query1.finance.yahoo.com/v8/finance/chart/CSCO', 3);

  assert.equal(first, null);
  assert.equal(second, null);
  assert.equal(calls, 1);
  assert.deepEqual(waits, []);
  app.__resetFetchStateForTest();
});

test('rate limited fetch returns cached response while provider is cooling down', async () => {
  const app = loadApp();
  let calls = 0;
  app.__setWaitForTest(async () => {});
  app.__setFetchForTest(async () => {
    calls += 1;
    if (calls === 1) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ ok: true, price: 116.57 })
      };
    }
    return {
      ok: false,
      status: 429,
      headers: { get: () => null }
    };
  });

  const first = await app.fetchJsonWithBackoff('https://query1.finance.yahoo.com/v8/finance/chart/CSCO', 2);
  const second = await app.fetchJsonWithBackoff('https://query1.finance.yahoo.com/v8/finance/chart/CSCO', 2);
  const third = await app.fetchJsonWithBackoff('https://query1.finance.yahoo.com/v8/finance/chart/CSCO', 2);

  assert.deepEqual(first, { ok: true, price: 116.57 });
  assert.deepEqual(second, { ok: true, price: 116.57 });
  assert.deepEqual(third, { ok: true, price: 116.57 });
  assert.equal(calls, 2);
  app.__resetFetchStateForTest();
});

test('buildIntradayDatasets adds orange/yellow extended-hours line and shade when data exists', () => {
  const app = loadApp();

  const datasets = app.buildIntradayDatasets({
    labels: ['08:00 AM', '09:30 AM', '04:01 PM'],
    regularData: [null, 102, null],
    extendedData: [101, null, 103],
    prevClose: 100,
    priorData: null
  });

  const extended = datasets.find((dataset) => dataset.label === 'Extended Hours');
  assert.ok(extended, 'expected an Extended Hours dataset');
  assert.equal(extended.borderColor, '#f5b642');
  assert.match(extended.backgroundColor, /^rgba\(245,182,66,0\.16\)$/);
  assert.equal(extended.fill, true);
});

test('buildIntradayDatasets omits extended-hours dataset when there are no extended prices', () => {
  const app = loadApp();

  const datasets = app.buildIntradayDatasets({
    labels: ['09:30 AM', '09:31 AM'],
    regularData: [102, 103],
    extendedData: [null, null],
    prevClose: 100,
    priorData: null
  });

  assert.equal(datasets.some((dataset) => dataset.label === 'Extended Hours'), false);
});

test('getSessionQuote reads post-market price during after-hours session', () => {
  const app = loadApp();

  const quote = app.getSessionQuote({
    marketState: 'POST',
    regularMarketPrice: 102.12,
    postMarketPrice: 103.45
  }, [101, 102, 103]);

  assert.equal(quote.price, 103.45);
  assert.equal(quote.session, 'after hours');
  assert.equal(quote.regularPrice, 102.12);
  assert.equal(quote.extendedPrice, 103.45);
  assert.equal(quote.extendedLabel, 'AH');
});

test('buildHeaderPriceHtml displays after-hours price alongside regular price', () => {
  const app = loadApp();

  const html = app.buildHeaderPriceHtml({
    regularPrice: 102.12,
    extendedPrice: 103.45,
    extendedLabel: 'AH'
  });

  assert.equal(
    html,
    '$102.12<span class="extended-price">AH $103.45</span>'
  );
});

test('getSessionQuote falls back to latest extended datapoint when post-market meta is absent', () => {
  const app = loadApp();

  const quote = app.getSessionQuote({
    marketState: 'POST',
    regularMarketPrice: 102.12
  }, [102.12, 102.5, 103.45], [null, null, 103.45]);

  assert.equal(quote.price, 103.45);
  assert.equal(quote.regularPrice, 102.12);
  assert.equal(quote.extendedPrice, 103.45);
  assert.equal(quote.extendedLabel, 'AH');
  assert.equal(app.buildHeaderPriceHtml(quote), '$102.12<span class="extended-price">AH $103.45</span>');
});

test('getSessionQuote does not show stale extended datapoint when regular market has newer matching price', () => {
  const app = loadApp();

  const quote = app.getSessionQuote({
    marketState: 'REGULAR',
    regularMarketPrice: 103.45
  }, [103.45, 103.45], [103.45, null]);

  assert.equal(quote.price, 103.45);
  assert.equal(quote.regularPrice, 103.45);
  assert.equal(quote.extendedPrice, null);
  assert.equal(app.buildHeaderPriceHtml(quote), '$103.45');
});

test('buildStatsHtml renders only min and max graph legend items', () => {
  const app = loadApp();

  const html = app.buildStatsHtml({
    diff: 4,
    pct: 2,
    growPct: 80,
    shrinkPct: 20,
    up: true,
    min: 99.12,
    max: 106.34
  });

  assert.equal(
    html,
    '<span class="stat-pill"><span class="stat-label">Min</span> $99.12</span>' +
      '<span class="stat-pill"><span class="stat-label">Max</span> $106.34</span>'
  );
  assert.equal(html.includes('\u0394'), false);
  assert.equal(html.includes('\u25B2'), false);
  assert.equal(html.includes('\u25BC'), false);
  assert.equal(html.includes('Prior'), false);
});

test('computeStats includes extended-hours prices in min and max when mega data exists', () => {
  const app = loadApp();

  app.__setMegaDataForTest({
    timestamps: [Date.now() / 1000 - 60],
    highs: [105],
    lows: [100],
    closes: [102]
  });

  const stats = app.computeStats([99.5, 102, 107.25], 1);

  assert.equal(stats.min, 99.5);
  assert.equal(stats.max, 107.25);
});

test('closed widget helpers persist hidden widget ids and report reinsertion options', () => {
  const app = loadApp();
  const storage = {};

  app.saveClosedWidgetIds(['stock', 'month'], storage);

  assert.deepEqual(Array.from(app.loadClosedWidgetIds(storage)), ['stock', 'month']);
  assert.deepEqual(
    JSON.parse(JSON.stringify(app.getClosedWidgetOptions(['stock', 'unknown'], [
      { id: 'hourly', title: 'Hour' },
      { id: 'stock', title: 'Today' }
    ]))),
    [{ id: 'stock', title: 'Today' }]
  );
});

test('buildGridOptions enables floating no-gravity layout behavior', () => {
  const app = loadApp();

  const options = app.buildGridOptions({ cellHeight: 72, margin: 4, rows: 9 });

  assert.equal(options.float, true);
  assert.equal(options.cellHeight, 72);
  assert.equal(options.maxRow, 9);
  assert.equal(options.handle, '.card-header');
});

test('calculateCellHeight sizes rows from available grid height', () => {
  const app = loadApp();

  assert.equal(app.calculateCellHeight(720, 9), 80);
  assert.equal(app.calculateCellHeight(180, 9), 30);
});

test('getOpenWidgetLayout excludes closed widgets before grid startup', () => {
  const app = loadApp();
  const layout = [
    { id: 'hourly', x: 0, y: 0, w: 12, h: 3 },
    { id: 'stock', x: 6, y: 3, w: 6, h: 3 },
    { id: 'month', x: 6, y: 3, w: 6, h: 3 },
    { id: 'year', x: 0, y: 3, w: 6, h: 3 },
    { id: 'alltime', x: 0, y: 6, w: 12, h: 3 }
  ];

  const openLayout = app.getOpenWidgetLayout(layout, ['hourly', 'month']);

  assert.deepEqual(
    JSON.parse(JSON.stringify(openLayout)),
    [
      { id: 'stock', x: 6, y: 3, w: 6, h: 3 },
      { id: 'year', x: 0, y: 3, w: 6, h: 3 },
      { id: 'alltime', x: 0, y: 6, w: 12, h: 3 }
    ]
  );
});

test('reinserted widgets temporarily remove the grid row cap before collision resolution', () => {
  const app = loadApp();
  const grid = {
    opts: { maxRow: 9 },
    engine: { maxRow: 9 }
  };

  app.allowGridInsertionOverflow(grid);

  assert.equal(grid.opts.maxRow, 0);
  assert.equal(grid.engine.maxRow, 0);
});

test('reinserted widgets shift an expanded widget instead of overlapping it', () => {
  const app = loadApp();
  const Engine = loadGridStackEngine();
  const cappedEngine = buildExpandedHourGrid(Engine, 9);
  cappedEngine.addNode({ id: 'month', x: 6, y: 3, w: 6, h: 3 });
  assert.notDeepEqual(gridOverlaps(gridNodeRects(cappedEngine)), []);

  const grid = {
    opts: { maxRow: 9 },
    engine: buildExpandedHourGrid(Engine, 9)
  };
  app.allowGridInsertionOverflow(grid);
  grid.engine.addNode({ id: 'month', x: 6, y: 3, w: 6, h: 3 });

  const nodes = gridNodeRects(grid.engine);
  assert.deepEqual(gridOverlaps(nodes), []);
  assert.deepEqual(nodes, [
    { id: 'month', x: 6, y: 3, w: 6, h: 3 },
    { id: 'hourly', x: 0, y: 6, w: 12, h: 6 },
    { id: 'year', x: 0, y: 12, w: 6, h: 3 },
    { id: 'alltime', x: 6, y: 12, w: 6, h: 3 }
  ]);
});

test('balanced widget layout fills the viewport rows for four open widgets', () => {
  const app = loadApp();

  const layout = JSON.parse(JSON.stringify(
    app.buildBalancedWidgetLayout(['hourly', 'month', 'year', 'alltime'], 9)
  ));

  assert.deepEqual(layout, [
    { id: 'hourly', x: 0, y: 0, w: 6, h: 5 },
    { id: 'month', x: 6, y: 0, w: 6, h: 5 },
    { id: 'year', x: 0, y: 5, w: 6, h: 4 },
    { id: 'alltime', x: 6, y: 5, w: 6, h: 4 }
  ]);
});

test('balanced widget layout maxes five open widgets without empty row bands', () => {
  const app = loadApp();

  const layout = JSON.parse(JSON.stringify(
    app.buildBalancedWidgetLayout(['hourly', 'stock', 'month', 'year', 'alltime'], 9)
  ));

  assert.deepEqual(layout, [
    { id: 'hourly', x: 0, y: 0, w: 4, h: 5 },
    { id: 'stock', x: 4, y: 0, w: 4, h: 5 },
    { id: 'month', x: 8, y: 0, w: 4, h: 5 },
    { id: 'year', x: 0, y: 5, w: 6, h: 4 },
    { id: 'alltime', x: 6, y: 5, w: 6, h: 4 }
  ]);
});

test('rebalanced open widgets load a dense layout in canonical widget order', () => {
  const app = loadApp();
  const calls = [];
  const grid = {
    engine: {
      nodes: [
        { id: 'alltime' },
        { id: 'month' },
        { id: 'hourly' },
        { id: 'year' }
      ]
    },
    load: function(layout, addRemove) {
      calls.push({ layout, addRemove });
    }
  };

  app.rebalanceOpenGridWidgets(grid);

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{
    addRemove: false,
    layout: [
      { id: 'hourly', x: 0, y: 0, w: 6, h: 5 },
      { id: 'month', x: 6, y: 0, w: 6, h: 5 },
      { id: 'year', x: 0, y: 5, w: 6, h: 4 },
      { id: 'alltime', x: 6, y: 5, w: 6, h: 4 }
    ]
  }]);
});

test('resolveAppearanceMode follows the system light setting when preference is auto', () => {
  const app = loadApp();

  const resolved = app.resolveAppearanceMode('auto', {
    matchMedia: (query) => ({ matches: query === '(prefers-color-scheme: light)' })
  });

  assert.equal(resolved, 'light');
});

test('resolveAppearanceMode follows the system dark setting when preference is auto', () => {
  const app = loadApp();

  const resolved = app.resolveAppearanceMode('auto', {
    matchMedia: (query) => ({ matches: query === '(prefers-color-scheme: dark)' })
  });

  assert.equal(resolved, 'dark');
});

test('resolveThemeId keeps legacy system preference as automatic appearance', () => {
  const app = loadApp();

  assert.equal(app.resolveThemeId('system'), 'dark');
});

test('themeClassNameFor maps theme family and appearance to body classes', () => {
  const app = loadApp();

  assert.equal(app.themeClassNameFor('oneui', 'light'), 'theme-oneui mode-light');
  assert.equal(app.themeClassNameFor('oneui', 'dark'), 'theme-oneui mode-dark');
  assert.equal(app.themeClassNameFor('glass', 'light'), 'theme-glass mode-light');
  assert.equal(app.themeClassNameFor('webex', 'dark'), 'theme-webex mode-dark');
});

test('default ticker list uses five broad-market symbols without company-specific defaults', () => {
  const app = loadApp();

  assert.deepEqual(JSON.parse(JSON.stringify(app.getDefaultTickers())), [
    { sym: 'NVDA', name: 'NVIDIA Corporation' },
    { sym: 'AAPL', name: 'Apple Inc.' },
    { sym: 'MSFT', name: 'Microsoft Corporation' },
    { sym: 'AMZN', name: 'Amazon.com, Inc.' },
    { sym: 'GOOGL', name: 'Alphabet Inc.' }
  ]);
  assert.equal(app.getInitialTicker({}, app.getDefaultTickers()), 'NVDA');
});

test('loadSavedTickers falls back to the default list when storage is empty or invalid', () => {
  const app = loadApp();
  const emptyStorage = { getItem: () => null };
  const invalidStorage = { getItem: () => 'not json' };

  assert.deepEqual(
    JSON.parse(JSON.stringify(app.loadSavedTickers(emptyStorage))),
    JSON.parse(JSON.stringify(app.getDefaultTickers()))
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(app.loadSavedTickers(invalidStorage))),
    JSON.parse(JSON.stringify(app.getDefaultTickers()))
  );
});

test('removeTickerFromList can trim the active symbol and selects the next available symbol', () => {
  const app = loadApp();
  const result = app.removeTickerFromList([
    { sym: 'NVDA', name: 'NVIDIA Corporation' },
    { sym: 'AAPL', name: 'Apple Inc.' },
    { sym: 'MSFT', name: 'Microsoft Corporation' }
  ], 'NVDA', 'NVDA');

  assert.deepEqual(JSON.parse(JSON.stringify(result.tickers)), [
    { sym: 'AAPL', name: 'Apple Inc.' },
    { sym: 'MSFT', name: 'Microsoft Corporation' }
  ]);
  assert.equal(result.currentTicker, 'AAPL');
});

test('buildThemeState keeps theme family independent from automatic light mode', () => {
  const app = loadApp();

  const state = app.buildThemeState('material', 'auto', {
    matchMedia: (query) => ({ matches: query === '(prefers-color-scheme: light)' })
  });

  assert.deepEqual(JSON.parse(JSON.stringify(state)), {
    themeFamily: 'material',
    appearancePreference: 'auto',
    resolvedAppearance: 'light',
    className: 'theme-material mode-light'
  });
});

test('buildThemeState keeps theme family independent from explicit dark mode', () => {
  const app = loadApp();

  const state = app.buildThemeState('glass', 'dark', {
    matchMedia: (query) => ({ matches: query === '(prefers-color-scheme: light)' })
  });

  assert.deepEqual(JSON.parse(JSON.stringify(state)), {
    themeFamily: 'glass',
    appearancePreference: 'dark',
    resolvedAppearance: 'dark',
    className: 'theme-glass mode-dark'
  });
});

test('getStoredAppearancePreference reads explicit appearance separately from theme family', () => {
  const app = loadApp();
  const storage = {
    getItem: (key) => ({
      'rudolph-theme': 'carbon',
      'rudolph-appearance': 'light'
    }[key] || null)
  };

  assert.equal(app.getStoredThemeFamily(storage), 'carbon');
  assert.equal(app.getStoredAppearancePreference(storage), 'light');
});

test('getStoredAppearancePreference migrates previous light theme selection to explicit light', () => {
  const app = loadApp();
  const storage = {
    getItem: (key) => key === 'rudolph-theme' ? 'light' : null
  };

  assert.equal(app.getStoredThemeFamily(storage), 'oneui');
  assert.equal(app.getStoredAppearancePreference(storage), 'light');
});

test('theme menu selections keep the dropdown open after choosing a theme or appearance', () => {
  const app = loadApp();
  const themeTarget = {
    closest: (selector) => selector === '[data-theme]' ? { dataset: { theme: 'webex' } } : null
  };
  const appearanceTarget = {
    closest: (selector) => selector === '[data-appearance]' ? { dataset: { appearance: 'dark' } } : null
  };
  const emptyTarget = { closest: () => null };

  assert.equal(app.isThemeMenuSelectionTarget(themeTarget), true);
  assert.equal(app.isThemeMenuSelectionTarget(appearanceTarget), true);
  assert.equal(app.isThemeMenuSelectionTarget(emptyTarget), false);
});

test('dropdown menus open to the right when the right side fits in the viewport', () => {
  const app = loadApp();

  assert.equal(app.chooseDropdownMenuDirection({
    buttonLeft: 24,
    buttonRight: 64,
    menuWidth: 210,
    viewportWidth: 360
  }), 'right');
});

test('dropdown menus open to the left when opening right would be cut off', () => {
  const app = loadApp();

  assert.equal(app.chooseDropdownMenuDirection({
    buttonLeft: 250,
    buttonRight: 290,
    menuWidth: 210,
    viewportWidth: 320
  }), 'left');
});

test('dropdown menus choose the side with less clipping when neither side fully fits', () => {
  const app = loadApp();

  assert.equal(app.chooseDropdownMenuDirection({
    buttonLeft: 128,
    buttonRight: 168,
    menuWidth: 260,
    viewportWidth: 300
  }), 'right');
});

test('theme menu labels the webex family as Cisco Momentum', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const newtabHtml = fs.readFileSync(path.join(__dirname, '..', 'newtab.html'), 'utf8');

  assert.match(indexHtml, /data-theme="webex"[^>]*>Cisco Momentum<\/button>/);
  assert.match(newtabHtml, /data-theme="webex"[^>]*>Cisco Momentum<\/button>/);
  assert.doesNotMatch(indexHtml, /Cisco Webex/);
  assert.doesNotMatch(newtabHtml, /Cisco Webex/);
});

test('webex theme CSS uses Momentum stable token values', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');

  assert.match(css, /Cisco Momentum/);
  assert.match(css, /body\.theme-webex\s*\{[\s\S]*--bg:\s*#000000;/);
  assert.match(css, /body\.theme-webex\s*\{[\s\S]*--surface:\s*#1a1a1a;/);
  assert.match(css, /body\.theme-webex\s*\{[\s\S]*--text:\s*#fffffff2;/);
  assert.match(css, /body\.theme-webex\s*\{[\s\S]*--accent:\s*#3492eb;/);
  assert.match(css, /body\.theme-webex\s*\{[\s\S]*--green:\s*#3cc29a;/);
  assert.match(css, /body\.theme-webex\s*\{[\s\S]*--red:\s*#fc8b98;/);
  assert.match(css, /body\.theme-webex\s*\{[\s\S]*--font:\s*Momentum, Inter, Arial, 'Helvetica Neue', Helvetica, sans-serif;/);
  assert.match(css, /body\.theme-webex\s*\{[\s\S]*--card-blur:\s*blur\(10px\);/);
  assert.match(css, /body\.theme-webex\.mode-light\s*\{[\s\S]*--bg:\s*#ffffff;/);
  assert.match(css, /body\.theme-webex\.mode-light\s*\{[\s\S]*--surface:\s*#f7f7f7;/);
  assert.match(css, /body\.theme-webex\.mode-light\s*\{[\s\S]*--text:\s*#000000f2;/);
  assert.match(css, /body\.theme-webex\.mode-light\s*\{[\s\S]*--accent:\s*#1170cf;/);
});

test('carbon theme CSS uses IBM Carbon theme tokens and flat layers', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');

  assert.match(css, /getdesign\.md\/ibm\/design-md/);
  assert.match(css, /body\.theme-carbon\s*\{[\s\S]*--bg:\s*#161616;/);
  assert.match(css, /body\.theme-carbon\s*\{[\s\S]*--surface:\s*#262626;/);
  assert.match(css, /body\.theme-carbon\s*\{[\s\S]*--surface-hi:\s*#393939;/);
  assert.match(css, /body\.theme-carbon\s*\{[\s\S]*--text:\s*#f4f4f4;/);
  assert.match(css, /body\.theme-carbon\s*\{[\s\S]*--accent:\s*#4589ff;/);
  assert.match(css, /body\.theme-carbon\s*\{[\s\S]*--card-blur:\s*none;/);
  assert.match(css, /body\.theme-carbon\s*\{[\s\S]*--hdr-blur:\s*none;/);
  assert.match(css, /body\.theme-carbon\s*\{[\s\S]*--menu-shadow:\s*none;/);
  assert.match(css, /body\.theme-carbon\s*\{[\s\S]*--font:\s*'IBM Plex Sans', system-ui, -apple-system, BlinkMacSystemFont, '\.SFNSText-Regular', sans-serif;/);
  assert.match(css, /body\.theme-carbon\.mode-light\s*\{[\s\S]*--bg:\s*#ffffff;/);
  assert.match(css, /body\.theme-carbon\.mode-light\s*\{[\s\S]*--surface:\s*#f4f4f4;/);
  assert.match(css, /body\.theme-carbon\.mode-light\s*\{[\s\S]*--surface-hi:\s*#ffffff;/);
  assert.match(css, /body\.theme-carbon\.mode-light\s*\{[\s\S]*--text:\s*#161616;/);
  assert.match(css, /body\.theme-carbon\.mode-light\s*\{[\s\S]*--accent:\s*#0f62fe;/);
});

test('glass theme CSS uses Apple Liquid Glass references and system colors', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');
  const dark = cssRuleBlock(css, 'body.theme-glass');
  const light = cssRuleBlock(css, 'body.theme-glass.mode-light');

  assert.match(css, /getdesign\.md\/apple\/design-md/);
  assert.match(dark, /--bg:\s*#000000;/);
  assert.match(dark, /--text:\s*#f5f5f7;/);
  assert.match(dark, /--accent:\s*#0a84ff;/);
  assert.match(dark, /--green:\s*#30d158;/);
  assert.match(dark, /--red:\s*#ff453a;/);
  assert.match(dark, /--hdr-blur:\s*blur\(24px\);/);
  assert.match(dark, /--pill-blur:\s*blur\(18px\);/);
  assert.match(dark, /--title-tracking:\s*0px;/);
  assert.match(light, /--bg:\s*#f5f5f7;/);
  assert.match(light, /--text:\s*#1d1d1f;/);
  assert.match(light, /--accent:\s*#007aff;/);
  assert.match(light, /--green:\s*#34c759;/);
  assert.match(light, /--red:\s*#ff3b30;/);
  assert.match(light, /--after-hours:\s*#ffcc00;/);
});

test('glass theme gives dropdowns a dense blurred Liquid Glass surface', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');
  const dark = cssRuleBlock(css, 'body.theme-glass');

  assert.match(dark, /--menu-bg:\s*linear-gradient\(175deg, rgba\(44,38,74,\.92\) 0%, rgba\(31,28,58,\.86\) 100%\);/);
  assert.match(dark, /--menu-blur:\s*blur\(36px\) saturate\(180%\);/);
  assert.match(dark, /--menu-shadow:\s*0 24px 64px rgba\(0,0,0,\.58\), inset 0 \.5px 0 rgba\(255,255,255,\.18\);/);
  assert.match(css, /\.theme-menu,[\s\S]*\.widget-menu\s*\{[\s\S]*background:\s*var\(--menu-bg, var\(--surface-hi\)\);/);
  assert.match(css, /\.theme-menu,[\s\S]*\.widget-menu\s*\{[\s\S]*backdrop-filter:\s*var\(--menu-blur, blur\(24px\)\);/);
  assert.match(css, /\.ticker-panel\s*\{[\s\S]*background:\s*var\(--menu-bg, var\(--surface-hi\)\);/);
  assert.match(css, /\.ticker-panel\s*\{[\s\S]*backdrop-filter:\s*var\(--menu-blur, blur\(24px\)\);/);
});

test('glass theme avoids live backdrop blur on large chart cards', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');
  const dark = cssRuleBlock(css, 'body.theme-glass');

  assert.match(dark, /--card-blur:\s*none;/);
  assert.match(dark, /--hdr-blur:\s*blur\(24px\);/);
  assert.match(dark, /--menu-blur:\s*blur\(36px\) saturate\(180%\);/);
});

// Regression: React teardown and stalled bodies must release provider work.
test('dashboard teardown aborts pending work and stalled response bodies have a deadline', async () => {
  const timeouts = new Map();
  let timerId = 0;
  const fakeTimers = {
    setTimeout: (callback) => { const id = ++timerId; timeouts.set(id, callback); return id; },
    clearTimeout: (id) => timeouts.delete(id),
  };
  let requestCount = 0;
  let requestSignal;
  let finishRequest;
  const app = loadApp({
    ...fakeTimers,
    fetch: (_url, options) => {
      requestCount += 1;
      requestSignal = options.signal;
      return new Promise((resolve) => { finishRequest = resolve; });
    }
  });
  assert.equal(requestCount, 0, 'importing the runtime does not start data work');
  assert.equal(timeouts.size, 0, 'importing the runtime does not start timers');
  const pending = app.fetchJsonWithBackoff('https://query1.finance.yahoo.com/chart', 2);
  assert.equal(requestSignal.aborted, false);
  app.destroy();
  app.destroy();
  assert.equal(requestSignal.aborted, true);
  finishRequest({ ok: true, json: async () => ({ unsafeLateValue: true }) });
  assert.equal(await pending, null);
  assert.equal(await app.fetchJsonWithBackoff('https://query1.finance.yahoo.com/chart', 2), null);
  assert.equal(requestCount, 1, 'teardown does not start retries or new requests');
  assert.equal(timeouts.size, 0);

  let bodyStarted = false;
  const stalled = loadApp({
    ...fakeTimers,
    fetch: (_url, options) => ({
      ok: true,
      json: () => new Promise((_resolve, reject) => {
        bodyStarted = true;
        options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
    }),
  });
  const stalledBody = stalled.fetchJsonWithBackoff('https://query1.finance.yahoo.com/chart', 1);
  await Promise.resolve();
  assert.equal(bodyStarted, true);
  assert.equal(timeouts.size, 1, 'deadline remains active while the body is being read');
  timeouts.values().next().value();
  assert.equal(await stalledBody, null);
  assert.equal(timeouts.size, 0, 'completed work releases its deadline timer');
  stalled.destroy();
});

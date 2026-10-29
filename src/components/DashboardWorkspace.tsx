import { memo } from 'react';

const widgets = [
  { id: 'hourly', title: 'Hour — Per Minute', name: 'Hour', stats: 'hourly-stats', canvas: 'hourlyChart', loader: 'hourly-loader', x: 0, y: 0, w: 12 },
  { id: 'stock', title: 'Today — Per Minute', name: 'Today', stats: 'today-stats', canvas: 'stockChart', loader: 'stock-loader', x: 0, y: 3, w: 6 },
  { id: 'month', title: '1 Month — Per Day', name: '1 Month', stats: 'month-stats', canvas: 'monthChart', loader: 'month-loader', x: 6, y: 3, w: 6 },
  { id: 'year', title: '1 Year — Per Day', name: '1 Year', stats: 'year-stats', canvas: 'yearChart', loader: 'year-loader', x: 0, y: 6, w: 6 },
  { id: 'alltime', title: 'All-Time — Per Month', name: 'All-Time', stats: 'alltime-stats', canvas: 'alltimeChart', loader: 'alltime-loader', x: 6, y: 6, w: 6 },
];

function ChartWidget({ widget }: { widget: (typeof widgets)[number] }) {
  return <div className="grid-stack-item" gs-id={widget.id} gs-x={widget.x} gs-y={widget.y} gs-w={widget.w} gs-h="3" gs-min-w="4" gs-min-h="2">
    <div className="grid-stack-item-content card" id={`${widget.id}-card`}>
      <div className="card-header">
        <h2>{widget.title}</h2>
        <div className="card-stats" id={widget.stats}><span className="skel skel-pill" /><span className="skel skel-pill" /></div>
        <button className="widget-close-btn" type="button" data-widget-id={widget.id} title="Close widget" aria-label={`Close ${widget.name} widget`}>&times;</button>
      </div>
      <div className="chart-wrap"><div className="skel skel-chart" id={widget.loader} /><canvas id={widget.canvas} aria-label={`${widget.name} price history`} role="img" /></div>
    </div>
  </div>;
}

// Gridstack owns widget positions; the runtime owns chart/news leaf content.
// Keep this tree stable while React theme/context changes update sibling controls.
export const DashboardWorkspace = memo(function DashboardWorkspace() {
  return <div className="dashboard-shell" id="dashboard-shell">
    <aside className="news-sidebar card" id="news-sidebar" aria-labelledby="news-heading">
      <div className="news-header">
        <div><span className="news-eyebrow">Market news &middot; Live 5m</span><h2 id="news-heading">Latest for <span id="news-symbol">NVDA</span></h2></div>
        <button id="news-refresh-btn" className="news-refresh-btn" type="button" aria-label="Refresh news feed" aria-controls="news-feed" aria-busy="false">Refresh Feed</button>
      </div>
      <div className="news-feed" id="news-feed" aria-live="polite" aria-busy="true">
        {[0, 1, 2, 3].map(key => <div key={key} className="news-card news-card-skeleton"><span className="skel news-thumb-skeleton" /><span className="news-copy-skeleton"><span className="skel" /><span className="skel" /><span className="skel" /></span></div>)}
      </div>
    </aside>
    <main className="grid-stack" id="dashboard-grid" aria-label="Market charts">
      {widgets.map(widget => <ChartWidget key={widget.id} widget={widget} />)}
    </main>
  </div>;
});

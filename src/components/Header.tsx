import { memo } from 'react';
import { ThemeMenu } from './ThemeMenu';

// Stable leaves are managed by the dashboard adapter until each feature is migrated.
export const Header = memo(function Header() {
  return (
<header>
  <div className="brand">
    <svg className="brand-icon" viewBox="0 0 48 48" fill="none">
      <path d="M4 44 C2 48 36 30 33 12" stroke="white" strokeWidth="4.5" fill="none" strokeLinecap="round"/>
      <path d="M4 27 C6 29 28 14 33 12" stroke="white" strokeWidth="4.5" fill="none" strokeLinecap="round"/>
      <circle className="nose-ring" cx="36" cy="9" r="5" stroke="#e74c3c" strokeWidth="4.5" fill="none"/>
    </svg>
    <h1>Rudolph</h1>
  </div>
  <div className="hdr-bookmarks">
    <button id="bookmark-root-btn" className="bookmark-root-btn" type="button" aria-haspopup="menu" aria-expanded="false" aria-busy="true" aria-label="Open Chrome bookmarks">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.75h12a1 1 0 0 1 1 1v16l-7-4-7 4v-16a1 1 0 0 1 1-1Z"/></svg>
      <span>Bookmarks</span>
    </button>
  </div>
  <div className="hdr-ticker">
    <div className="ticker-combo" id="ticker-combo">
      <button className="ticker-btn" id="ticker-btn" type="button">NVDA</button>
      <div className="ticker-panel" id="ticker-panel">
        <input type="text" className="ticker-search" id="ticker-search" placeholder="Search stocks&hellip;" autoComplete="off" />
        <div className="ticker-list" id="ticker-list"></div>
        <div className="ticker-panel-footer">Stock data from Yahoo Finance &bull; Auto-refreshes every 1s</div>
      </div>
    </div>
  </div>

  <div className="hdr-price">
    <span className="stock-price" id="stock-price"><span className="skel skel-price"></span></span>
    <span className="stock-change" id="stock-change"><span className="skel skel-change"></span></span>
  </div>

  <div className="hdr-meta">
    <span><span className="live-dot"></span>&nbsp; Live</span>
    <span id="clock"></span>
  </div>

  <div className="hdr-controls">
    <div className="widget-menu-wrap" id="widget-menu-wrap">
      <button id="add-widget-btn" className="icon-btn" type="button" title="Grid" aria-label="Grid options">
        <svg className="header-control-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
      </button>
      <div className="widget-menu" id="widget-menu" role="menu"></div>
    </div>
    <ThemeMenu />
  </div>
</header>
  );
});

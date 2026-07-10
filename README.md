# Rudolph

<p align="center">
  <img src="screenshots/rudolph-dashboard.png" alt="Rudolph market dashboard showing a live Apple quote, contextual news feed, and interactive charts" width="100%">
</p>

<p align="center"><em>A fast, customizable market dashboard for every new tab.</em></p>

## Install Locally For Development

1. Open Chrome and go to `chrome://extensions`.
2. Turn on `Developer mode`.
3. Click `Load unpacked`.
4. Select the cloned `rudolph` repository folder.
5. Open a new tab. Chrome should load Rudolph as the new-tab page.

After editing files, return to `chrome://extensions` and click the reload button on the Rudolph extension card, then open a new tab again.

## What Rudolph Is

Rudolph is a customizable Chrome new-tab dashboard for tracking market symbols. It shows live quote data, after-hours movement, and draggable chart widgets for intraday, monthly, yearly, and all-time views.

The dashboard stores layout, selected symbols, hidden widgets, theme, and appearance preferences locally in the browser. It does not require a backend service.

## Features

- Live stock watchlist with search and removable tracked symbols.
- Default fresh-install watchlist using broad popular market symbols.
- Header quote summary with regular and extended-hours prices.
- Left-side contextual market-news feed with manual and five-minute live refresh, infinite older-story loading, and secure new-tab article links.
- Draggable and resizable Gridstack dashboard widgets.
- Chart.js visualizations for hour, day, month, year, and all-time ranges.
- Theme families for Samsung OneUI, Apple Liquid Glass, Cisco Momentum, Windows Fluent, Google Material, and IBM Carbon.
- Independent appearance mode: `Auto`, `Light`, or `Dark`.
- Auto appearance follows Chrome/system color settings where supported.

## Data Source

Stock data and the freshest ticker headlines are fetched from Yahoo Finance. Older headline history and matching archive thumbnails are loaded on demand from Google News. Both public hosts are declared in `manifest.json`:

```json
"host_permissions": [
  "https://query1.finance.yahoo.com/*",
  "https://news.google.com/*"
]
```

The app includes graceful fallback behavior for chart and quote loading, and shows placeholders while data is still loading.

## Development

This project is plain HTML, CSS, and JavaScript. There is no build step required for normal extension development.

Useful checks:

```bash
node --test test/extended-hours.test.js
node --test test/news-feed.test.js
node --test test/package-release.test.js
node --check js/app.js
```

Useful local preview:

```bash
python3 -m http.server 8765
```

Then open:

```text
http://127.0.0.1:8765/index.html
```

The extension entrypoint is `newtab.html`; `index.html` is useful for local browser preview.

## Packaging

Semantic version tracking lives in `VERSION`, and `manifest.json` must use the same version.

Create the Chrome extension package:

```bash
./package.sh
```

This creates one installable extension zip in `dist/`, with `manifest.json` at the zip root:

```text
dist/Rudolph-<version>-chrome-extension.zip
```

## Release

Create a signed semantic version tag and publish a GitHub release:

```bash
GITHUB_TOKEN=... ./release.sh
```

The release script:

- Reads `VERSION`.
- Requires `manifest.json` to match `VERSION`.
- Creates a signed tag named `v<VERSION>`.
- Pushes the tag to `origin`.
- Packages the extension.
- Creates a GitHub release with generated release notes.
- Uploads the single extension zip as the release asset.

Preview without creating tags or releases:

```bash
./release.sh --dry-run
```

## Repository Notes

This repository is intended to be public and personal. Avoid company-specific defaults, private links, private logic, or personally identifiable information in committed source.

import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  outDir: 'build',
  modules: ['@wxt-dev/module-react'],
  imports: false,
  manifest: {
    name: 'Rudolph',
    description: 'Customizable new tab dashboard with live stock watchlists and market charts.',
    permissions: ['bookmarks'],
    host_permissions: [
      'https://query1.finance.yahoo.com/*',
      'https://news.google.com/*',
    ],
    icons: { 16: 'icons/icon16.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' },
  },
  webExt: {
    chromiumArgs: ['--disable-features=MacAppCodeSignClone'],
  },
});

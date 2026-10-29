import { defineConfig } from 'wxt';
import config from './wxt.config';

export default defineConfig({
  ...config,
  webExt: { ...config.webExt, disabled: true },
});

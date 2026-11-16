import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    // Some privacy-configured browsers omit Origin on same-site form POSTs.
    // Login uses a server-generated double-submit token; authenticated writes
    // also require the Strict session cookie, and OAuth has its own state token.
    csrf: { checkOrigin: false }
  }
};

export default config;

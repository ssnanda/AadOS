declare global {
  /** App version from package.json, injected by vite.config.ts. */
  const __APP_VERSION__: string;
  namespace App {
    interface Locals {
      authenticated: boolean;
    }
  }
}

export {};

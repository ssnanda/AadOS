declare global {
  /** App version from package.json, injected by vite.config.ts. */
  const __APP_VERSION__: string;
  namespace App {
    interface Locals {
      authenticated: boolean;
      /** Signed-in owner or family member (null when signed out). */
      user: import('$lib/server/auth').SessionUser | null;
    }
  }
}

export {};

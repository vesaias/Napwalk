/// <reference types="vite/client" />

declare const __BUILD__: string;

interface ImportMetaEnv {
  /** public base URL of the overlay tiles (R2); empty in dev = same origin */
  readonly VITE_TILE_BASE?: string;
}

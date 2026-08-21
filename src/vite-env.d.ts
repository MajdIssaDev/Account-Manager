import type { RamApi } from "../electron/preload";

declare global {
  interface Window {
    ram: RamApi;
  }
}

export {};

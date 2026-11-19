/** Online-sources adapter interface (task 4.1). Compatible with BrowserSource. */
import type { BrowserItem, BrowserSource } from '../item';

export interface SourceConfig {
  readonly id: string;
  readonly label: string;
  /** Base URL / server address. */
  readonly url?: string;
  readonly token?: string;
}

export interface OnlineSourceAdapter {
  readonly id: string;
  readonly label: string;
  /** Builds a BrowserSource (throws/empty when unconfigured). */
  source(config?: SourceConfig): BrowserSource;
  /** Quick probe: is this adapter configured and reachable? */
  probe?(config?: SourceConfig): Promise<boolean>;
}

export const emptySource = (id: string, label: string, empty: string): BrowserSource => ({
  id, label, section: 'places', empty, items: async () => [] as readonly BrowserItem[],
});

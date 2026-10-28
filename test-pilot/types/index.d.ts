export type CacheEntry = { hash: string; result: unknown };
export type TestRun = {
  summary: string;
  isPassed: boolean;
  at: number;
  output: string;
};

declare module 'claude-code' {
  interface PluginState {
    'test-pilot': {
      last: TestRun | null;
    };
  }
}

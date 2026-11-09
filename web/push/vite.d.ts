// The types of vite.js, which is plain JavaScript because an app's vite.config loads it in Node, which refuses
// TypeScript from inside node_modules, where an app has the kit.

/** The parts of Vite's dev server the plugin uses. */
export interface DevServer {
  middlewares: {
    use(
      handler: (
        request: { url?: string },
        response: { setHeader(name: string, value: string): void; end(body: string): void },
        next: () => void,
      ) => void,
    ): void;
  };
}

/** The Vite plugin that serves the kit's notification worker at /push-worker.js, in dev and in the build. */
export function pushWorker(): {
  name: string;
  configureServer(server: DevServer): void;
  generateBundle(this: { emitFile(file: { type: 'asset'; fileName: string; source: string }): string }): void;
};

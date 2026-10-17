const esbuild = require('esbuild');

const isWatch = process.argv.includes('--watch');
const isProd = process.argv.includes('--production');

const common = {
  bundle: true,
  minify: isProd,
  sourcemap: !isProd,
  sourcesContent: false,
  logLevel: 'info',
};

async function main() {
  const contexts = await Promise.all([
    // Extension host
    esbuild.context({
      ...common,
      entryPoints: ['src/extension.ts'],
      format: 'cjs',
      platform: 'node',
      outfile: 'out/extension.js',
      external: ['vscode'],
    }),
    // Webview UI
    esbuild.context({
      ...common,
      entryPoints: ['src/webview/main.ts'],
      format: 'iife',
      platform: 'browser',
      outfile: 'out/webview.js',
    }),
  ]);

  if (isWatch) {
    await Promise.all(contexts.map((c) => c.watch()));
    console.log('Watching for changes...');
  } else {
    await Promise.all(contexts.map((c) => c.rebuild()));
    await Promise.all(contexts.map((c) => c.dispose()));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');
const isProd = process.argv.includes('--production');

async function main() {
  const extensionCtx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: isProd,
    sourcemap: !isProd,
    sourcesContent: false,
    platform: 'node',
    outfile: 'out/extension.js',
    external: ['vscode'],
    logLevel: 'info',
  });

  const webviewCtx = await esbuild.context({
    entryPoints: ['src/webview/main.ts'],
    bundle: true,
    format: 'iife',
    minify: isProd,
    sourcemap: !isProd,
    sourcesContent: false,
    platform: 'browser',
    outfile: 'out/webview.js',
    logLevel: 'info',
  });

  if (isWatch) {
    await extensionCtx.watch();
    await webviewCtx.watch();
    console.log('Watching for changes...');
  } else {
    await extensionCtx.rebuild();
    await extensionCtx.dispose();
    await webviewCtx.rebuild();
    await webviewCtx.dispose();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

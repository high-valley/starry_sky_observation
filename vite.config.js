import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

/** このビルドの目印。CI では GITHUB_SHA、手元では git の短いID。BUILD_ID で上書きできる（テスト用） */
function buildId() {
  if (process.env.BUILD_ID) return process.env.BUILD_ID;
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return String(Date.now());
  }
}

const BUILD = { id: buildId(), builtAt: new Date().toISOString() };

/** version.json を、ビルド結果と一緒に出す。画面はこれを読んで「最新版か」を調べる */
const versionFile = {
  name: 'version-file',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(BUILD) });
  },
};

// 相対パスで出力し、/starry_sky_observation/ など任意のパスの下に配信できるようにする
export default defineConfig({
  base: './',
  define: { __BUILD_ID__: JSON.stringify(BUILD.id), __BUILD_TIME__: JSON.stringify(BUILD.builtAt) },
  plugins: [versionFile],
  server: { host: '127.0.0.1' },
  test: { include: ['**/*.test.js'], exclude: ['node_modules/**', 'tests-e2e/**', 'dist/**'], globals: false },
});

# そらかざし（starry_sky_observation）

昼間でもスマホを空にかざすと、その方向に今ある星・星座が見えるウェブアプリ。画面は GitHub Pages（Vite でビルド）。サーバーやログインはない。構成と開発手順は `README.md`。

## 構成の決まり

- 天文計算（`src/astro.js`）は画面にもブラウザにも依存しない純粋な関数にする。Node でもそのままテストできるように保つ
- 端末の向きの扱いは `src/orientation.js`、描画は `src/renderer.js`、画面の状態と操作は `src/main.js` に分ける
- 星データは `public/data/`。手で編集せず `tools/build_data.py` で作り直す
- 位置・時刻の計算を変えたら、外部の値（国立天文台の暦など）と比べるテストを `test/astro.test.js` に足す

## 確認の仕方

- 変更したら `npm test`（Vitest。天文計算と更新確認の単体テスト）
- 画面に関わる変更は e2e も流す: `npm run build && npm run preview` を起動して `npm run test:e2e`（playwright が必要）。CI でも同じものが走る
- 公開後は `APP_URL=https://high-valley.github.io/starry_sky_observation/ npm run test:e2e` で公開画面も確かめられる
- センサーとカメラはヘッドレスブラウザでは確かめられない。`window.__sky.tracker._handle({alpha, beta, gamma, absolute: true}, true)` で向きを模擬できる
- 起動した dev サーバーやプレビューは、終わったら止める。`pkill -f` はコマンド行に一致して自分のシェルも止めることがあるので避ける

## 書き方

- コメント・画面の文言・コミットメッセージは日本語。周りのコードの密度と書き方に合わせる
- 標準ブランチ（`main`）へ直接 push しない。作業ブランチで進める
- 修正を頼まれたら、公開した画面で確かめられるところまで全部こちらで進める：作業ブランチ → PR → `main` へマージ → GitHub Pages のデプロイ完了を確認 → 公開画面で変更を確認。途中で止めて「PR を作りましょうか？」と聞かない

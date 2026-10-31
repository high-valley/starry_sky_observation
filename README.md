# そらかざし（starry_sky_observation）

昼間でもスマホを空にかざすと、今いる場所とかざした方向から、そこに本来ある星・星座・惑星・月を重ねて表示するウェブアプリです。

- 端末の向き（ジャイロ・コンパス）で見ている方向を求め、その方向の空を描画
- カメラ映像に星座を重ねる表示と、夜空だけの表示を切り替え
- 6等星までの約5,000個の恒星、88星座の星座線と日本語名、太陽・月（満ち欠け）・水星〜土星
- 時刻を進めて「今夜21時」「明け方4時」の空を確認
- センサーがない端末（PC など）は、ドラッグ・ホイール・矢印キーで見回し
- 星や星座をタップすると方位・高度・明るさなどを表示
- 太陽の方向を向くと注意を表示

## 開発

```
npm install
npm run dev            # http://127.0.0.1:5173/
npm test               # 天文計算・更新確認の単体テスト（Vitest）
npm run build          # dist/ に公開用の画面を作る（version.json も出る）
npm run preview        # dist/ を http://127.0.0.1:4173/ で配信
npm run test:e2e       # 画面の通しテスト（preview 起動中に実行。playwright が必要）
```

位置情報・センサー・カメラは **HTTPS（または localhost）** でないと使えません。スマホで試すときは公開した URL を開きます。

- iPhone（Safari）: 「空にかざして見る」を押すと「動作と方向」へのアクセス許可を求められます。
- Android（Chrome）: `deviceorientationabsolute` で北基準の方位を取得します。
- コンパスは周囲の磁石や金属でずれます。設定の「方位のずれを補正」か、画面を左右になぞって合わせられます。

## 構成

| パス | 内容 |
| --- | --- |
| `index.html`, `css/` | 画面 |
| `public/` | そのまま配信するもの（星データ・アイコン・manifest） |
| `src/astro.js` | 天文計算（恒星時・歳差・地平座標、太陽・月・惑星）。依存なし |
| `src/orientation.js` | 端末の向き → 視線方向（クォータニオン、iOS/Android の差異吸収） |
| `src/renderer.js` | Canvas 描画（心射図法。地平線・星座線が直線になる） |
| `src/catalog.js` | 星データの読み込み |
| `src/main.js` | 画面の状態管理と操作 |
| `public/data/` | 星表・星座線・星名（`tools/build_data.py` で生成） |
| `src/version.js`, `src/update.js` | 最新版の確認と更新の帯 |
| `test/` | Meeus の例題・国立天文台の暦との比較テスト、更新確認のテスト |
| `tests-e2e/` | 画面の通しテスト（Playwright） |

### 計算精度

| 対象 | 方法 | 誤差の目安 |
| --- | --- | --- |
| 恒星 | J2000 → 歳差（IAU 1976）→ 地平座標 | 0.01° 以下 |
| 太陽 | Meeus 25章 低精度式 | 約 0.01° |
| 月 | Meeus 47章 主要項 + 地心→観測地の視差 | 約 0.05° |
| 惑星 | JPL 近似軌道要素 + 光差 | 約 0.1° |

スマホのコンパス誤差（数度）に比べて十分小さくしています。大気差は描画では考慮していません（地平線付近で最大 0.5°）。

### 星データの再生成

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/ofrohn/d3-celestial
(cd d3-celestial && git sparse-checkout set data)
python3 tools/build_data.py d3-celestial/data
```

## 公開（GitHub Pages）

`main` への push で `.github/workflows/pages.yml` がテスト・ビルド・画面の通しテストを行い、自動デプロイする。PR ではデプロイせず、テストと通しテストだけ走る。

1. Settings → Pages → Source を **GitHub Actions** にする（初回のみ）
2. 公開先: https://high-valley.github.io/starry_sky_observation/

画面は数分ごとに `version.json` を見て、新しいバージョンがあれば上に「更新する」の帯を出す。設定画面の下にもバージョンと「最新版を確認」がある。

## 今後の候補

- 星座の境界線を使って「今見ている星座」を判定
- 天の川・星雲星団（メシエ天体）の表示
- オフライン対応（Service Worker）
- 星座の絵、神話の解説
- カメラの画角を端末ごとに自動で合わせる

## ライセンス

アプリのコードは MIT ライセンス。星データの出典とライセンスは [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。

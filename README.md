# 2027 Lunar Almanac

2027年の年間カレンダーと週間タイムテーブルです。月相・二至二分・週末をひと目で見渡し、日ごとのメモや時間ごとの予定を記録できます。

## GitHub Pagesで公開

このリポジトリには、GitHub Actionsで単一HTMLをビルドしてGitHub Pagesへ公開するワークフローがあります。

1. GitHubリポジトリの **Settings → Pages → Build and deployment** で **GitHub Actions** を選びます。
2. `main` ブランチへ変更をpushすると、自動でビルド・公開されます。
3. Pages設定に表示されるURLをブラウザーで開きます。

GitHub Pagesは静的サイトです。メモ・予定はブラウザーごとの`localStorage`に保存されるため、別の端末やブラウザーとは自動同期されません。バックアップにはヘッダーの「書き出し」、復元には「読み込み」を使ってください。

GitHub Pagesの利用可否と公開範囲は、リポジトリの公開状態とGitHubプランによって異なります。無料プランで非公開リポジトリを公開サイトにできない場合は、サイトを公開するためにリポジトリをPublicにする必要があります。ソースコードも公開されるので、設定を変更する前に確認してください。

## カレンダーの機能

- 年間ビュー: 日付を縦、月を横に並べ、月相と二至二分を表示
- 満月・新月・上弦・下弦を強調し、照らされた月の部分を金色で表示
- 土曜は青、日曜は赤で表示
- 日ごとのメモと予定を編集
- 週間ビュー: 1週間の時間割と終日予定を編集。年カレンダーのメモも終日欄に表示
- 週の左右移動、日付指定ジャンプ、ライト／ダークテーマ
- JSON形式で予定・メモを書き出し／読み込み
- 年間ビューを印刷

## ローカルで使う・ビルドする

`index.html`をブラウザーで開くか、単一HTMLを生成します。

```bash
node tools/build.mjs
```

出力先は`dist/index.html`です。CSS、JavaScript、天文データ、画像を内包しているため、単独で開けます。

## データの再生成

```bash
node tools/gen-2027.mjs 2027
```

天文データを`data/2027.js`へ出力します。

## 構成

```
index.html                 カレンダーのマークアップ
styles.css                 レイアウト・テーマ・印刷スタイル
app.js                     年間／週間ビューとブラウザー内保存
data/2027.js               コンパクトな天文データ
assets/moon.jpg            月面画像
tools/build.mjs            GitHub Pages用の単一HTMLビルド
tools/gen-2027.mjs         天文データ生成
.github/workflows/pages.yml GitHub Pagesのビルド・デプロイ
```

## クレジット

- 月面画像: NASA / GSFC / ASU — LRO（パブリックドメイン）
- フォント: Cormorant Garamond, Inter, Noto Sans JP（Google Fonts）

# 2027 Lunar Almanac — 年間カレンダー & 週間タイムテーブル

2027年を1画面で俯瞰する年間カレンダーと、時間単位で予定を書き込める週間ビューの2画面構成。

## 年間ビュー（上）

縦が日付（1〜31日）、横が月（1〜12月）のグリッド。

- 毎日の月相をアイコン表示（照らされた部分が金色、影は透明）
- 満月・新月・上弦・下弦は金色のリングで強調
- 二至二分（春分・夏至・秋分・冬至）を金色の帯とラベルで表示
- 土曜は青、日曜は赤
- 各セルに1行表示。メモがあればメモ、無ければその日の最初の予定（`10:30 定例ミーティング` / 終日なら `家族旅行`）。予定がある日は右下に金の点
- クリック（または Enter）でポップオーバーを開いて複数行のメモ編集、その日の予定一覧（`×` で削除）、週表示へのジャンプ

## 週間ビュー（下にスクロール）

1週間＝1画面の時間割。縦が時刻（0〜23時、30分の補助線あり）、横が日曜〜土曜。

- 日付ヘッダーに月相アイコン（主要月相はリング付き）
- 最上段の「終日」欄に、年間ビューで書いたメモと終日予定を表示。クリックでその場でメモ編集
- 左右のスワイプ／トラックパッドの横スクロール、`←` `→` キー、`‹` `›` ボタンで週を移動（全53週）
- 空白をクリック → その時刻から1時間の予定を作成
- 空白をドラッグ → 開始〜終了を指定して予定を作成（15分単位）
- 予定をクリック → タイトル編集（`Enter` で確定、`Esc` で取り消し）、`×` で削除
- 日付入力で任意の週へジャンプ

## カレンダーアプリのデータ取り込み（TimeTree / Google カレンダーなど）

ヘッダーの `iCal` ボタン、または `.ics` ファイルをウィンドウへドラッグ＆ドロップすると取り込みます。

- `VEVENT` の `SUMMARY` / `DTSTART` / `DTEND` / `RRULE` / `EXDATE` を解釈
- `VALUE=DATE` は終日予定として週の「終日」欄へ、時刻付きは時間割へ配置
- `Z` 付き UTC は JST に変換。`TZID` 付き・ローカル時刻はそのまま JST として扱う
- 繰り返しは `DAILY` / `WEEKLY`（`BYDAY`）/ `MONTHLY`（`BYMONTHDAY`）/ `YEARLY` に対応（`COUNT` / `UNTIL` / `INTERVAL` 可）
- 2026-12-20〜2028-01-10 の範囲を展開して保存
- 取り込んだ予定は日別メモのポップオーバーから `×` で個別に削除可能

TimeTree の場合はアプリ／Web の書き出し機能で `.ics` を保存し、それをドロップしてください（Google カレンダーの書き出しも同じ形式です）。

## TimeTree との双方向同期

TimeTree の**公式 API は 2023-12-22 に完全停止**しているため、非公式の Web API を使うサーバー方式を用意しています。

### Mac / PC でローカル利用

```bash
cp tools/.env.example tools/.env      # メール / パスワードを記入
node tools/serve.mjs                  # http://localhost:8787/ が開く
```

サイトのパスワードを設定しないローカル利用では、予定を `data/state.json` に保存します。TimeTree 認証情報は `tools/.env` に置き、ブラウザーへは送信しません。

### インターネット上に公開

静的ファイルだけを GitHub Pages 等に置いても同期はできません。サイトと同期 API を同じホストで実行する構成を推奨します。このリポジトリには Render 用の `render.yaml` を用意しています。

1. このフォルダーを自分の GitHub リポジトリに登録し、Render で Blueprint として作成します。
2. Render の環境変数にサイト用の `APP_PASSWORD`、TimeTree の `TIMETREE_EMAIL` / `TIMETREE_PASSWORD` を設定します。`APP_SESSION_SECRET` は Blueprint が生成します。
3. Persistent Disk が利用できるプランを選び、デプロイ後に HTTPS のサイトへアクセスしてサイト用パスワードでログインします。

`APP_PASSWORD` はTimeTreeのパスワードとは別に設定してください。予定とTimeTreeセッションは `/var/data` のディスクに保存されます。環境変数やセッションファイルを公開リポジトリへ登録しないでください。静的版 `dist/index.html` は引き続き同期APIなしのカレンダーとして使えます。

- **取り込み（pull）**: TimeTree の予定を 2027 年分だけ取得してマージ。終日は各日に、日跨ぎの予定は 2 日に分割
- **送信（push）**: この画面で作成・編集した予定を TimeTree へ作成／更新、削除は TimeTree 側でも削除
- **競合**: ローカルで未送信の編集（`dirty`）は pull で上書きしません
- 同期後は `state.json` に `tt.id` が記録され、次回以降は同じ予定として更新します
- TimeTree セッションはデータディレクトリ内に保存され、次回はログインを省略します

CLI でも同じ処理ができます。

```bash
node tools/sync-timetree.mjs --calendars   # カレンダー ID の確認
node tools/sync-timetree.mjs               # pull + push
node tools/sync-timetree.mjs --pull        # 取り込みのみ
node tools/sync-timetree.mjs --push        # 送信のみ
node tools/sync-timetree.mjs --emit        # data/timetree.js を書き出す（file:// 用）
```

### 注意

- **非公式 API** です。TimeTree の仕様変更で予告なく動かなくなります。規約上の位置づけも保証されません
- 公開サイトはログイン保護されます。HTTPS を使い、`APP_PASSWORD` は推測されにくい値にしてください
- `tools/.env`、TimeTree セッション、予定データは機密情報です。**コミットしないでください**（`.gitignore` 済み）
- 同期ロジックは `node tools/test-sync.mjs`、Web 認証とデータ保護は `node tools/test-server.mjs` で検証できます（実アカウントは不要）

## 使い方

`index.html` をブラウザで開くだけで動きます（ビルド不要・オフライン可）。

- 右上 `年間 / 週` で画面を切り替え（スクロールでも移動できます）
- 上部の `◐` でライト／ダーク切り替え
- メモと予定は localStorage に保存（ローカルサーバー利用時は `data/state.json`）。`書き出し` / `読み込み` で JSON を受け渡し
- `印刷` は年間ビューだけを A3 横1ページに出力

### ディープリンク

- `index.html#2027-03-21` … その日のメモを開いた状態で起動
- `index.html#week-2027-03-21` … 週表示でその週を開いた状態で起動

## 構成

```
index.html             マークアップ（年間／週の2ペイン）
styles.css             グリッド・配色・印刷用スタイル
app.js                 セル生成、月アイコン(SVG)生成、メモ編集、週間ビュー、.ics 取り込み、保存
data/2027.js           コンパクトな天文データ（file:// 直開き用）
data/state.json        ローカルサーバー利用時の保存先（メモ・予定・同期状態）
assets/moon.jpg        月面テクスチャ
tools/gen-2027.mjs     天文データ生成スクリプト
tools/serve.mjs        ローカルサーバー（静的配信 + 状態保存 + 同期 API）
tools/timetree-client.mjs  非公式 TimeTree API クライアント
tools/timetree-sync.mjs    変換・マージ・プッシュのロジック
tools/sync-timetree.mjs    同期 CLI
tools/test-sync.mjs        擬似サーバーによる同期テスト
tools/test-server.mjs      Web 認証・API 保護の統合テスト
tools/.env.example         認証情報のテンプレート
render.yaml               Render のデプロイ設定
```

保存キー: `lunar2027.notes.v1`（日別メモ）、`lunar2027.events.v1`（時間予定）、`lunar2027.theme.v1`

## データの再生成

```bash
node tools/gen-2027.mjs 2027
```

`tools/gen-2027.mjs` は Meeus『Astronomical Algorithms』第27章（二至二分）・第47章（月相）の近似式で
JST の時刻を計算し、`data/2027.js` を出力します。年を変えれば他の年にも使えます
（その場合は `index.html` の読み込みファイル名と `app.js` の `CAL_2027` を合わせてください）。

## クレジット

- 月面画像: NASA / GSFC / Arizona State University — Lunar Reconnaissance Orbiter（パブリックドメイン）
- フォント: Cormorant Garamond, Inter, Noto Sans JP（Google Fonts）

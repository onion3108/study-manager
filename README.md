# Study Manager

高校3年生向けの学習管理アプリです。GitHub Pagesで公開したWebサイトを、Supabase DB / Storageで同期し、画像・PDFのAI処理はPC上のローカルworkerが実行します。

Webサイトから`localhost`、Ollama、PaddleOCRへ直接アクセスしません。

## 構成

```text
GitHub Pages Web
  -> Supabase DB / Supabase Storage
  -> local PC worker
  -> Supabase DB
  -> GitHub Pages Web
```

主なファイル:

- `index.html`: GitHub Pagesで開く入口
- `styles.css`: 画面スタイル
- `data.js`: 初期データ
- `app.js`: 表示、操作、Supabase同期、AI job作成
- `supabase-config.js`: Web側のSupabase URL / anon key設定
- `supabase/schema.sql`: DBテーブル、RLS、Storage bucket/policy
- `worker/run_worker.py`: Supabaseのpending jobを処理するworker
- `worker/paddle_ocr_worker.py`: PaddleOCR
- `worker/ollama_worker.py`: Ollama連携
- `worker/requirements.txt`: worker依存関係

## GitHub Pagesで公開する方法

1. GitHubで`study-manager`リポジトリを作成します。
2. このプロジェクトをpushします。
3. GitHubの`Settings`を開きます。
4. `Pages`を開きます。
5. `Source`を`Deploy from a branch`にします。
6. `Branch`を`main`、folderを`/root`にします。
7. `Save`を押します。
8. 数分後に `https://onion3108.github.io/study-manager/` のようなURLへアクセスします。

CSS/JSは相対パスで読み込むため、リポジトリ名付きURLでも動きます。

## GitHubへpushする方法

```powershell
git add index.html styles.css app.js data.js supabase-config.js README.md .gitignore env.example worker supabase
git commit -m "Add Supabase sync and AI worker pipeline"
git branch -M main
git remote add origin https://github.com/onion3108/study-manager.git
git push -u origin main
```

すでにremoteがある場合は`git remote add origin ...`は不要です。

## Supabase設定

1. Supabaseで新しいProjectを作成します。
2. `SQL Editor`で`supabase/schema.sql`を実行します。
3. `Authentication > URL Configuration`でSite URLにGitHub PagesのURLを設定します。
4. `Authentication > Providers > Email`を有効にします。
5. `Project Settings > API`からURLとanon keyを確認します。
6. `supabase-config.js`に設定します。

```js
window.STUDY_MANAGER_SUPABASE = {
  url: "https://YOUR_PROJECT.supabase.co",
  anonKey: "YOUR_SUPABASE_ANON_KEY",
  storageBucket: "study-files",
};
```

anon keyはWebに置いてよい公開用キーです。service role keyは絶対にWebへ置かないでください。

## GitHub Pagesでログインする方法

Supabase側で以下を設定してください。

```text
Authentication
-> Providers
-> Email を有効化

Authentication
-> URL Configuration
-> Site URL
-> https://onion3108.github.io/study-manager/
```

Web側にはPublishable keyまたはLegacy anon keyだけを設定します。service role keyやsecret keyはWeb側に置かず、PC worker用の`.env`だけに保存してください。

ログイン手順:

1. GitHub PagesのStudy Managerを開きます。
2. `設定`または`AI取り込みセンター`を開きます。
3. `Supabaseログイン`カードにメールアドレスを入力します。
4. `ログインメール送信`を押します。
5. Supabaseから届いたメールリンクを開きます。
6. Study Managerに戻ると、ログイン中のメールアドレスと同期状態が表示されます。

未ログイン時はTodoや設定はlocalStorageへ一時保存できますが、PC/スマホ同期、画像/PDFアップロード、`ai_jobs`作成、AI結果取得にはログインが必要です。

## 同期対象

正本データはSupabaseに保存します。localStorageは一時キャッシュです。

- Todo
- カレンダー予定
- 今日の予定
- 時間割
- 重要イベント
- AI処理タスク
- AI生成結果
- アップロード画像/PDF
- OCR結果とOCRレイアウト構造
- 生成問題、解答、要約、重要語句
- 理解度データ
- 円グラフ用の学習状況データ
- 教科ごとの進捗
- 学習ログ
- 設定、通知設定、Ollamaモデル名
- 献立などアプリ内の保存データ

## WebサイトでAI依頼を作る方法

1. GitHub PagesのWebサイトでSupabaseへログインします。
2. 授業カードを開きます。
3. 板書写真、ノート写真、プリント画像、PDFをアップロードします。
4. ファイルはSupabase Storageの`study-files` bucketへ保存されます。
5. `ai_jobs`に`status='pending'`の行が作成されます。
6. AI取り込みセンターでpending/processing/completed/failedとデバッグ情報を確認できます。

GitHub Pages側はAIを実行せず、依頼をSupabaseに書き込むだけです。

## workerでPaddleOCR + Ollama処理する方法

PC側で実行します。

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r worker/requirements.txt
copy env.example .env
```

`.env`を編集します。

```env
OLLAMA_URL=http://localhost:11434/api/generate
OLLAMA_MODEL=elyza:jp8b
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
SUPABASE_STORAGE_BUCKET=study-files
```

service role keyはローカルworkerだけで使います。`.env`は`.gitignore`で除外されています。

1回だけ処理:

```powershell
python worker/run_worker.py --once
```

常駐処理:

```powershell
python worker/run_worker.py --interval 20 --limit 3
```

workerの流れ:

1. `ai_jobs`から`pending`を取得
2. `processing`へ更新
3. Supabase Storageから画像/PDFをダウンロード
4. PaddleOCRでレイアウト付きOCR
5. `ai_jobs.ocr_text`と`ai_jobs.ocr_layout`を更新
6. OCR済みテキストだけをOllamaへ渡す
7. 要約、重要語句、問題、解答、理解度データを作成
8. `ai_results`へ保存
9. `ai_jobs.status`を`completed`へ更新
10. 失敗時は`failed`と`error_message`を保存

## Ollamaの起動確認

```powershell
ollama list
Invoke-RestMethod -Uri http://localhost:11434/api/generate -Method Post -ContentType "application/json" -Body '{"model":"elyza:jp8b","prompt":"ping","stream":false}'
```

新しいモデルはworkerが勝手に入れません。`.env`の`OLLAMA_MODEL`には、すでに`ollama list`に表示されるモデル名を指定してください。

## PaddleOCRのインストール

```powershell
pip install -r worker/requirements.txt
```

初回実行時はPaddleOCRのモデル取得に時間がかかる場合があります。PDF処理には`pypdfium2`を使います。

## resultsの表示

workerが完了すると、WebサイトのAI取り込みセンターと授業詳細パネルに以下が表示されます。

- AI処理状態
- error_message
- OCRプレビュー
- 要約
- 重要語句
- 生成問題
- 解答
- 使用モデル
- worker処理時刻

手動で反映したい場合はAI取り込みセンターの`Supabase再読み込み`を押してください。Realtimeが有効な場合は自動反映されます。

## よくあるエラー

`SupabaseにログインしてからAI依頼を作成してください`
: Webでログインしていません。AI取り込みセンターからログインメールを送ってください。

`supabase-config.jsにURLとanon keyを設定してください`
: `supabase-config.js`が空です。SupabaseのURLとanon keyを設定してpushしてください。

`permission denied`またはStorage upload error
: `supabase/schema.sql`を実行し、Storage bucketとpolicyが作成されているか確認してください。

`SUPABASE_SERVICE_ROLE_KEY is not set`
: PC側の`.env`にservice role keyがありません。Web側には絶対に置かないでください。

`Ollama API error`
: Ollamaが起動しているか、`.env`の`OLLAMA_MODEL`が`ollama list`にあるモデルか確認してください。

`PaddleOCR import error`
: 仮想環境を有効化し、`pip install -r worker/requirements.txt`を再実行してください。

## 動作確認

1. PCでTodo追加し、スマホで同じアカウントにログインして表示を確認します。
2. スマホでTodo追加し、PCで表示を確認します。
3. PCでカレンダー予定や設定を変更し、スマホに反映されるか確認します。
4. localStorageを消して再読み込みし、Supabaseから復元されるか確認します。
5. Webから画像/PDFをアップロードします。
6. Supabase Storageにファイルが保存されたか確認します。
7. `ai_jobs`に`pending`が作成されたか確認します。
8. `python worker/run_worker.py --once`を実行します。
9. `pending -> processing -> completed`へ変わるか確認します。
10. `ai_jobs.ocr_text`と`ai_jobs.ocr_layout`が保存されたか確認します。
11. `ai_results`に要約、問題、解答、重要語句が保存されたか確認します。
12. WebサイトにOCR結果、問題、要約、解答が表示されるか確認します。
13. エラー時は`failed`と`error_message`が表示されるか確認します。

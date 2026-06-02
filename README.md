# Study Manager

高校3年生向けの学習管理アプリです。ホーム、カレンダー、Todo、時間割、教科カード、AI取り込みセンターを、GitHub Pagesで公開できる静的Webサイトとして動かします。

Webサイト側ではOllama、PaddleOCR、`localhost:11434`へ直接接続しません。AI処理はPC側のローカルworkerで行い、Webサイトとは `jobs.json` / `results.json` のエクスポート・インポートでつなぎます。

## ファイル構成

- `index.html`: GitHub Pagesで公開する入口
- `styles.css`: UIスタイル
- `app.js`: 画面表示、localStorage保存、AI jobs作成、結果読み込み
- `data.js`: 時間割、年間予定、献立、Todo初期データ
- `worker/run_worker.py`: jobs.jsonを処理する入口
- `worker/paddle_ocr_worker.py`: PaddleOCRで画像/PDFを構造付きOCR
- `worker/ollama_worker.py`: OCR済みテキストをOllamaへ渡して要約・問題生成
- `worker/requirements.txt`: worker用Python依存
- `worker/README.md`: workerの詳しい使い方
- `.gitignore`: 公開不要ファイルの除外
- `env.example`: worker用環境変数例

CSS/JSはすべて `./styles.css`、`./data.js`、`./app.js` の相対パスで読み込むため、`https://ユーザー名.github.io/リポジトリ名/` 形式でも動きます。

## GitHubへpushする方法

1. GitHubで新しいリポジトリを作成します。
2. このフォルダで次を実行します。

```powershell
git init
git add index.html styles.css app.js data.js README.md .gitignore env.example jobs.json worker supabase
git commit -m "Prepare Study Manager for GitHub Pages"
git branch -M main
git remote add origin https://github.com/<ユーザー名>/<リポジトリ名>.git
git push -u origin main
```

すでにremoteがある場合は、`git remote add origin ...` の代わりに `git remote -v` で確認してからpushしてください。

## GitHub Pagesを有効化する方法

1. GitHubのリポジトリページを開きます。
2. `Settings` を開きます。
3. 左メニューの `Pages` を開きます。
4. `Source` を `Deploy from a branch` にします。
5. `Branch` を `main`、folderを `/root` にします。
6. `Save` を押します。
7. 数分後、Pages画面に公開URLが表示されます。

公開URL例:

```text
https://<ユーザー名>.github.io/<リポジトリ名>/
```

## Webサイトでできること

- ホーム表示
- カレンダー表示
- Todo管理
- 時間割表示
- 教科カードから画像/PDFアップロード
- アップロード時のpending AI job作成
- `AI jobsを書き出す` で `jobs.json` をダウンロード
- `AI結果を読み込む` で `results.json` を読み込み
- 授業詳細パネルにOCR結果、要約、重要ポイント、生成問題を表示

## Webサイトでやらないこと

- Ollamaへ直接アクセスしない
- `localhost:11434`へ直接アクセスしない
- PaddleOCRをブラウザ内で実行しない
- 秘密キーをブラウザに埋め込まない
- ローカルファイルへ直接保存しない

データ保存はlocalStorageとJSONインポート/エクスポートで行います。

## AI jobsを書き出す方法

1. GitHub Pages上のStudy Managerを開きます。
2. 時間割や日表示から教科カードを開きます。
3. `板書写真を追加`、`ノート写真を追加`、`プリントを追加` で画像/PDFを選びます。
4. 自動でpending jobが作成されます。
5. `AI取り込みセンター` を開きます。
6. `AI jobsを書き出す` を押して `jobs.json` を保存します。

## workerでPaddleOCR + Ollama処理する方法

PC側で実行します。GitHub Pages上では実行しません。

1. Ollamaを起動します。
2. モデルがあるか確認します。

```powershell
ollama list
```

3. PaddleOCR依存を入れます。

```powershell
python -m pip install -r worker/requirements.txt
```

4. Webサイトから書き出した `jobs.json` をこのプロジェクトのルートに置きます。
5. workerを実行します。

```powershell
$env:OLLAMA_MODEL="elyza:jp8b"
python worker/run_worker.py --jobs jobs.json --results results.json
```

6. `results.json` が作成されます。

workerは画像/PDFをPaddleOCRでOCRし、OllamaにはOCR済みテキストだけを渡します。

## results.jsonをWebサイトへ読み込む方法

1. GitHub Pages上のStudy Managerを開きます。
2. `AI取り込みセンター` を開きます。
3. `AI結果を読み込む` から `results.json` を選びます。
4. 対応するjobに結果がマージされます。
5. 授業詳細パネルにOCR結果、要約、重要ポイント、生成問題が表示されます。

## Ollamaの起動確認

```powershell
ollama list
```

API確認:

```powershell
Invoke-RestMethod -Uri http://localhost:11434/api/generate -Method Post -ContentType "application/json" -Body '{"model":"elyza:jp8b","prompt":"ping","stream":false}'
```

この確認はPC側で行います。GitHub Pagesのブラウザからは行いません。

## PaddleOCRのインストール

Windows CPU環境では、現在の検証では `paddlepaddle==3.2.2` が安定しました。

```powershell
python -m pip install paddleocr paddlepaddle==3.2.2 pypdfium2 Pillow
```

## よくあるエラー

`Ollama API error 404`
: モデル名が違う可能性があります。`ollama list` に表示された名前を `OLLAMA_MODEL` に指定してください。

`Connection refused`
: Ollamaが起動していません。Ollamaアプリまたはサービスを起動してください。

`PaddleOCR import error`
: `python -m pip install -r worker/requirements.txt` を実行してください。

`results.jsonを読み込んでも反映されない`
: `jobs.json` を書き出したあとにlocalStorageを消すと、Web側に元jobがなくなる場合があります。同じブラウザで読み込むか、`results.json` に含まれるjob情報を確認してください。

`localStorage容量不足`
: 大きいPDFや画像を多数入れると容量に達する場合があります。処理後は不要なjobを削除するか、画像を圧縮してからアップロードしてください。

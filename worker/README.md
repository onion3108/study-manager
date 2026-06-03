# Study Manager Local AI Worker

GitHub Pages上のStudy Managerから作成された`ai_jobs`を、Supabase経由で処理するPC側workerです。

WebサイトからOllama、PaddleOCR、localhostへ直接アクセスしません。workerだけがPC内のOllamaとPaddleOCRを使います。

## 処理フロー

1. Supabase DBの`ai_jobs`から`status='pending'`を取得
2. `processing`へ更新
3. Supabase Storageから画像/PDFを一時ファイルとしてダウンロード
4. PaddleOCRでレイアウト付きOCR
5. `ai_jobs.ocr_text`と`ai_jobs.ocr_layout`を更新
6. OCR済みテキストだけをOllamaへ渡す
7. 要約、重要語句、問題、解答、理解度データを生成
8. `ai_results`へ保存
9. `ai_jobs.status='completed'`、`result_id`、`worker_processed_at`を保存
10. 失敗時は`failed`と`error_message`を保存

## セットアップ

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
OCR_USE_GPU=auto
OCR_LANG=japan
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
SUPABASE_STORAGE_BUCKET=study-files
```

`SUPABASE_SERVICE_ROLE_KEY`はWebサイトに置かず、PC側workerの`.env`だけに置いてください。

## 実行

1回だけ処理:

```powershell
python worker/run_worker.py --once
```

常駐処理:

```powershell
python worker/run_worker.py --interval 20 --limit 3
```

起動ログに`OCR_USE_GPU`、`ocr_lang`、`paddle_cuda`が表示されます。GPU初期化に失敗した場合もworker全体は落とさず、CPU OCRへフォールバックします。

## GPU OCR

CPU固定:

```powershell
$env:OCR_USE_GPU="false"
python worker/run_worker.py --once
```

GPUを試す:

```powershell
$env:OCR_USE_GPU="true"
python worker/run_worker.py --once
```

自動判定:

```powershell
$env:OCR_USE_GPU="auto"
python worker/run_worker.py --once
```

GPU OCRにはNVIDIA GPU、対応CUDA、GPU対応のPaddlePaddle/PaddleOCR環境が必要です。GPU版が入っていない、CUDAが使えない、またはPaddleOCR初期化に失敗した場合は、ログに理由を出してCPUで処理を続けます。

## Ollama確認

```powershell
ollama list
Invoke-RestMethod -Uri http://localhost:11434/api/generate -Method Post -ContentType "application/json" -Body '{"model":"elyza:jp8b","prompt":"ping","stream":false}'
```

workerは新しいOllamaモデルを自動インストールしません。`OLLAMA_MODEL`にはインストール済みのモデル名を指定してください。

## PaddleOCR確認

```powershell
python -c "from paddleocr import PaddleOCR; print('paddleocr ok')"
```

PDFは`pypdfium2`で画像化してからOCRします。

## デバッグ

Supabase Table Editorで以下を確認してください。

- `ai_jobs.status`
- `ai_jobs.error_message`
- `ai_jobs.ocr_text`
- `ai_jobs.ocr_layout`
- `ai_jobs.result_id`
- `ai_jobs.worker_processed_at`
- `ai_results.summary`
- `ai_results.questions`
- `ai_results.answers`

Storage側では`study-files/{user_id}/{job_id}/...`にアップロードファイルが保存されます。

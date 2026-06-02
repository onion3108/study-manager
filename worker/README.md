# Study Manager Local Worker

GitHub Pages上のStudy Managerから書き出した `jobs.json` を、PC側で処理するworkerです。

ブラウザからOllamaやPaddleOCRへ直接接続しません。workerがPC上で画像/PDFをPaddleOCRにかけ、OCR済みテキストだけをOllamaへ送ります。

## セットアップ

```powershell
python -m pip install -r worker/requirements.txt
```

Ollamaモデル確認:

```powershell
ollama list
```

## 起動

プロジェクトルートで実行します。

```powershell
$env:OLLAMA_MODEL="elyza:jp8b"
python worker/run_worker.py --jobs jobs.json --results results.json
```

環境変数:

- `OLLAMA_URL`: 既定値 `http://localhost:11434/api/generate`
- `OLLAMA_MODEL`: 既定値 `elyza:jp8b`

## 処理フロー

1. `jobs.json` を読み込む
2. `status: "pending"` のjobを探す
3. job内の `file_data_url` を一時ファイルへ復元
4. PaddleOCRで画像/PDFをOCR
5. OCR結果を `text`、`layout_text`、`layout_blocks` として保持
6. OCR済みテキストだけをOllamaへ送る
7. 要約、重要ポイント、問題、解説を生成
8. `results.json` に保存

## jobs.json形式

```json
{
  "jobs": [
    {
      "id": "job_xxx",
      "job_type": "analyze_print_image",
      "source_type": "image",
      "file_name": "print.jpg",
      "file_type": "image/jpeg",
      "file_data_url": "data:image/jpeg;base64,...",
      "related_subject": "世界史",
      "related_date": "2026-06-10",
      "related_period": 3,
      "status": "pending",
      "created_at": "2026-06-10T10:00:00.000Z"
    }
  ]
}
```

## results.json形式

```json
{
  "results": [
    {
      "job_id": "job_xxx",
      "status": "completed",
      "input_text": "[page 1]\n(10,20) OCRテキスト",
      "ocr_result": {
        "engine": "PaddleOCR",
        "language": "japan",
        "block_count": 12
      },
      "layout_blocks": [],
      "result_json": {
        "summary": "要約",
        "important_points": ["重要ポイント"],
        "questions": []
      }
    }
  ]
}
```

## 注意

- Ollamaには画像を直接渡しません。
- GitHub Pagesから `localhost` にアクセスさせません。
- 大きなPDFは処理に時間がかかります。
- `file_data_url` はresultsには保存しないため、結果ファイルは軽くなります。

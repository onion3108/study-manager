import json
import os
import re
import urllib.error
import urllib.request


OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434/api/generate")
DEFAULT_OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "elyza:jp8b")


def job_metadata(job):
    return job.get("metadata") or {}


def build_prompt(job, ocr_result):
    metadata = job_metadata(job)
    related_class = metadata.get("related_class") or {}
    subject = job.get("subject") or metadata.get("related_subject") or related_class.get("subject") or "未指定"
    date = metadata.get("related_date") or related_class.get("date") or "未指定"
    period = metadata.get("related_period") or related_class.get("period") or "未指定"
    file_name = metadata.get("file_name") or metadata.get("uploaded_file", {}).get("name") or job.get("file_path") or "未指定"
    input_text = (job.get("input_text") or "").strip()
    ocr_text = (ocr_result.get("layout_text") or ocr_result.get("text") or "").strip()
    source_text = ocr_text or input_text

    return f"""
あなたは高校3年生向けの学習管理アプリのローカルAI workerです。
GitHub PagesのWebサイトから直接Ollamaへは接続していません。
Ollamaには画像やPDFを直接渡さず、PaddleOCRで抽出したレイアウト付きテキストだけを渡しています。

授業・資料情報:
- 日付: {date}
- 時限: {period}
- 科目: {subject}
- job_type: {job.get("job_type")}
- ファイル: {file_name}

OCRまたは入力テキスト:
{source_text[:12000]}

次のJSONだけを返してください。Markdown、説明文、コードブロックは不要です。
日本語で、誤読の可能性がある部分は断定しすぎず、学習に使いやすく整理してください。
questionsは最大10問にしてください。important_termsは重要語句や重要ポイントを配列で返してください。

{{
  "summary": "内容の短い要約",
  "important_terms": ["重要語句1", "重要語句2"],
  "questions": [
    {{
      "type": "multiple_choice",
      "question": "問題文",
      "choices": ["A", "B", "C", "D"],
      "answer": "B",
      "explanation": "解説"
    }},
    {{
      "type": "short_answer",
      "question": "問題文",
      "answer": "答え",
      "explanation": "解説"
    }}
  ],
  "answers": [
    {{
      "question": "問題文",
      "answer": "答え",
      "explanation": "解説"
    }}
  ],
  "understanding_data": {{
    "recommended_review": "復習の提案",
    "difficulty": "normal"
  }}
}}
""".strip()


def call_ollama(prompt, model_name=None):
    model = model_name or DEFAULT_OLLAMA_MODEL
    body = json.dumps(
        {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": 0.1},
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        OLLAMA_URL,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            payload = json.loads(response.read().decode("utf-8"))
            return payload.get("response", "")
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Ollama API error {error.code}: {detail}") from error


def parse_json_response(text):
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", text)
        if not match:
            return {
                "summary": text[:500],
                "important_terms": [],
                "questions": [],
                "answers": [],
                "understanding_data": {},
                "raw_response": text,
            }
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return {
                "summary": text[:500],
                "important_terms": [],
                "questions": [],
                "answers": [],
                "understanding_data": {},
                "raw_response": text,
            }


def ensure_study_shape(result, ocr_result):
    if not isinstance(result, dict):
        result = {"summary": str(result)}
    questions = result.get("questions")
    summary = result.get("summary")
    if isinstance(questions, list) and isinstance(summary, str) and summary:
        result.setdefault("important_terms", result.get("important_points") or [])
        result.setdefault("answers", [
            {
                "question": item.get("question", ""),
                "answer": item.get("answer", ""),
                "explanation": item.get("explanation", ""),
            }
            for item in questions
            if isinstance(item, dict)
        ])
        result.setdefault("understanding_data", {})
        return result

    lines = [
        line.split(") ", 1)[-1].strip()
        for line in (ocr_result.get("layout_text") or ocr_result.get("text") or "").splitlines()
        if line.strip() and not line.startswith("[page")
    ]
    points = [line for line in lines[:5] if line]
    fallback_summary = "OCR結果から読み取れた内容を確認してください。誤読の可能性があるため、元画像と照合しながら復習してください。"
    if points:
        fallback_summary = " / ".join(points[:3])[:240]

    return {
        "summary": fallback_summary,
        "important_terms": points[:5],
        "questions": [
            {
                "type": "short_answer",
                "question": "OCR結果の中で、最も重要だと思う語句を1つ書きなさい。",
                "answer": points[0] if points else "OCR結果を確認",
                "explanation": "OCR結果をもとに、授業内容の中心語句を確認する問題です。",
            },
            {
                "type": "short_answer",
                "question": "この資料の内容を一文で要約しなさい。",
                "answer": fallback_summary,
                "explanation": "要約できるかを確認する復習問題です。",
            },
        ],
        "answers": [],
        "understanding_data": {"recommended_review": "元資料とOCR結果を照合して復習してください。", "difficulty": "unknown"},
        "raw_response": result.get("raw_response") or summary or "",
    }


def generate_study_result(job, ocr_result, model_name=None):
    prompt = build_prompt(job, ocr_result)
    raw = call_ollama(prompt, model_name=model_name)
    return ensure_study_shape(parse_json_response(raw), ocr_result)

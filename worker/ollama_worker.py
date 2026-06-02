import json
import os
import re
import urllib.error
import urllib.request

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434/api/generate")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "elyza:jp8b")


def build_prompt(job, ocr_result):
    subject = job.get("related_subject") or job.get("related_class", {}).get("subject") or "未指定"
    date = job.get("related_date") or job.get("related_class", {}).get("date") or "未指定"
    period = job.get("related_period") or job.get("related_class", {}).get("period") or "未指定"
    text = (ocr_result.get("layout_text") or ocr_result.get("text") or "").strip()

    return f"""
あなたは高校3年生向けの学習管理アプリのローカルAI workerです。
Ollamaには画像を渡していません。以下はPaddleOCRで抽出した文字と座標付きレイアウトです。
OCRには誤字が含まれる可能性があります。文脈から自然に補正し、学習用に整理してください。

授業:
- 日付: {date}
- 時限: {period}
- 科目: {subject}
- ファイル: {job.get("file_name") or job.get("uploaded_file", {}).get("name") or "未指定"}

OCR結果:
{text[:12000]}

必ずJSONだけを返してください。Markdownや説明文をJSONの外に出さないでください。
summary、important_points、questions、answer、explanationは日本語で返してください。
問題は最大10問、選択問題と記述問題を混ぜてください。

返却JSON形式:
{{
  "summary": "授業内容の短い要約",
  "important_points": ["重要ポイント1", "重要ポイント2"],
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
  ]
}}
""".strip()


def call_ollama(prompt):
    body = json.dumps(
        {
            "model": OLLAMA_MODEL,
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
                "important_points": [],
                "questions": [],
                "raw_response": text,
            }
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return {
                "summary": text[:500],
                "important_points": [],
                "questions": [],
                "raw_response": text,
            }


def ensure_study_shape(result, ocr_result):
    questions = result.get("questions") if isinstance(result, dict) else None
    summary = result.get("summary") if isinstance(result, dict) else ""
    if isinstance(questions, list) and questions and isinstance(summary, str) and not summary.lstrip().startswith("{"):
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
        "important_points": points[:5],
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
        "raw_response": result.get("raw_response") or summary if isinstance(result, dict) else "",
    }


def generate_study_result(job, ocr_result):
    prompt = build_prompt(job, ocr_result)
    raw = call_ollama(prompt)
    return ensure_study_shape(parse_json_response(raw), ocr_result)

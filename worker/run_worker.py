import argparse
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

from ollama_worker import DEFAULT_OLLAMA_MODEL, generate_study_result
from paddle_ocr_worker import run_paddle_ocr


SUPPORTED_JOB_TYPES = {
    "analyze_board_image",
    "analyze_note_image",
    "analyze_print_image",
    "analyze_print_pdf",
    "generate_questions",
    "import_annual_schedule",
    "import_monthly_schedule",
    "import_timetable",
    "import_timetable_change",
    "import_menu",
    "import_assignment",
    "import_board",
    "import_note",
    "import_test_result",
    "import_question_print",
    "import_other",
}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def required_env(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is not set. Put it in .env.")
    return value


class SupabaseAiWorker:
    def __init__(self):
        load_dotenv()
        self.url = required_env("SUPABASE_URL")
        self.service_key = required_env("SUPABASE_SERVICE_ROLE_KEY")
        self.bucket = os.environ.get("SUPABASE_STORAGE_BUCKET", "study-files")
        self.model_name = os.environ.get("OLLAMA_MODEL", DEFAULT_OLLAMA_MODEL)
        self.supabase = create_client(self.url, self.service_key)

    def fetch_pending_jobs(self, limit):
        response = (
            self.supabase.table("ai_jobs")
            .select("*")
            .eq("status", "pending")
            .order("created_at", desc=False)
            .limit(limit)
            .execute()
        )
        return response.data or []

    def update_job(self, job_id, fields):
        payload = {**fields, "updated_at": now_iso()}
        return self.supabase.table("ai_jobs").update(payload).eq("id", job_id).execute()

    def claim_job(self, job):
        response = (
            self.supabase.table("ai_jobs")
            .update({"status": "processing", "started_at": now_iso(), "updated_at": now_iso(), "model_name": self.model_name})
            .eq("id", job["id"])
            .eq("status", "pending")
            .select("*")
            .execute()
        )
        return (response.data or [None])[0]

    def download_storage_file(self, job):
        file_path = job.get("file_path")
        if not file_path:
            return None
        suffix = Path(file_path).suffix or ".bin"
        temp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        temp_path = Path(temp.name)
        temp.close()
        raw = self.supabase.storage.from_(self.bucket).download(file_path)
        if isinstance(raw, bytes):
            data = raw
        elif hasattr(raw, "content"):
            data = raw.content
        else:
            data = bytes(raw)
        temp_path.write_bytes(data)
        return temp_path

    def build_ocr_result(self, job, temp_path):
        if temp_path is None:
            text = (job.get("input_text") or "").strip()
            return {
                "engine": "manual_input",
                "language": "ja",
                "source_name": "input_text",
                "page_count": 0,
                "block_count": 1 if text else 0,
                "text": text,
                "layout_text": text,
                "pages": [],
                "blocks": [{"id": "text-1", "page": 1, "line": 1, "text": text, "source_type": "manual_input"}] if text else [],
            }
        file_name = (job.get("metadata") or {}).get("file_name") or Path(job.get("file_path", temp_path.name)).name
        return run_paddle_ocr(temp_path, file_name)

    def create_result(self, job, ocr_result, result_json):
        questions = result_json.get("questions") if isinstance(result_json, dict) else []
        if not isinstance(questions, list):
            questions = []
        answers = result_json.get("answers") if isinstance(result_json, dict) else None
        if not answers:
            answers = [
                {
                    "question": item.get("question", ""),
                    "answer": item.get("answer", ""),
                    "explanation": item.get("explanation", ""),
                }
                for item in questions
                if isinstance(item, dict)
            ]
        important_terms = []
        if isinstance(result_json, dict):
            important_terms = result_json.get("important_terms") or result_json.get("important_points") or []
        if not isinstance(important_terms, list):
            important_terms = [str(important_terms)]
        understanding_data = result_json.get("understanding_data") if isinstance(result_json, dict) else {}
        if not isinstance(understanding_data, dict):
            understanding_data = {"raw": understanding_data}
        understanding_data.setdefault("question_count", len(questions))
        understanding_data.setdefault("ocr_block_count", ocr_result.get("block_count", 0))

        payload = {
            "user_id": job["user_id"],
            "job_id": job["id"],
            "subject": job.get("subject") or "",
            "source_text": job.get("input_text") or "",
            "ocr_text": ocr_result.get("layout_text") or ocr_result.get("text") or "",
            "ocr_layout": ocr_result,
            "summary": result_json.get("summary", "") if isinstance(result_json, dict) else "",
            "questions": questions,
            "answers": answers,
            "important_terms": important_terms,
            "understanding_data": understanding_data,
            "model_name": self.model_name,
            "error_message": None,
        }
        response = self.supabase.table("ai_results").insert(payload).select("*").execute()
        return (response.data or [None])[0]

    def process_job(self, job):
        if job.get("job_type") not in SUPPORTED_JOB_TYPES:
            raise ValueError(f"Unsupported job_type: {job.get('job_type')}")

        claimed = self.claim_job(job)
        if not claimed:
            return False

        temp_path = None
        try:
            temp_path = self.download_storage_file(claimed)
            ocr_result = self.build_ocr_result(claimed, temp_path)
            self.update_job(claimed["id"], {
                "ocr_text": ocr_result.get("layout_text") or ocr_result.get("text") or "",
                "ocr_layout": ocr_result,
            })
            result_json = generate_study_result(claimed, ocr_result, self.model_name)
            result_row = self.create_result(claimed, ocr_result, result_json)
            self.update_job(claimed["id"], {
                "status": "completed",
                "completed_at": now_iso(),
                "worker_processed_at": now_iso(),
                "result_id": result_row["id"] if result_row else None,
                "error_message": None,
                "model_name": self.model_name,
            })
            print(f"completed {claimed['id']}")
            return True
        except Exception as error:
            self.update_job(claimed["id"], {
                "status": "failed",
                "completed_at": now_iso(),
                "worker_processed_at": now_iso(),
                "error_message": str(error),
                "model_name": self.model_name,
            })
            print(f"failed {claimed['id']}: {error}")
            return False
        finally:
            if temp_path:
                try:
                    temp_path.unlink(missing_ok=True)
                except OSError:
                    pass

    def run_once(self, limit):
        jobs = self.fetch_pending_jobs(limit)
        if not jobs:
            print("no pending jobs")
            return 0
        processed = 0
        for job in jobs:
            print(f"processing {job.get('id')} ({job.get('job_type')})")
            if self.process_job(job):
                processed += 1
        return processed


def main():
    parser = argparse.ArgumentParser(description="Process Study Manager ai_jobs from Supabase with PaddleOCR and Ollama.")
    parser.add_argument("--once", action="store_true", help="Process pending jobs once and exit.")
    parser.add_argument("--interval", type=int, default=20, help="Polling interval seconds when running continuously.")
    parser.add_argument("--limit", type=int, default=3, help="Maximum pending jobs per polling cycle.")
    args = parser.parse_args()

    worker = SupabaseAiWorker()
    print(f"Study Manager worker started. bucket={worker.bucket} model={worker.model_name}")
    while True:
        worker.run_once(args.limit)
        if args.once:
            break
        time.sleep(args.interval)


if __name__ == "__main__":
    main()

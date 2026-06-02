import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from ollama_worker import generate_study_result
from paddle_ocr_worker import ocr_job_file, run_paddle_ocr


SUPPORTED_JOB_TYPES = {
    "analyze_board_image",
    "analyze_note_image",
    "analyze_print_image",
    "analyze_print_pdf",
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


def read_jobs(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    return data.get("jobs", []) if isinstance(data, dict) else []


def write_results(path, results):
    path.write_text(json.dumps({"results": results}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def sanitize_job_for_result(job):
    return {key: value for key, value in job.items() if key != "file_data_url"}


def process_job(job):
    if job.get("job_type") not in SUPPORTED_JOB_TYPES:
        raise ValueError(f"Unsupported job_type: {job.get('job_type')}")

    source_path, temp_path = ocr_job_file(job)
    try:
        ocr_result = run_paddle_ocr(source_path, job.get("file_name") or source_path.name)
    finally:
        if temp_path:
            try:
                temp_path.unlink(missing_ok=True)
            except OSError:
                pass

    result_json = generate_study_result(job, ocr_result)
    return {
        **sanitize_job_for_result(job),
        "job_id": job["id"],
        "status": "completed",
        "processed_at": now_iso(),
        "input_text": ocr_result.get("layout_text") or ocr_result.get("text") or "",
        "ocr_result": ocr_result,
        "layout_blocks": ocr_result.get("blocks", []),
        "result_json": result_json,
        "error_message": None,
    }


def main():
    parser = argparse.ArgumentParser(description="Process Study Manager AI jobs with PaddleOCR and Ollama.")
    parser.add_argument("--jobs", default="jobs.json", help="Path to jobs.json exported from the Web app.")
    parser.add_argument("--results", default="results.json", help="Path to write results.json.")
    args = parser.parse_args()

    jobs_path = Path(args.jobs)
    results_path = Path(args.results)
    jobs = read_jobs(jobs_path)
    results = []

    for job in jobs:
        if job.get("status") != "pending":
            continue
        print(f"Processing {job.get('id')} ({job.get('job_type')})")
        try:
            results.append(process_job(job))
        except Exception as error:
            results.append(
                {
                    **sanitize_job_for_result(job),
                    "job_id": job.get("id"),
                    "status": "failed",
                    "processed_at": now_iso(),
                    "result_json": None,
                    "error_message": str(error),
                }
            )

    write_results(results_path, results)
    print(f"Wrote {len(results)} result(s) to {results_path}")


if __name__ == "__main__":
    main()

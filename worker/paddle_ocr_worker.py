import json
import os
import tempfile
from pathlib import Path

_ocr = None
_ocr_device = "unknown"


def env_flag(name, default="auto"):
    return os.environ.get(name, default).strip().lower()


def is_gpu_requested():
    value = env_flag("OCR_USE_GPU", "auto")
    return value in {"1", "true", "yes", "on", "gpu", "auto"}


def is_gpu_forced_off():
    return env_flag("OCR_USE_GPU", "auto") in {"0", "false", "no", "off", "cpu"}


def paddle_cuda_available():
    try:
      import paddle

      return bool(paddle.device.is_compiled_with_cuda())
    except Exception:
      return False


def ocr_language():
    return os.environ.get("OCR_LANG") or os.environ.get("OCR_LANGUAGE") or "japan"


def init_paddle_ocr(use_gpu):
    from paddleocr import PaddleOCR

    kwargs = {
        "lang": ocr_language(),
        "text_recognition_model_name": "japan_PP-OCRv3_mobile_rec",
        "use_doc_orientation_classify": False,
        "use_doc_unwarping": False,
        "use_textline_orientation": False,
    }
    if use_gpu:
        try:
            return PaddleOCR(**kwargs, device=os.environ.get("OCR_DEVICE", "gpu:0"))
        except TypeError:
            return PaddleOCR(**kwargs, use_gpu=True)
    try:
        return PaddleOCR(**kwargs, device="cpu")
    except TypeError:
        return PaddleOCR(**kwargs, use_gpu=False)


def get_ocr():
    global _ocr, _ocr_device
    if _ocr is None:
        wants_gpu = is_gpu_requested() and not is_gpu_forced_off()
        can_try_gpu = wants_gpu and paddle_cuda_available()
        if can_try_gpu:
            try:
                _ocr = init_paddle_ocr(use_gpu=True)
                _ocr_device = "gpu"
                print("PaddleOCR initialized with GPU")
                return _ocr
            except Exception as error:
                print(f"PaddleOCR GPU init failed; falling back to CPU: {error}")
        else:
            reason = "disabled by OCR_USE_GPU" if is_gpu_forced_off() else "CUDA/Paddle GPU not available"
            print(f"PaddleOCR GPU not used: {reason}")
        _ocr = init_paddle_ocr(use_gpu=False)
        _ocr_device = "cpu"
        print("PaddleOCR initialized with CPU")
    return _ocr


def to_plain(value):
    if hasattr(value, "tolist"):
        return value.tolist()
    if isinstance(value, dict):
        return {key: to_plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_plain(item) for item in value]
    try:
        json.dumps(value)
        return value
    except TypeError:
        return str(value)


def box_from_poly(poly, fallback=None):
    if not poly and fallback:
        poly = [
            [fallback[0], fallback[1]],
            [fallback[2], fallback[1]],
            [fallback[2], fallback[3]],
            [fallback[0], fallback[3]],
        ]
    points = to_plain(poly or [])
    if not points:
        return [], {"x": 0, "y": 0, "width": 0, "height": 0}
    xs = [float(point[0]) for point in points]
    ys = [float(point[1]) for point in points]
    x1, x2 = min(xs), max(xs)
    y1, y2 = min(ys), max(ys)
    return points, {
        "x": round(x1, 2),
        "y": round(y1, 2),
        "width": round(x2 - x1, 2),
        "height": round(y2 - y1, 2),
    }


def image_paths_for_file(path):
    if path.suffix.lower() != ".pdf":
        return [path], []

    import pypdfium2 as pdfium

    generated = []
    pdf = pdfium.PdfDocument(str(path))
    for page_index in range(len(pdf)):
        page = pdf[page_index]
        image = page.render(scale=2).to_pil()
        out_path = Path(tempfile.mkstemp(suffix=f"-page-{page_index + 1}.png")[1])
        image.save(out_path)
        generated.append(out_path)
    return generated, generated


def normalize_page(result, page_index, source_name):
    raw = result.json["res"] if hasattr(result, "json") else result.get("res", result)
    raw = to_plain(raw)
    texts = raw.get("rec_texts") or []
    scores = raw.get("rec_scores") or []
    polys = raw.get("rec_polys") or raw.get("dt_polys") or []
    boxes = raw.get("rec_boxes") or []
    blocks = []

    for index, text in enumerate(texts):
        clean_text = str(text).strip()
        if not clean_text:
            continue
        poly, box = box_from_poly(
            polys[index] if index < len(polys) else None,
            boxes[index] if index < len(boxes) else None,
        )
        blocks.append(
            {
                "id": f"p{page_index + 1}-b{len(blocks) + 1}",
                "page": page_index + 1,
                "line": len(blocks) + 1,
                "text": clean_text,
                "confidence": round(float(scores[index]), 4) if index < len(scores) else None,
                "bbox": poly,
                "box": box,
                "source_type": "ocr_line",
            }
        )

    return {
        "page": page_index + 1,
        "source_name": source_name,
        "blocks": blocks,
    }


def layout_text(blocks):
    lines = []
    last_page = None
    for block in sorted(blocks, key=lambda item: (item["page"], item["box"]["y"], item["box"]["x"])):
        if block["page"] != last_page:
            if lines:
                lines.append("")
            lines.append(f"[page {block['page']}]")
            last_page = block["page"]
        box = block["box"]
        lines.append(f"({int(box['x'])},{int(box['y'])}) {block['text']}")
    return "\n".join(lines).strip()


def run_paddle_ocr(path, source_name):
    ocr = get_ocr()
    image_paths, generated_paths = image_paths_for_file(path)
    pages = []
    try:
        for page_index, image_path in enumerate(image_paths):
            for result in ocr.predict(str(image_path)):
                pages.append(normalize_page(result, page_index, source_name))
    finally:
        for generated_path in generated_paths:
            try:
                generated_path.unlink(missing_ok=True)
            except OSError:
                pass

    blocks = [block for page in pages for block in page["blocks"]]
    return {
        "engine": "PaddleOCR",
        "language": ocr_language(),
        "device": _ocr_device,
        "source_name": source_name,
        "page_count": len(pages),
        "block_count": len(blocks),
        "text": "\n".join(block["text"] for block in blocks),
        "layout_text": layout_text(blocks),
        "pages": pages,
        "blocks": blocks,
    }

import re
from functools import lru_cache


def _import_ocr_dependencies():
    try:
        import cv2
        import easyocr
        import numpy as np
    except ImportError as exc:
        raise RuntimeError(
            "OCR dependencies are missing. Install easyocr, opencv-python-headless, and numpy."
        ) from exc
    return cv2, easyocr, np


@lru_cache(maxsize=1)
def _get_reader():
    _, easyocr, _ = _import_ocr_dependencies()
    return easyocr.Reader(["en"], gpu=False)


def _build_variants(cv2, image):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    enlarged = cv2.resize(gray, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    blur = cv2.GaussianBlur(enlarged, (5, 5), 0)
    adaptive = cv2.adaptiveThreshold(
        blur,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        2,
    )
    otsu = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    return [gray, enlarged, adaptive, otsu]


def extract_reading_from_image_bytes(image_bytes: bytes) -> tuple[float, str]:
    cv2, _, np = _import_ocr_dependencies()

    image_array = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Unable to decode image.")

    reader = _get_reader()
    variants = _build_variants(cv2, image)

    all_text_chunks: list[str] = []
    candidates: list[tuple[float, float, str]] = []
    for variant in variants:
        results = reader.readtext(
            variant,
            detail=1,
            paragraph=False,
            allowlist="0123456789.,",
        )
        for _, text, confidence in results:
            if not text:
                continue
            all_text_chunks.append(str(text))
            for match in re.findall(r"\d+(?:[.,]\d+)?", str(text)):
                normalized = match.replace(",", ".")
                try:
                    value = float(normalized)
                except ValueError:
                    continue
                digit_count = len(re.sub(r"[^\d]", "", normalized))
                if digit_count < 3:
                    continue
                integer_bonus = 1.0 if "." not in normalized else 0.0
                score = digit_count * 2.0 + float(confidence) + integer_bonus
                candidates.append((score, value, normalized))

    extracted_text = " ".join(all_text_chunks).strip()

    if not candidates:
        raise ValueError("No numeric meter reading found in image.")

    candidates.sort(key=lambda item: item[0], reverse=True)
    reading_value = candidates[0][1]
    return reading_value, extracted_text

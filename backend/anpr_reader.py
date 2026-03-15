from __future__ import annotations

import base64
import re
import time
from datetime import datetime, timezone
from typing import Any

import cv2
import easyocr

try:
    from groq import Groq
except Exception:  # pragma: no cover - allows runtime without Groq client
    Groq = None


class ANPRReader:
    def __init__(self) -> None:
        try:
            self.reader = easyocr.Reader(["en"], gpu=True)
            self._log("EasyOCR initialized with GPU acceleration")
        except Exception as gpu_err:
            self._log(
                f"EasyOCR GPU init failed ({gpu_err}). "
                "Falling back to CPU — OCR will be slower but functional."
            )
            try:
                self.reader = easyocr.Reader(["en"], gpu=False)
                self._log("EasyOCR initialized on CPU (fallback)")
            except Exception as cpu_err:
                self._log(f"EasyOCR CPU init also failed: {cpu_err}. ANPR disabled.")
                self.reader = None

        self.groq_client = None
        if Groq is not None:
            try:
                self.groq_client = Groq()
            except Exception as exc:
                self._log(f"groq client init failed: {exc}")

        # Indian plate pattern: XX00X(X)0000, e.g. TS09EA4521, MH02AB1234, KA01MG2341
        self.indian_plate_pattern = re.compile(r"^[A-Z]{2}[0-9]{2}[A-Z]{1,2}[0-9]{4}$")

        # plate -> {timestamp, location}
        self.plates_seen: dict[str, dict[str, Any]] = {}

    def _log(self, message: str) -> None:
        ts = datetime.now(timezone.utc).isoformat()
        print(f"[{ts}] [anpr] {message}")

    def clean_plate_text(self, text: str) -> str:
        if not text:
            return ""
        return re.sub(r"[^A-Za-z0-9]", "", text).upper()

    def validate_indian_plate(self, text: str) -> bool:
        return bool(self.indian_plate_pattern.match(text or ""))

    def _normalize_bbox(self, frame: Any, vehicle_bbox: Any) -> tuple[int, int, int, int] | None:
        if frame is None or not hasattr(frame, "shape"):
            return None

        try:
            if isinstance(vehicle_bbox, dict):
                x1 = int(vehicle_bbox.get("x1", vehicle_bbox.get("x", 0)))
                y1 = int(vehicle_bbox.get("y1", vehicle_bbox.get("y", 0)))
                x2 = int(vehicle_bbox.get("x2", x1 + vehicle_bbox.get("w", 0)))
                y2 = int(vehicle_bbox.get("y2", y1 + vehicle_bbox.get("h", 0)))
            else:
                x1, y1, x2, y2 = [int(v) for v in vehicle_bbox]
        except Exception:
            return None

        h, w = frame.shape[:2]
        x1 = max(0, min(x1, w - 1))
        y1 = max(0, min(y1, h - 1))
        x2 = max(1, min(x2, w))
        y2 = max(1, min(y2, h))

        if x2 <= x1 or y2 <= y1:
            return None

        return x1, y1, x2, y2

    def _extract_plate_region(self, frame: Any, vehicle_bbox: Any) -> Any:
        norm = self._normalize_bbox(frame, vehicle_bbox)
        if norm is None:
            return None

        x1, y1, x2, y2 = norm
        box_h = y2 - y1
        box_w = x2 - x1

        # Bottom 35% of vehicle bbox with slight padding.
        plate_y1 = y2 - int(box_h * 0.35)
        plate_y2 = y2

        pad_x = int(box_w * 0.06)
        pad_y = int(box_h * 0.03)

        frame_h, frame_w = frame.shape[:2]
        crop_x1 = max(0, x1 - pad_x)
        crop_x2 = min(frame_w, x2 + pad_x)
        crop_y1 = max(0, plate_y1 - pad_y)
        crop_y2 = min(frame_h, plate_y2 + pad_y)

        if crop_x2 <= crop_x1 or crop_y2 <= crop_y1:
            return None

        plate_crop = frame[crop_y1:crop_y2, crop_x1:crop_x2]
        if plate_crop is None or plate_crop.size == 0:
            return None

        return plate_crop

    def _preprocess_plate_image(self, plate_image: Any) -> Any:
        gray = cv2.cvtColor(plate_image, cv2.COLOR_BGR2GRAY)
        thresh = cv2.adaptiveThreshold(
            gray,
            255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            21,
            7,
        )

        h, w = thresh.shape[:2]
        if h < 200:
            scale = 200.0 / max(1, h)
            thresh = cv2.resize(thresh, (int(w * scale), 200), interpolation=cv2.INTER_CUBIC)

        return thresh

    def _fix_common_ocr_errors(self, text: str) -> list[str]:
        # Generate candidate corrections for common OCR confusions.
        swaps = {"0": "O", "O": "0", "1": "I", "I": "1"}
        candidates = {text}

        chars = list(text)
        for idx, ch in enumerate(chars):
            if ch in swaps:
                alt = chars.copy()
                alt[idx] = swaps[ch]
                candidates.add("".join(alt))

        # Also attempt targeted fixes by expected segment type.
        if len(text) >= 10:
            c = list(text)
            # State code letters
            for i in [0, 1, 4, 5]:
                if i < len(c) and c[i] == "0":
                    c[i] = "O"
                if i < len(c) and c[i] == "1":
                    c[i] = "I"
            # Digits
            for i in [2, 3, 6, 7, 8, 9]:
                if i < len(c) and c[i] == "O":
                    c[i] = "0"
                if i < len(c) and c[i] == "I":
                    c[i] = "1"
            candidates.add("".join(c))

        return list(candidates)

    def _update_plate_history(self, plate: str, location: str) -> None:
        self.plates_seen[plate] = {
            "timestamp": time.time(),
            "location": location,
            "seen_at": datetime.now(timezone.utc).isoformat(),
        }

    def read_plate(self, frame: Any, vehicle_bbox: Any, location: str = "unknown") -> str | None:
        if self.reader is None:
            return None  # ANPR disabled due to EasyOCR init failure

        plate_region = self._extract_plate_region(frame, vehicle_bbox)
        if plate_region is None:
            return None

        preprocessed = self._preprocess_plate_image(plate_region)

        try:
            results = self.reader.readtext(preprocessed)
        except Exception as exc:
            self._log(f"easyocr error: {exc}")
            results = []

        best_text = None
        best_conf = 0.0

        for item in results:
            try:
                _, text, conf = item
                if float(conf) > best_conf:
                    best_conf = float(conf)
                    best_text = str(text)
            except Exception:
                continue

        if best_text is not None and best_conf >= 0.7:
            cleaned = self.clean_plate_text(best_text)
            if self.validate_indian_plate(cleaned):
                self._update_plate_history(cleaned, location)
                return cleaned

            for candidate in self._fix_common_ocr_errors(cleaned):
                if self.validate_indian_plate(candidate):
                    self._update_plate_history(candidate, location)
                    return candidate
        else:
            self._log("easyocr low confidence or no result, trying groq fallback")

        fallback = self.groq_fallback(plate_region)
        if fallback:
            self._update_plate_history(fallback, location)
        return fallback

    def groq_fallback(self, plate_image: Any) -> str | None:
        if self.groq_client is None:
            return None

        try:
            ok, buffer = cv2.imencode(".jpg", plate_image, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
            if not ok:
                return None
            b64 = base64.b64encode(buffer).decode("utf-8")

            prompt = (
                "This is a cropped image of a vehicle number plate from an Indian road. "
                "Read the number plate text exactly as it appears. Return only the plate "
                "number in this format: XX00XX0000 where X is a letter and 0 is a digit. "
                "Return nothing else."
            )

            response = self.groq_client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
                            },
                        ],
                    }
                ],
                temperature=0.0,
            )

            text = ""
            if response and response.choices:
                text = str(response.choices[0].message.content or "")

            cleaned = self.clean_plate_text(text)
            if self.validate_indian_plate(cleaned):
                return cleaned

            for candidate in self._fix_common_ocr_errors(cleaned):
                if self.validate_indian_plate(candidate):
                    return candidate

            return None
        except Exception as exc:
            self._log(f"groq fallback failed: {exc}")
            return None

    def get_recent_plates(self, seconds: int = 60) -> dict[str, dict[str, Any]]:
        cutoff = time.time() - max(1, int(seconds))
        return {
            plate: details
            for plate, details in self.plates_seen.items()
            if float(details.get("timestamp", 0)) >= cutoff
        }

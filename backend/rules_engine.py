from __future__ import annotations

import base64
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Any

import cv2


AUTHORITY_MAPPING: dict[str, list[str]] = {
    "Road Accident Detection": ["hospital", "police"],
    "Medical Emergency Detection": ["hospital"],
    "Distress & Assault Detection": ["police"],
    "Stampede Prediction": ["police", "municipal"],
    "Kidnapping & Loitering": ["police"],
    "Illegal Dumping Detection": ["municipal"],
    "Reckless Driving": ["traffic"],
    "Early Fire Detection": ["fire", "police"],
    # New incident types from YouTube Groq Vision
    "SHOOTING": ["police"],
    "ROBBERY": ["police"],
    "WEAPON_DETECTED": ["police"],
    "DRUG_ACTIVITY": ["police"],
    "SEATBELT_VIOLATION": ["traffic"],
    "HELMET_VIOLATION": ["traffic"],
    "VANDALISM": ["police", "municipal"],
}

FEATURE_IDS = {
    "Distress & Assault Detection": "feat-1",
    "Road Accident Detection": "feat-2",
    "Medical Emergency Detection": "feat-3",
    "Stampede Prediction": "feat-4",
    "Kidnapping & Loitering": "feat-5",
    "Illegal Dumping Detection": "feat-6",
    "Reckless Driving": "feat-7",
    "Early Fire Detection": "feat-8",
}


class RulesEngine:
    def __init__(self, database: Any, alert_system: Any) -> None:
        self.database = database
        self.alert_system = alert_system

        self.minimum_severity_threshold = 4
        
        # Layer 1: Per-feature cooldowns (in seconds)
        self.feature_last_alert: dict[str, float] = {}
        self.cooldown_seconds = {
            "Distress & Assault Detection": 300,    # 5 mins
            "Road Accident Detection": 300,       # 5 mins
            "Medical Emergency Detection": 300,   # 5 mins
            "Stampede Prediction": 180,            # 3 mins
            "Kidnapping & Loitering": 300,        # 5 mins
            "Illegal Dumping Detection": 600,     # 10 mins
            "Reckless Driving": 300,              # 5 mins
            "Early Fire Detection": 120           # 2 mins
        }

        # Layer 2: Confirmation frames tracking
        self.confirmation_counters: dict[str, int] = {}
        self.required_frames = {
            "Distress & Assault Detection": 45,     # ~1.5s @ 30fps
            "Road Accident Detection": 10,
            "Medical Emergency Detection": 150,    # 5s
            "Stampede Prediction": 30,
            "Kidnapping & Loitering": 300,         # 10s
            "Illegal Dumping Detection": 60,
            "Reckless Driving": 20,
            "Early Fire Detection": 5              # Fire is urgent
        }

        self.feature_settings: dict[str, dict[str, Any]] = {}
        self.channel_settings = {
            "telegram": True,
            "sms": True,
            "email": True,
        }

        # Key format: feature_name:location or stampede_warning/location specific suffixes.
        self.recent_alerts: dict[str, float] = {}

        # Global rate limiter: max 10 alerts per 60 seconds.
        self.global_alert_times: deque[float] = deque(maxlen=120)

        self.reload_preferences()

    def _log(self, message: str) -> None:
        ts = datetime.now(timezone.utc).isoformat()
        print(f"[{ts}] [rules] {message}")

    def _now_ts(self) -> float:
        return datetime.now(timezone.utc).timestamp()

    def _now_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _feature_enabled(self, feature_name: str) -> bool:
        setting = self.feature_settings.get(feature_name, {})
        return bool(setting.get("is_enabled", True))

    def _feature_threshold(self, feature_name: str) -> int:
        setting = self.feature_settings.get(feature_name, {})
        override = setting.get("severity_override")
        if override is None:
            return int(self.minimum_severity_threshold)
        try:
            return int(override)
        except Exception:
            return int(self.minimum_severity_threshold)

    def _global_rate_limited(self) -> bool:
        now = self._now_ts()
        while self.global_alert_times and now - self.global_alert_times[0] > 60:
            self.global_alert_times.popleft()
        return len(self.global_alert_times) >= 10

    def _register_global_alert(self) -> None:
        self.global_alert_times.append(self._now_ts())

    def _encode_frame_base64(self, frame: Any) -> str | None:
        if frame is None:
            return None
        try:
            ok, buffer = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
            if not ok:
                return None
            return base64.b64encode(buffer).decode("utf-8")
        except Exception as exc:
            self._log(f"frame encode failed: {exc}")
            return None

    def _resolve_feature_name(self, detection_data: dict[str, Any]) -> str:
        return str(
            detection_data.get("feature_name")
            or detection_data.get("incident_type")
            or "Unknown Feature"
        )

    def _derive_stampede_level(self, detection_data: dict[str, Any]) -> str | None:
        # Supports either explicit level or severity/risk inference.
        if self._resolve_feature_name(detection_data) != "Stampede Prediction":
            return None

        explicit = str(detection_data.get("stampede_level", "")).strip().upper()
        if explicit in {"WARNING", "DANGER"}:
            return explicit

        severity = int(detection_data.get("severity_score", 0) or 0)
        risk_score = float(detection_data.get("risk_score", 0.0) or 0.0)

        if severity >= 9 or risk_score >= 0.9:
            return "DANGER"
        if severity >= 6 or risk_score >= 0.7:
            return "WARNING"
        return None

    def reload_preferences(self) -> None:
        try:
            prefs = self.database.get_preferences() if self.database else None
            if not prefs:
                self._log("preferences missing, using defaults")
                return

            # Supports both DB schema and API schema naming.
            self.minimum_severity_threshold = int(
                prefs.get("min_severity", prefs.get("minimum_severity_threshold", 4))
            )
            self.duplicate_cooldown_seconds = int(
                prefs.get("duplicate_cooldown", prefs.get("duplicate_alert_cooldown_seconds", 30))
            )

            if "channels" in prefs and isinstance(prefs["channels"], dict):
                self.channel_settings = {
                    "telegram": bool(prefs["channels"].get("telegram", True)),
                    "sms": bool(prefs["channels"].get("sms", prefs["channels"].get("whatsapp", True))),
                    "email": bool(prefs["channels"].get("email", True)),
                }
            else:
                self.channel_settings = {
                    "telegram": bool(prefs.get("telegram_enabled", True)),
                    "sms": bool(prefs.get("whatsapp_enabled", True)),
                    "email": bool(prefs.get("email_enabled", True)),
                }

            raw_features = prefs.get("feature_settings", prefs.get("features", []))
            parsed: dict[str, dict[str, Any]] = {}
            if isinstance(raw_features, list):
                for item in raw_features:
                    fname = item.get("feature_name")
                    fid = item.get("feature_id")
                    if not fname and fid:
                        fname = next((name for name, f_id in FEATURE_IDS.items() if f_id == fid), None)
                    if not fname:
                        continue
                    parsed[str(fname)] = {
                        "is_enabled": bool(item.get("is_enabled", True)),
                        "severity_override": item.get("severity_override"),
                    }

            if parsed:
                self.feature_settings = parsed

            self._log(
                f"preferences reloaded: threshold={self.minimum_severity_threshold}, "
                f"cooldown={self.duplicate_cooldown_seconds}s"
            )
        except Exception as exc:
            self._log(f"reload_preferences failed: {exc}")

    def process_detections(self, detection_results: dict[str, Any], camera_info: dict[str, Any]) -> list[dict[str, Any]]:
        output_alerts: list[dict[str, Any]] = []
        if not detection_results:
            return output_alerts

        feature_candidates = detection_results.get("features_status", {})
        
        # Process alerts generated by the detector (pre-verified by detector logic)
        detector_alerts = detection_results.get("alerts", []) or []
        for candidate in detector_alerts:
            feature_name = self._resolve_feature_name(candidate)
            
            # Layer 2: Confirmation counter
            current = self.confirmation_counters.get(feature_name, 0) + 1
            self.confirmation_counters[feature_name] = current
            
            required = self.required_frames.get(feature_name, 30)
            if current < required:
                continue
                
            # Reset counter on successful trigger (will start again for next alert after cooldown)
            self.confirmation_counters[feature_name] = 0

            alert = self.evaluate_alert(
                feature_name=feature_name,
                detection_data=candidate,
                camera_info=camera_info,
                annotated_frame=detection_results.get("annotated_frame"),
            )
            if alert:
                output_alerts.append(alert)

        # Reset counters for features not currently triggering
        active_features = {self._resolve_feature_name(a) for a in detector_alerts}
        for f_name in self.required_frames.keys():
            if f_name not in active_features:
                self.confirmation_counters[f_name] = 0

        return output_alerts

    def evaluate_alert(
        self,
        feature_name: str,
        detection_data: dict[str, Any],
        camera_info: dict[str, Any],
        annotated_frame: Any = None,
    ) -> dict[str, Any] | None:
        # Rule 1 - feature enabled check.
        if not self._feature_enabled(feature_name):
            return None

        # Rule 2 - severity threshold check (with stampede special handling).
        stampede_level = self._derive_stampede_level(detection_data)
        severity = int(detection_data.get("groq_severity", detection_data.get("severity_score", 0)) or 0)

        incident_type = str(detection_data.get("incident_type", feature_name))
        if feature_name == "Stampede Prediction" and stampede_level is not None:
            if stampede_level == "WARNING":
                incident_type = "Stampede Warning - Prediction"
                severity = max(severity, 6)
            elif stampede_level == "DANGER":
                incident_type = "Stampede Danger - Imminent"
                severity = max(severity, 9)
        elif feature_name == "SHOOTING":
            severity = max(severity, 10)
        elif feature_name in ("ROBBERY", "WEAPON_DETECTED"):
            severity = max(severity, 9)
        elif feature_name == "DRUG_ACTIVITY":
            severity = max(severity, 7)
        elif feature_name == "VANDALISM":
            severity = max(severity, 4)
        elif feature_name in ("SEATBELT_VIOLATION", "HELMET_VIOLATION"):
            severity = max(severity, 3)
        else:
            threshold = self._feature_threshold(feature_name)
            if severity < threshold:
                return None

        # Rule 3 - duplicate prevention and global rate limiting.
        # Rule 3 - Layer 1: Per-feature cooldown check
        last_alert = self.feature_last_alert.get(feature_name, 0)
        cooldown = self.cooldown_seconds.get(feature_name, 300)
        if now - last_alert < cooldown:
            return None

        # Global rate limiter check
        if self._global_rate_limited():
            self._log("global alert rate limit hit (10/min), dropping alert")
            return None

        self.feature_last_alert[feature_name] = now

        # Rule 4 - create alert object.
        screenshot_b64 = (
            detection_data.get("screenshot")
            or self._encode_frame_base64(annotated_frame)
            or ""
        )

        # Rule 5 - nearest authorities lookup.
        authority_types = AUTHORITY_MAPPING.get(feature_name, ["police"])
        nearest_details = []
        authority_names: list[str] = []
        try:
            if self.alert_system and hasattr(self.alert_system, "find_nearest"):
                nearest_details = self.alert_system.find_nearest(
                    latitude=float(camera_info.get("latitude", 0.0)),
                    longitude=float(camera_info.get("longitude", 0.0)),
                    authority_types=authority_types,
                )
            if isinstance(nearest_details, list):
                for item in nearest_details:
                    if isinstance(item, dict):
                        authority_names.append(str(item.get("name", item.get("authority_name", "Unknown Authority"))))
            authority_names = [x for x in authority_names if x]
        except Exception as exc:
            self._log(f"find_nearest failed: {exc}")
            authority_names = []

        if not authority_names:
            authority_names = [f"{a_type.title()} Network" for a_type in authority_types]

        alert_object: dict[str, Any] = {
            "id": str(uuid.uuid4()),
            "incident_type": incident_type,
            "feature_name": feature_name,
            "location": location_name,
            "camera_id": str(camera_info.get("id", "")),
            "camera_name": str(camera_info.get("name", "")),
            "camera_latitude": float(camera_info.get("latitude", 0.0)),
            "camera_longitude": float(camera_info.get("longitude", 0.0)),
            "severity_score": severity,
            "groq_description": str(
                detection_data.get("groq_description", detection_data.get("description", f"{feature_name} triggered"))
            ),
            "authority_alerted": authority_names,
            "vehicle_plates": detection_data.get("vehicle_plates", []) or [],
            "screenshot": screenshot_b64,
            "timestamp": self._now_iso(),
            "crowd_density": detection_data.get("crowd_density"),
            "escape_direction": detection_data.get("escape_direction"),
            "alert_channels": {
                "telegram": "pending" if self.channel_settings.get("telegram", True) else "disabled",
                "sms": "pending" if self.channel_settings.get("sms", True) else "disabled",
                "email": "pending" if self.channel_settings.get("email", True) else "disabled",
                "erss_112": "pending",
            },
        }

        # Rule 6 - send alert.
        try:
            if self.alert_system and hasattr(self.alert_system, "send_alert"):
                send_result = self.alert_system.send_alert(alert_object)
                if isinstance(send_result, dict):
                    for channel in ["telegram", "sms", "email", "erss_112"]:
                        if channel in send_result:
                            alert_object["alert_channels"][channel] = send_result[channel]
            self._register_global_alert()
        except Exception as exc:
            self._log(f"send_alert failed: {exc}")
            for channel in ["telegram", "sms", "email", "erss_112"]:
                if alert_object["alert_channels"][channel] == "pending":
                    alert_object["alert_channels"][channel] = "failed"

        # Rule 7 - save to database.
        try:
            if self.database:
                self.database.save_incident(alert_object)
        except Exception as exc:
            self._log(f"database.save_incident failed: {exc}")

        # Rule 8 - return complete alert object.
        return alert_object

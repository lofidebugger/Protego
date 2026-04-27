from __future__ import annotations

# ── load .env FIRST – before any import that reads env vars ──────────────────
import pathlib as _pathlib
from dotenv import load_dotenv
_here = _pathlib.Path(__file__).parent
# Try backend/.env first, then project root/.env
load_dotenv(_here / ".env") or load_dotenv(_here.parent / ".env")
# ─────────────────────────────────────────────────────────────────────────────

import csv
import io
import os
import subprocess
import time
import threading
import tempfile
import uuid
import random
import string
from datetime import datetime, timezone
from typing import Any
import base64
import numpy as np
from werkzeug.utils import secure_filename

import cv2
import requests
from flask import Flask, Response, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO

from alert_system import AlertSystem
from camera_manager import CameraManager
from database import Database
from detector import Detector
from rules_engine import RulesEngine


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _log(message: str) -> None:
    print(f"[{_utc_now()}] [server] {message}")


def ok(data: Any, status_code: int = 200):
    return jsonify({"success": True, "data": data}), status_code


def err(message: str, status_code: int = 500):
    return jsonify({"success": False, "error": message}), status_code


# Standard threading mode for maximum compatibility without eventlet dependencies
async_mode = "threading"

app = Flask(__name__)
CORS(
    app,
    resources={r"/*": {"origins": "*"}},
    supports_credentials=True,
)
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode=async_mode,
    logger=False,
    engineio_logger=False,
    ping_timeout=60,
    ping_interval=25,
)

# Core modules
_db = Database()
_alert_system = AlertSystem(database=_db)
_detector = Detector(settings_provider=_db)
_rules = RulesEngine(database=_db, alert_system=_alert_system)


latest_system_state: dict[str, Any] = {
    "gemini_analysis": None,
    "detections": [],
    "latest_alert": None,
    "camera_status": "disconnected",
    "timestamp": 0
}
state_lock = threading.Lock()


COLOR_BY_DRAW_TYPE = {
    "distress": "#e63946",
    "accident": "#f4a261",
    "medical": "#e76f51",
    "stampede": "#e9c46a",
    "loitering": "#264653",
    "dumping": "#2a9d8f",
    "reckless": "#f4a261",
    "fire": "#e63946",
    "person": "#4cc9f0",
    "vehicle": "#7209b7",
}

MODEL_NAME_BY_FEATURE = {
    "feat-1": "MediaPipe Hands + Pose + Gemini 2.5 Flash",
    "feat-2": "YOLOv8 + DeepSort + ANPR + Gemini 2.5 Flash",
    "feat-3": "MediaPipe Pose + DeepSort + Gemini 2.5 Flash",
    "feat-4": "YOLOv8 + Crowd Motion Heuristics",
    "feat-5": "DeepSort + ANPR + Gemini 2.5 Flash",
    "feat-6": "YOLOv8 + DeepSort + ANPR + Gemini 2.5 Flash",
    "feat-7": "YOLOv8 + DeepSort + ANPR + Gemini 2.5 Flash",
    "feat-8": "YOLOv8 Fire Detection + Gemini 2.5 Flash",
}


def _camera_status_callback(status: dict[str, Any]) -> None:
    payload = {
        "status": "connected" if status.get("is_connected") else "disconnected",
        "camera_name": status.get("camera_name"),
        "source_type": status.get("source_type"),
    }
    with state_lock:
        latest_system_state["camera_status"] = payload
    socketio.emit("camera_status", payload)


_camera = CameraManager(status_callback=_camera_status_callback)

_runtime = {
    "last_processing_fps": 0.0,
    "detection_loop_running": False,
    "feature_loop_running": False,
    "gemini_vision_loop_running": False,
}

latest_gemini_result: dict[str, Any] | None = None
gemini_vision_running = False
gemini_vision_lock = threading.Lock()

_active_location = {
    "mode": "manual",
    "location_name": "Unknown",
    "latitude": 0.0,
    "longitude": 0.0,
    "source_type": "webcam",
    "updated_at": _utc_now(),
}

_startup_time = time.time()


# Removed IP based location detection as requested.
# Now strictly using Browser GPS via /api/location/update.


def _set_active_location(location_name: str, latitude: float, longitude: float, mode: str, source_type: str) -> None:
    _active_location["mode"] = mode
    _active_location["location_name"] = location_name
    _active_location["latitude"] = float(latitude)
    _active_location["longitude"] = float(longitude)
    _active_location["source_type"] = source_type
    _active_location["updated_at"] = _utc_now()


def _telegram_polling_thread():
    """Background listener for /start <code> messages to link judge's Telegram chat ID."""
    _log("Starting Telegram registration listener...")
    last_update_id = 0
    while True:
        try:
            if not _alert_system.telegram_token:
                time.sleep(10)
                continue
                
            url = f"https://api.telegram.org/bot{_alert_system.telegram_token}/getUpdates"
            params = {"offset": last_update_id + 1, "timeout": 30}
            resp = requests.get(url, params=params, timeout=35)
            if resp.status_code == 200:
                data = resp.json()
                for update in data.get("result", []):
                    last_update_id = update["update_id"]
                    message = update.get("message", {})
                    text = str(message.get("text", "")).strip()
                    chat_id = message.get("chat", {}).get("id")
                    
                    if text.startswith("/start"):
                        parts = text.split()
                        if len(parts) > 1:
                            code = parts[1]
                            if str(_alert_system.session_telegram_code) == str(code):
                                _alert_system.session_telegram_chat_id = str(chat_id)
                                _log(f"Telegram registered successfully for chat_id: {chat_id}")
                                # Send confirmation
                                confirm_url = f"https://api.telegram.org/bot{_alert_system.telegram_token}/sendMessage"
                                requests.post(confirm_url, json={
                                    "chat_id": chat_id,
                                    "text": "✅ Protego Safety Dashboard connected! You will now receive critical alerts, AI descriptions, and voice notes here."
                                }, timeout=5)
                                # Emit to frontend
                                socketio.emit("telegram_registered", {"status": "connected", "chat_id": chat_id})
        except Exception as e:
            # Silent fail for network issues to avoid log spam
            pass
        time.sleep(2)


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _normalize_detection_for_frontend(det: dict[str, Any]) -> dict[str, Any]:
    bbox = det.get("bbox") or [0, 0, 0, 0]
    if len(bbox) != 4:
        bbox = [0, 0, 0, 0]

    x1, y1, x2, y2 = [_safe_int(v) for v in bbox]
    return {
        "label": det.get("label", "unknown"),
        "confidence": float(det.get("confidence", 0.0)),
        "bbox": [x1, y1, max(0, x2 - x1), max(0, y2 - y1)],
        "detection_type": det.get("draw_type", det.get("category", "other")),
        "color": COLOR_BY_DRAW_TYPE.get(det.get("draw_type", det.get("category", "other")), "#94a3b8"),
    }


def _build_camera_info() -> dict[str, Any]:
    status = _camera.get_status()
    active_camera = None
    cameras = _db.get_cameras()
    for cam in cameras:
        if cam.get("is_active"):
            active_camera = cam
            break

    if active_camera is None and cameras:
        active_camera = cameras[0]

    return {
        "id": str(active_camera.get("id", "")) if active_camera else "",
        "name": str(active_camera.get("name", status.get("camera_name", "Camera"))) if active_camera else str(status.get("camera_name", "Camera")),
        "location_name": str(_active_location.get("location_name", "Unknown")),
        "latitude": _safe_float(_active_location.get("latitude", 0.0)),
        "longitude": _safe_float(_active_location.get("longitude", 0.0)),
        "source_type": status.get("source_type"),
    }


def detection_loop() -> None:
    _runtime["detection_loop_running"] = True
    _log("detection loop started")

    while True:
        frame = _camera.get_frame()
        if frame is None:
            socketio.sleep(0.03)
            continue

        try:
            results = _detector.process_frame(frame, source_type=_camera.source_type)
            if not isinstance(results, dict):
                results = {
                    "annotated_frame": results,
                    "detections": [],
                    "alerts": [],
                    "gemini_analysis": None,
                    "gemini_alerts": [],
                    "features_status": _detector.get_features_status(),
                    "processing_fps": 0.0,
                }
            _runtime["last_processing_fps"] = float(results.get("processing_fps", 0.0))

            annotated = results.get("annotated_frame")
            if annotated is not None:
                b64 = _camera.get_frame_base64() if annotated is frame else _detector._frame_to_base64(annotated)
                if b64:
                    socketio.emit("frame", {"frame": b64})

            detections = results.get("detections", []) or []
            normalized = [_normalize_detection_for_frontend(d) for d in detections]
            with state_lock:
                latest_system_state["detections"] = normalized
            # socketio.emit(
            #     "detections",
            #     {"detections": normalized},
            # )

            gemini_analysis = results.get("gemini_analysis")
            if gemini_analysis:
                with state_lock:
                    latest_system_state["gemini_analysis"] = gemini_analysis
                    latest_system_state["timestamp"] = time.time()
                # socketio.emit("gemini_analysis", gemini_analysis)

            gemini_alerts = results.get("gemini_alerts", []) or []
            for gemini_alert in gemini_alerts:
                gemini_alert["location"] = _active_location.get("location_name", gemini_alert.get("location", "Unknown Location"))
                gemini_alert["camera_latitude"] = _active_location.get("latitude", 0.0)
                gemini_alert["camera_longitude"] = _active_location.get("longitude", 0.0)
                try:
                    send_result = _alert_system.send_alert(gemini_alert)
                    if isinstance(send_result, dict):
                        gemini_alert["alert_channels"]["telegram"] = send_result.get("telegram", gemini_alert["alert_channels"].get("telegram", "failed"))
                        gemini_alert["alert_channels"]["sms"] = send_result.get("whatsapp", gemini_alert["alert_channels"].get("sms", "failed"))
                        gemini_alert["alert_channels"]["email"] = send_result.get("email", gemini_alert["alert_channels"].get("email", "failed"))
                except Exception as exc:
                    _log(f"gemini alert notify failed: {exc}")
                socketio.emit("alert", gemini_alert)
                popup = gemini_alert.get("pending_popup")
                if popup:
                    socketio.emit("popup", popup)
                _log(f"gemini alert fired: {gemini_alert.get('incident_type')} @ {gemini_alert.get('location')}")

            camera_info = _build_camera_info()
            confirmed_alerts = _rules.process_detections(results, camera_info)
            for alert_obj in confirmed_alerts:
                with state_lock:
                    latest_system_state["latest_alert"] = alert_obj
                    latest_system_state["timestamp"] = time.time()
                # socketio.emit("alert", alert_obj)
                popup = alert_obj.get("pending_popup")
                if popup:
                    socketio.emit("popup", popup)
                _log(f"alert fired: {alert_obj.get('incident_type')} @ {alert_obj.get('location')}")

        except Exception as exc:
            _log(f"detection loop error: {exc}")

        socketio.sleep(0.033)


def send_all_alerts(incident: dict[str, Any], screenshot: str | None = None) -> None:
    try:
        payload = dict(incident)
        if screenshot is not None:
            payload["screenshot"] = screenshot
        sent = _alert_system.send_alert(payload)
        popup = sent.get("pending_popup") if isinstance(sent, dict) else None
        if popup:
            socketio.emit("popup", popup)
    except Exception as exc:
        _log(f"send_all_alerts failed: {exc}")


def handle_gemini_threat(threat: dict[str, Any], frame: Any, full_result: dict[str, Any]) -> None:
    try:
        import base64
        import cv2

        feature = str(threat.get("feature", "Unknown Threat"))
        severity = int(threat.get("severity", 7) or 7)
        confidence = float(threat.get("confidence", 0.8) or 0.8)
        description = str(threat.get("description", ""))
        action = str(threat.get("action", ""))

        if not hasattr(handle_gemini_threat, "_cooldowns"):
            handle_gemini_threat._cooldowns = {}

        now = time.time()
        last = handle_gemini_threat._cooldowns.get(feature, 0.0)
        if now - last < 300:
            return
        handle_gemini_threat._cooldowns[feature] = now

        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if not ok:
            return
        screenshot = base64.b64encode(buf).decode("utf-8")

        loc_str = str(_active_location.get("location_name", "Unknown Location"))
        lat = _safe_float(_active_location.get("latitude", 0.0))
        lon = _safe_float(_active_location.get("longitude", 0.0))

        frontend_alert = {
            "incident_type": feature,
            "severity": severity,
            "confidence": confidence,
            "description": description,
            "action": action,
            "location": loc_str,
            "detected_by": "Gemini 2.5 Flash",
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "screenshot": screenshot,
        }
        with state_lock:
            latest_system_state["latest_alert"] = frontend_alert
            latest_system_state["timestamp"] = time.time()
        # socketio.emit("new_alert", frontend_alert)

        # socketio.emit(
        #     "alert",
        #     {
        #         "id": f"gemini-yt-{int(now * 1000)}",
        #         "incident_type": feature,
        #         "feature_name": "Gemini 2.5 Flash",
        #         "location": loc_str,
        #         "severity_score": severity,
        #         "gemini_description": description or str(full_result.get("gemini_reasoning", "")),
        #         "authority_alerted": [],
        #         "vehicle_plates": [],
        #         "screenshot": screenshot,
        #         "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        #         "alert_channels": {"telegram": "failed", "sms": "failed", "email": "failed"},
        #     },
        # )



        _log(f"PROTEGO ALERT {feature} severity {severity}/10")

        nearby = _alert_system.get_nearby_authorities(lat, lon)
        incident = {
            "incident_type": feature,
            "feature_name": feature,
            "severity_score": severity,
            "confidence": confidence,
            "location": loc_str,
            "camera_latitude": lat,
            "camera_longitude": lon,
            "description": description,
            "gemini_description": description or str(full_result.get("gemini_reasoning", "")),
            "action": action,
            "recommended_action": action,
            "detected_by": "Gemini 2.5 Flash",
            "nearby_authorities": nearby,
            "screenshot": screenshot,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        }

        threading.Thread(target=send_all_alerts, args=(incident, screenshot), daemon=True).start()
    except Exception as e:
        _log(f"gemini-threat {e}")


def gemini_vision_loop() -> None:
    global gemini_vision_running
    global latest_gemini_result

    _runtime["gemini_vision_loop_running"] = True
    _log("Gemini Vision loop started for all sources")
    while True:
        try:
            cam_status = _camera.get_status()
            if not cam_status.get("is_connected", False):
                time.sleep(1)
                continue

            frame = _camera.get_frame()
            if frame is None:
                time.sleep(0.5)
                continue

            should_run = False
            with gemini_vision_lock:
                if not gemini_vision_running:
                    gemini_vision_running = True
                    should_run = True

            if not should_run:
                time.sleep(0.2)
                continue

            result = _detector.analyze_frame_with_fallback(frame)

            with gemini_vision_lock:
                gemini_vision_running = False

            if result is None:
                time.sleep(2)
                continue

            with gemini_vision_lock:
                latest_gemini_result = result

            with state_lock:
                latest_system_state["gemini_analysis"] = result
                latest_system_state["timestamp"] = time.time()
            # socketio.emit("gemini_analysis", result)

            threats = result.get("threats", [])
            for threat in threats:
                severity = float(threat.get("severity", 0) or 0)
                confidence = float(threat.get("confidence", 0) or 0)
                if severity >= 6 and confidence >= 0.65:
                    handle_gemini_threat(threat, frame, result)

            time.sleep(2)
        except Exception as e:
            _log(f"gemini-vision-loop {e}")
            with gemini_vision_lock:
                gemini_vision_running = False
            time.sleep(2)


def feature_update_loop() -> None:
    _runtime["feature_loop_running"] = True
    _log("feature update loop started")

    while True:
        try:
            statuses = _detector.get_features_status()
            payload = []
            for item in statuses:
                row = dict(item)
                row["model_name"] = MODEL_NAME_BY_FEATURE.get(row.get("feature_id"), "Hybrid AI")
                payload.append(row)
            socketio.emit("feature_update", payload)
        except Exception as exc:
            _log(f"feature update loop error: {exc}")
        socketio.sleep(2.0)


def ensure_background_tasks() -> None:
    if not _runtime["detection_loop_running"]:
        socketio.start_background_task(detection_loop)
    if not _runtime["feature_loop_running"]:
        socketio.start_background_task(feature_update_loop)
    if not _runtime["gemini_vision_loop_running"]:
        socketio.start_background_task(gemini_vision_loop)


@socketio.on("connect")
def on_connect():
    _log("frontend websocket connected")
    status = _camera.get_status()
    socketio.emit(
        "camera_status",
        {
            "status": "connected" if status.get("is_connected") else "disconnected",
            "camera_name": status.get("camera_name"),
            "source_type": status.get("source_type"),
        },
    )

@socketio.on("webrtc_frame")
def handle_webrtc_frame(data):
    if _camera.source_type != "webcam":
        return
    try:
        b64 = data.get("frame")
        if not b64:
            return
        # If it includes the data URI scheme, strip it
        if "base64," in b64:
            b64 = b64.split("base64,")[1]
            
        import base64
        import numpy as np
        
        img_data = base64.b64decode(b64)
        nparr = np.frombuffer(img_data, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if frame is not None:
            _camera.set_webrtc_frame(frame)
    except Exception as e:
        _log(f"webrtc frame decode error: {e}")

# Camera endpoints
@app.post("/api/camera/source")
def switch_camera_source():
    try:
        body = request.get_json(silent=True) or {}
        source_type = str(body.get("source_type", body.get("source", ""))).strip().lower()
        if source_type not in {"webcam", "ipcam", "youtube", "rtsp"}:
            return err("source_type must be one of webcam, ipcam, youtube, rtsp", 400)

        socketio.emit("camera_status", {"status": "connecting", "camera_name": "Switching", "source_type": source_type})

        kwargs: dict[str, Any] = {}
        if source_type == "ipcam":
            ip_addr = str(body.get("ip_address", "")).strip()
            if not ip_addr:
                return err("ip_address is required for ipcam", 400)
            port = int(body.get("port", 4747))
            cam_name = str(body.get("camera_name", body.get("name", f"DroidCam {ip_addr}"))).strip() or f"DroidCam {ip_addr}"
            kwargs["ip_address"] = ip_addr
            kwargs["port"] = port
            kwargs["camera_name"] = cam_name
            # Auto-detect location from the machine's IP (same location as webcam)
            kwargs["camera_name"] = cam_name
            # Strictly using manual or previously captured GPS location.
            manual_location = str(body.get("location_name", "Unknown")).strip() or "Unknown"
            lat = _safe_float(body.get("latitude", 0.0))
            lon = _safe_float(body.get("longitude", 0.0))
            _set_active_location(manual_location, lat, lon, "manual", "ipcam")
        elif source_type == "youtube":
            url = str(body.get("youtube_url", body.get("url", ""))).strip()
            if not url:
                return err("youtube_url is required for youtube", 400)
            manual_location = str(body.get("location_name", body.get("location", {}).get("city", _active_location.get("location_name", "Unknown")) if isinstance(body.get("location"), dict) else _active_location.get("location_name", "Unknown"))).strip() or "Unknown"
            loc_dict = body.get("location", {})
            lat = _safe_float(body.get("latitude", loc_dict.get("latitude", _active_location.get("latitude", 0.0)) if isinstance(loc_dict, dict) else _active_location.get("latitude", 0.0)))
            lon = _safe_float(body.get("longitude", loc_dict.get("longitude", _active_location.get("longitude", 0.0)) if isinstance(loc_dict, dict) else _active_location.get("longitude", 0.0)))
            if not lat or not lon:
                return err("A location must be set before activating YouTube", 400)
            cam_name = str(body.get("camera_name", body.get("name", "YouTube Live Stream"))).strip() or "YouTube Live Stream"
            kwargs["youtube_url"] = url
            kwargs["camera_name"] = cam_name
            _set_active_location(manual_location, lat, lon, "manual", "youtube")
        elif source_type == "rtsp":
            url = str(body.get("rtsp_url", body.get("url", ""))).strip()
            if not url:
                return err("No RTSP URL provided", 400)
            kwargs["rtsp_url"] = url
            kwargs["camera_name"] = str(body.get("camera_name", "RTSP Camera")).strip() or "RTSP Camera"
            manual_location = str(body.get("location_name", _active_location.get("location_name", "Unknown"))).strip() or "Unknown"
            lat = _safe_float(body.get("latitude", _active_location.get("latitude", 0.0)))
            lon = _safe_float(body.get("longitude", _active_location.get("longitude", 0.0)))
            _set_active_location(manual_location, lat, lon, "manual", "rtsp")
        else:
            kwargs["camera_name"] = str(body.get("camera_name", "Laptop Webcam")).strip() or "Laptop Webcam"
            # Laptop webcam uses the browser GPS provided by the frontend.
            _log("webcam source selected; waiting for browser GPS sync...")

        success = _camera.switch_source(source_type, **kwargs)
        if not success:
            socketio.emit("camera_status", {"status": "disconnected", "camera_name": "Camera", "source_type": source_type})
            detailed = _camera.get_last_error() or "Failed to switch camera source"
            if source_type == "youtube" and (
                "blocked all retry attempts" in detailed.lower()
                or "youtube is blocking this stream" in detailed.lower()
                or "sign in" in detailed.lower()
                or "bot" in detailed.lower()
            ):
                return jsonify({
                    "error": True,
                    "message": "YouTube is blocking this stream. Please try a different public video URL, or use webcam/DroidCam mode instead.",
                }), 503
            status_code = 400 if source_type == "youtube" else 500
            return err(detailed, status_code)

        _detector.reset_state_on_source_change()
        global latest_gemini_result
        with gemini_vision_lock:
            latest_gemini_result = None

        if hasattr(handle_gemini_threat, "_cooldowns"):
            handle_gemini_threat._cooldowns = {}

        socketio.emit("gemini_reset", {})
        socketio.emit("camera_status", {"status": "connected", "camera_name": kwargs.get("camera_name", "Camera"), "source_type": source_type})
        return ok({"message": "Camera source switched", "status": _camera.get_status(), "active_location": _active_location})
    except Exception as exc:
        _log(f"/api/camera/source error: {exc}")
        return err(str(exc), 500)


@app.post("/api/camera/test")
def test_camera_connection():
    """Test an IP camera connection (for DroidCam) before activating."""
    try:
        import cv2 as _cv2
        body = request.get_json(silent=True) or {}
        ip = str(body.get("ip_address", "")).strip()
        port = int(body.get("port", 4747))
        if not ip:
            return jsonify({"success": False, "message": "ip_address is required"}), 400

        url = f"http://{ip}:{port}/video"
        cap = _cv2.VideoCapture(url)
        if cap.isOpened():
            ret, _ = cap.read()
            cap.release()
            if ret:
                return jsonify({"success": True, "message": "Connection successful!"})
        cap.release()
        return jsonify({"success": False, "message": f"Cannot connect to {ip}:{port} \u2014 check IP and make sure DroidCam is running on your phone."})
    except Exception as exc:
        return jsonify({"success": False, "message": str(exc)})


@app.get("/api/camera/status")
def camera_status():
    try:
        return ok({"camera": _camera.get_status(), "active_location": _active_location})
    except Exception as exc:
        return err(str(exc), 500)


@app.post("/api/location/update")
def location_update():
    """Endpoint for browser GPS to update camera location with Nominatim reverse geocoding."""
    try:
        body = request.get_json(silent=True) or {}
        lat = _safe_float(body.get("latitude"))
        lon = _safe_float(body.get("longitude"))

        # Use provided name, or auto reverse-geocode via Nominatim (free, no API key needed)
        location_name = str(body.get("location_name", "")).strip()
        if not location_name and lat != 0.0 and lon != 0.0:
            try:
                geo_resp = requests.get(
                    "https://nominatim.openstreetmap.org/reverse",
                    params={"lat": lat, "lon": lon, "format": "json"},
                    headers={"User-Agent": "Protego-Safety-System/1.0"},
                    timeout=5,
                )
                if geo_resp.status_code == 200:
                    geo_data = geo_resp.json()
                    addr = geo_data.get("address", {})
                    parts = [
                        addr.get("suburb") or addr.get("neighbourhood") or addr.get("road"),
                        addr.get("city") or addr.get("town") or addr.get("village") or addr.get("county"),
                        addr.get("state"),
                    ]
                    location_name = ", ".join(p for p in parts if p)
            except Exception as geo_exc:
                _log(f"nominatim reverse geocode failed: {geo_exc}")

        if not location_name:
            location_name = "GPS Location"

        _active_location["latitude"] = lat
        _active_location["longitude"] = lon
        _active_location["mode"] = "gps"
        _active_location["location_name"] = location_name
        _active_location["city"] = ""
        _active_location["state"] = ""
        _active_location["full_address"] = location_name
        _active_location["updated_at"] = _utc_now()

        _log(f"location updated via GPS: {lat}, {lon} → {location_name}")
        socketio.emit("location_updated", {"latitude": lat, "longitude": lon, "location_name": location_name, "method": "gps"})
        socketio.emit("city_authorities_loading", True)

        def _fetch_city_authorities() -> None:
            try:
                result = _alert_system.search_nearest_city_authorities(location_name, "", "")
                if result:
                    socketio.emit("city_authorities", result)
            except Exception as e:
                print(f"[city-auth-update] {e}")

        threading.Thread(target=_fetch_city_authorities, daemon=True).start()
        return ok({"message": "Location updated", "location": _active_location})
    except Exception as exc:
        return err(str(exc), 500)


@app.get("/api/location/active")
def location_active():
    try:
        return ok(_active_location)
    except Exception as exc:
        return err(str(exc), 500)


@app.post("/api/location/set")
def set_location():
    """Store full location object from browser GPS / manual input (LocationPanel)."""
    try:
        data = request.get_json(silent=True) or {}
        lat = _safe_float(data.get("latitude"))
        lon = _safe_float(data.get("longitude"))
        full_address = str(data.get("full_address", "")).strip()
        village = str(data.get("village", "")).strip()
        city = str(data.get("city", "")).strip()
        state = str(data.get("state", "")).strip()
        postcode = str(data.get("postcode", "")).strip()
        method = str(data.get("method", "manual")).strip()

        location_name = (
            ", ".join(p for p in [village, city, state] if p)
            or full_address
            or f"{lat:.4f}, {lon:.4f}"
        )

        _active_location["latitude"] = lat
        _active_location["longitude"] = lon
        _active_location["mode"] = method
        _active_location["location_name"] = location_name
        _active_location["city"] = city
        _active_location["state"] = state
        _active_location["full_address"] = full_address
        _active_location["updated_at"] = _utc_now()

        _log(f"[location/set] {location_name} ({lat}, {lon}) via {method}")
        socketio.emit("location_updated", {**data, "location_name": location_name})

        location_data = {**data, "location_name": location_name}

        # Trigger Tavily search in background
        def _prefetch_tavily(loc_data: dict[str, Any]) -> None:
            try:
                result = _alert_system.search_major_authorities_tavily(
                    loc_data.get("full_address", ""),
                    loc_data.get("city", ""),
                    loc_data.get("state", ""),
                )
                socketio.emit("tavily_authorities", result)
                print("[tavily] emitted to frontend!!")
            except Exception as e:
                print(f"[tavily prefetch] {e}")

        threading.Thread(
            target=_prefetch_tavily,
            args=(location_data,),
            daemon=True,
        ).start()

        socketio.emit("city_authorities_loading", True)

        def _fetch_city_authorities(loc: dict[str, Any]) -> None:
            try:
                result = _alert_system.search_nearest_city_authorities(
                    loc.get("full_address", ""),
                    loc.get("city", ""),
                    loc.get("state", ""),
                )
                if result:
                    socketio.emit("city_authorities", result)
                    print("[server] city authorities emitted to frontend!!")
            except Exception as e:
                print(f"[city-auth] {e}")

        threading.Thread(
            target=_fetch_city_authorities,
            args=(location_data,),
            daemon=True,
        ).start()

        return ok({"status": "ok", "location": {**data, "location_name": location_name}})
    except Exception as exc:
        return err(str(exc), 500)


@app.route("/api/location/search-authorities", methods=["POST"])
def search_authorities():
    try:
        loc = {
            "full_address": str(_active_location.get("full_address") or _active_location.get("location_name") or ""),
            "city": str(_active_location.get("city") or ""),
            "state": str(_active_location.get("state") or ""),
        }
        if not loc["full_address"]:
            return jsonify({"error": "No location set"}), 400

        def _search() -> None:
            result = _alert_system.search_major_authorities_tavily(
                loc.get("full_address", ""),
                loc.get("city", ""),
                loc.get("state", ""),
                _safe_float(_active_location.get("latitude", 0.0)),
                _safe_float(_active_location.get("longitude", 0.0)),
            )
            socketio.emit("tavily_authorities", result)

        threading.Thread(
            target=_search,
            daemon=True,
        ).start()

        return jsonify({"status": "searching..."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.get("/api/location/authorities")
def get_location_authorities():
    """Return cached Tavily major-authorities data (or kick off background search)."""
    try:
        cache = getattr(_alert_system, "_tavily_cache", {})
        if cache and cache.get("result") and time.time() - float(cache.get("timestamp", 0.0) or 0.0) < 1800:
            return ok(cache["result"])

        loc_name = _active_location.get("location_name", "")
        city_val = _active_location.get("city", "")
        state_val = _active_location.get("state", "")
        if not loc_name or loc_name == "Unknown":
            return ok({"hospital": [], "police": [], "searching": False})

        # No fresh cache — kick off background search and return searching flag
        def _search() -> None:
            result = _alert_system.search_major_authorities_tavily(
                loc_name,
                city_val,
                state_val,
                _safe_float(_active_location.get("latitude", 0.0)),
                _safe_float(_active_location.get("longitude", 0.0)),
            )
            socketio.emit("tavily_authorities", result)

        threading.Thread(target=_search, daemon=True).start()
        return ok({"hospital": [], "police": [], "searching": True})
    except Exception as exc:
        return err(str(exc), 500)


@app.get("/api/alerts/pending-popups")
def get_pending_popups():
    try:
        return ok(list(getattr(_alert_system, "pending_popups", []) or []))
    except Exception as exc:
        return err(str(exc), 500)


@app.post("/api/voice/emergency")
def voice_emergency():
    """Generate an emergency voice alert mp3 using gTTS for browser fallback playback."""
    try:
        body = request.get_json(silent=True) or {}
        text = str(body.get("text", "")).strip()
        if not text:
            return err("text is required", 400)

        try:
            from gtts import gTTS
        except Exception as exc:
            return err(f"gTTS unavailable: {exc}", 500)

        mp3_buffer = io.BytesIO()
        gTTS(text=text, lang="en", slow=False).write_to_fp(mp3_buffer)
        mp3_buffer.seek(0)

        return Response(
            mp3_buffer.getvalue(),
            mimetype="audio/mpeg",
            headers={
                "Content-Disposition": 'inline; filename="emergency-voice-alert.mp3"',
                "Cache-Control": "no-store",
            },
        )
    except Exception as exc:
        return err(str(exc), 500)


@app.get("/api/authorities/nearby")
def authorities_nearby():
    try:
        latitude = _safe_float(request.args.get("latitude", _active_location.get("latitude", 0.0)))
        longitude = _safe_float(request.args.get("longitude", _active_location.get("longitude", 0.0)))
        grouped = _alert_system.get_nearby_authorities(latitude, longitude)
        return ok({"location": {"latitude": latitude, "longitude": longitude, "name": _active_location.get("location_name")}, "authorities": grouped})
    except Exception as exc:
        return err(str(exc), 500)


# Stats endpoints
@app.get("/api/stats/today")
def stats_today():
    try:
        stats = _db.get_today_stats()
        cameras = _db.get_cameras()
        active_cameras = len([x for x in cameras if x.get("is_active")]) if cameras else int(_camera.get_status().get("is_connected", False))
        return ok(
            {
                "total_incidents": int(stats.get("total_count", 0)),
                "high_severity_count": int(stats.get("high_severity_count", 0)),
                "authorities_contacted": int(stats.get("unique_authorities_count", 0)),
                "active_cameras": active_cameras,
            }
        )
    except Exception as exc:
        return err(str(exc), 500)


@app.route('/api/detections/latest', methods=['GET'])
def get_latest_detection():
    with state_lock:
        return jsonify(latest_system_state)


@app.route('/api/webcam/frame', methods=['POST'])
def handle_webcam_frame_post():
    data = request.json
    if not data or "frame" not in data:
        return jsonify({"success": False, "error": "No frame data"}), 400

    b64 = data["frame"]
    if "base64," in b64:
        b64 = b64.split("base64,")[1]

    try:
        img_data = base64.b64decode(b64)
        nparr = np.frombuffer(img_data, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if frame is not None:
            _camera.set_webrtc_frame(frame)
            return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
    return jsonify({"success": False, "error": "Invalid image"}), 400


@app.get("/api/system/stats")
def system_stats():
    try:
        feature_status = _detector.get_features_status()
        active_count = len([f for f in feature_status if f.get("is_active")])

        today = _db.get_today_stats()
        by_type = _db.get_by_type(None, None)
        most_active = "N/A"
        if by_type:
            by_type_sorted = sorted(by_type, key=lambda x: x.get("count", 0), reverse=True)
            most_active = by_type_sorted[0].get("feature_name", "N/A")

        return ok(
            {
                "active_features": active_count,
                "total_features": 8,
                "total_detections_today": int(today.get("total_count", 0)),
                "most_active_feature": most_active,
                "current_fps": _runtime["last_processing_fps"],
            }
        )
    except Exception as exc:
        return err(str(exc), 500)


# Feature endpoints
@app.get("/api/features/status")
def features_status():
    try:
        rows = _detector.get_features_status()
        data = []
        for row in rows:
            item = dict(row)
            item["model_name"] = MODEL_NAME_BY_FEATURE.get(item.get("feature_id"), "Hybrid AI")
            data.append(item)
        return ok(data)
    except Exception as exc:
        return err(str(exc), 500)


@app.get("/api/features/recent")
def features_recent():
    try:
        return ok(_db.get_recent_by_feature())
    except Exception as exc:
        return err(str(exc), 500)


@app.get("/api/features/loitering")
def features_loitering():
    try:
        suspects = []
        now = time.time()
        for track_id, history in _detector.loitering_tracker.items():
            if not history:
                continue
            last = history[-1]
            if now - float(last.get("t", now)) > 120:
                continue
            suspects.append(
                {
                    "suspect_id": str(track_id),
                    "location": f"x={int(last.get('x', 0))}, y={int(last.get('y', 0))}",
                    "appearances": len(history),
                    "first_seen": datetime.fromtimestamp(history[0].get("t", now), tz=timezone.utc).isoformat(),
                    "last_seen": datetime.fromtimestamp(last.get("t", now), tz=timezone.utc).isoformat(),
                }
            )
        return ok(suspects)
    except Exception as exc:
        return err(str(exc), 500)


@app.post("/api/features/toggle")
def feature_toggle():
    try:
        body = request.get_json(silent=True) or {}
        feature_id = str(body.get("feature_id", "")).strip()
        is_active = bool(body.get("is_active", False))

        if not feature_id or feature_id not in _detector.features_status:
            return err("feature_id not found", 404)

        _detector.features_status[feature_id]["is_active"] = is_active
        _detector.feature_prefs[feature_id]["is_enabled"] = is_active

        # Persist into preferences feature list.
        prefs = _db.get_preferences() or {}
        feature_settings = prefs.get("feature_settings", prefs.get("features", [])) or []
        updated = False
        for row in feature_settings:
            if row.get("feature_id") == feature_id:
                row["is_enabled"] = is_active
                updated = True
                break
        if not updated:
            feature_settings.append({"feature_id": feature_id, "is_enabled": is_active, "severity_override": None})
        prefs["feature_settings"] = feature_settings
        _db.save_preferences(prefs)
        _rules.reload_preferences()

        return ok({"feature_id": feature_id, "is_active": is_active})
    except Exception as exc:
        return err(str(exc), 500)


# Incident endpoints
@app.get("/api/incidents")
def incidents_list():
    try:
        filters = {
            "page": request.args.get("page", "1"),
            "limit": request.args.get("limit", "20"),
            "incident_type": request.args.get("incident_type"),
            "severity_min": request.args.get("severity_min"),
            "severity_max": request.args.get("severity_max"),
            "date_from": request.args.get("date_from"),
            "date_to": request.args.get("date_to"),
            "location": request.args.get("location"),
            "vehicle_plate": request.args.get("vehicle_plate"),
            "authority_type": request.args.get("authority_type"),
        }
        data = _db.get_incidents(filters)
        total = int(data.get("total_count", 0))
        limit = int(data.get("limit", 20))
        total_pages = (total + limit - 1) // limit if limit > 0 else 0
        return ok(
            {
                "incidents": data.get("incidents", []),
                "total_count": total,
                "page": data.get("page", 1),
                "total_pages": total_pages,
            }
        )
    except Exception as exc:
        return err(str(exc), 500)


@app.get("/api/incidents/export")
def incidents_export():
    try:
        filters = {
            "incident_type": request.args.get("incident_type"),
            "severity_min": request.args.get("severity_min"),
            "severity_max": request.args.get("severity_max"),
            "date_from": request.args.get("date_from"),
            "date_to": request.args.get("date_to"),
            "location": request.args.get("location"),
            "vehicle_plate": request.args.get("vehicle_plate"),
            "authority_type": request.args.get("authority_type"),
        }
        csv_text = _db.export_incidents_csv(filters)
        return Response(
            csv_text,
            mimetype="text/csv",
            headers={"Content-Disposition": f"attachment; filename=protego_export_{int(time.time())}.csv"},
        )
    except Exception as exc:
        return err(str(exc), 500)


@app.get("/api/incidents/<incident_id>")
def incident_by_id(incident_id: str):
    try:
        row = _db.get_incident_by_id(incident_id)
        if row is None:
            return err("Incident not found", 404)
        return ok(row)
    except Exception as exc:
        return err(str(exc), 500)


# Analytics endpoints
@app.get("/api/analytics/summary")
def analytics_summary():
    try:
        date_from = request.args.get("date_from")
        date_to = request.args.get("date_to")
        summary = _db.get_analytics_summary(date_from, date_to)
        data = {
            "total_incidents": summary.get("total_count", 0),
            "total_incidents_change": 0,
            "most_common_type": summary.get("most_common_type"),
            "busiest_location": summary.get("busiest_location"),
            "average_severity": summary.get("average_severity", 0),
            "average_severity_change": 0,
        }
        return ok(data)
    except Exception as exc:
        return err(str(exc), 500)


@app.get("/api/analytics/by-type")
def analytics_by_type():
    try:
        return ok(_db.get_by_type(request.args.get("date_from"), request.args.get("date_to")))
    except Exception as exc:
        return err(str(exc), 500)


@app.get("/api/analytics/over-time")
def analytics_over_time():
    try:
        return ok(_db.get_over_time(request.args.get("date_from"), request.args.get("date_to")))
    except Exception as exc:
        return err(str(exc), 500)


@app.get("/api/analytics/severity")
def analytics_severity():
    try:
        dist = _db.get_severity_distribution(request.args.get("date_from"), request.args.get("date_to"))
        return ok(
            {
                "high_count": dist.get("high", 0),
                "medium_count": dist.get("medium", 0),
                "low_count": dist.get("low", 0),
            }
        )
    except Exception as exc:
        return err(str(exc), 500)


@app.get("/api/analytics/peak-hours")
def analytics_peak_hours():
    try:
        return ok(_db.get_peak_hours(request.args.get("date_from"), request.args.get("date_to")))
    except Exception as exc:
        return err(str(exc), 500)


@app.get("/api/analytics/by-location")
def analytics_by_location():
    try:
        rows = _db.get_by_location(request.args.get("date_from"), request.args.get("date_to"))
        data = [{"location_name": x.get("location"), "count": x.get("count", 0)} for x in rows]
        return ok(data)
    except Exception as exc:
        return err(str(exc), 500)


@app.get("/api/analytics/delivery")
def analytics_delivery():
    try:
        stats = _db.get_delivery_stats(request.args.get("date_from"), request.args.get("date_to"))
        return ok(
            {
                "telegram_success_rate": stats.get("telegram", {}).get("success_rate", 0),
                "whatsapp_success_rate": stats.get("whatsapp", {}).get("success_rate", 0),
                "email_success_rate": stats.get("email", {}).get("success_rate", 0),
            }
        )
    except Exception as exc:
        return err(str(exc), 500)


@app.get("/api/analytics/authorities")
def analytics_authorities():
    try:
        rows = _db.get_authority_stats(request.args.get("date_from"), request.args.get("date_to"))
        data = [
            {
                "authority_name": x.get("authority_name"),
                "authority_type": "Emergency Network",
                "times_alerted": x.get("count", 0),
                "incident_types": x.get("incident_types", []),
            }
            for x in rows
        ]
        return ok(data)
    except Exception as exc:
        return err(str(exc), 500)


# Settings endpoints
@app.get("/api/settings/cameras")
def settings_cameras_get():
    try:
        return ok(_db.get_cameras())
    except Exception as exc:
        return err(str(exc), 500)


@app.post("/api/settings/cameras")
def settings_cameras_post():
    try:
        body = request.get_json(silent=True) or {}
        if str(body.get("source_type", "")).lower() == "webcam":
            # Laptop webcam uses the browser GPS provided by the frontend.
            pass

        required = ["name", "source_type", "location_name", "latitude", "longitude"]
        for key in required:
            if key not in body:
                return err(f"Missing field: {key}", 400)
        row = _db.save_camera(body)
        if row is None:
            return err("Failed to save camera", 500)
        return ok(row, 201)
    except Exception as exc:
        return err(str(exc), 500)


@app.put("/api/settings/cameras/<camera_id>")
def settings_cameras_put(camera_id: str):
    try:
        body = request.get_json(silent=True) or {}
        if str(body.get("source_type", "")).lower() == "webcam":
            # Laptop webcam uses the browser GPS provided by the frontend.
            pass
        body["id"] = camera_id
        row = _db.save_camera(body)
        if row is None:
            return err("Failed to update camera", 500)
        return ok(row)
    except Exception as exc:
        return err(str(exc), 500)


@app.delete("/api/settings/cameras/<camera_id>")
def settings_cameras_delete(camera_id: str):
    try:
        success = _db.delete_camera(camera_id)
        if not success:
            return err("Camera not found", 404)
        return ok({"deleted": True})
    except Exception as exc:
        return err(str(exc), 500)


@app.post("/api/settings/cameras/test")
def settings_cameras_test():
    try:
        body = request.get_json(silent=True) or {}
        source_type = str(body.get("source_type", "webcam")).lower()

        target = None
        if source_type == "webcam":
            target = 0
        elif source_type == "ipcam":
            ip = str(body.get("ip_address", "")).strip()
            if not ip:
                return err("ip_address is required for ipcam", 400)
            target = f"http://{ip}:4747/video"
        elif source_type == "youtube":
            url = str(body.get("youtube_url", "")).strip()
            if not url:
                return err("youtube_url is required for youtube", 400)
            probe = CameraManager()
            try:
                is_open = probe.start("youtube", youtube_url=url, camera_name="YouTube Test")
                if is_open:
                    deadline = time.time() + 10
                    while time.time() < deadline:
                        if probe.get_frame() is not None:
                            break
                        time.sleep(0.2)
                    is_open = probe.get_frame() is not None
            finally:
                probe.stop()

            if not is_open:
                return err("Connection test failed", 400)
            return ok({"message": "Connection test successful"})
        else:
            return err("Invalid source_type", 400)

        cap = cv2.VideoCapture(target)
        is_open = cap.isOpened() if cap else False
        if cap:
            cap.release()

        if not is_open:
            return err("Connection test failed", 400)
        return ok({"message": "Connection test successful"})
    except Exception as exc:
        return err(str(exc), 500)


@app.get("/api/settings/contacts")
def settings_contacts_get():
    try:
        return ok(_db.get_contacts())
    except Exception as exc:
        return err(str(exc), 500)


@app.post("/api/settings/contacts")
def settings_contacts_post():
    try:
        body = request.get_json(silent=True) or {}
        required = ["name", "authority_type", "email", "whatsapp_number", "latitude", "longitude"]
        for key in required:
            if key not in body:
                return err(f"Missing field: {key}", 400)
        row = _db.save_contact(body)
        _alert_system.reload_contacts()
        _detector.reload_registered_contacts()
        if row is None:
            return err("Failed to save contact", 500)
        return ok(row, 201)
    except Exception as exc:
        return err(str(exc), 500)


@app.put("/api/settings/contacts/<contact_id>")
def settings_contacts_put(contact_id: str):
    try:
        body = request.get_json(silent=True) or {}
        body["id"] = contact_id
        row = _db.save_contact(body)
        _alert_system.reload_contacts()
        _detector.reload_registered_contacts()
        if row is None:
            return err("Failed to update contact", 500)
        return ok(row)
    except Exception as exc:
        return err(str(exc), 500)


@app.delete("/api/settings/contacts/<contact_id>")
def settings_contacts_delete(contact_id: str):
    try:
        success = _db.delete_contact(contact_id)
        _alert_system.reload_contacts()
        _detector.reload_registered_contacts()
        if not success:
            return err("Contact not found", 404)
        return ok({"deleted": True})
    except Exception as exc:
        return err(str(exc), 500)


@app.get("/api/settings/preferences")
def settings_preferences_get():
    try:
        prefs = _db.get_preferences()
        if prefs is None:
            return err("Failed to load preferences", 500)
        data = {
            "id": prefs.get("id"),
            "minimum_severity_threshold": prefs.get("min_severity", 4),
            "duplicate_alert_cooldown_seconds": prefs.get("duplicate_cooldown", 30),
            "channels": {
                "telegram": prefs.get("telegram_enabled", True),
                "sms": prefs.get("whatsapp_enabled", True),
                "email": prefs.get("email_enabled", True),
            },
            "features": prefs.get("feature_settings", []),
            "demo_email": prefs.get("demo_email", os.getenv("DEMO_EMAIL", "")),
            "demo_phone": prefs.get("demo_phone", os.getenv("DEMO_PHONE", "")),
            "show_real_institution_details": prefs.get("show_real_institution_details", True),
        }
        return ok(data)
    except Exception as exc:
        return err(str(exc), 500)


@app.put("/api/settings/preferences")
def settings_preferences_put():
    try:
        body = request.get_json(silent=True) or {}
        if "minimum_severity_threshold" in body:
            val = _safe_int(body.get("minimum_severity_threshold"), 4)
            if val < 1 or val > 10:
                return err("minimum_severity_threshold must be 1-10", 400)
        if "duplicate_alert_cooldown_seconds" in body:
            val = _safe_int(body.get("duplicate_alert_cooldown_seconds"), 30)
            if val not in {30, 60, 120, 300}:
                return err("duplicate_alert_cooldown_seconds must be one of 30,60,120,300", 400)

        saved = _db.save_preferences(body)
        if saved is None:
            return err("Failed to save preferences", 500)

        _rules.reload_preferences()
        _detector.feature_prefs = _detector._load_feature_preferences()
        for fid, status in _detector.features_status.items():
            status["is_active"] = bool(_detector.feature_prefs.get(fid, {}).get("is_enabled", True))

        _alert_system.reload_contacts()
        return ok(saved)
    except Exception as exc:
        return err(str(exc), 500)


def _detect_webcam_location() -> dict[str, Any] | None:
    """
    Auto-detect location for webcam.
    Returns None as IP-based location detection was removed per requirements.
    """
    return None


def initialize_runtime() -> None:
    _log("initializing Protego runtime...")
    cloud_run_runtime = bool(os.getenv("K_SERVICE"))
    skip_heavy_models = (
        os.getenv("DISABLE_HEAVY_MODELS", "").strip().lower() in {"1", "true", "yes", "on"}
        or cloud_run_runtime
    )
    
    # Start Telegram polling listener
    threading.Thread(target=_telegram_polling_thread, daemon=True).start()

    # Load heavy models only when explicitly enabled.
    if skip_heavy_models:
        _detector.models_loaded = True
        reason = "cloud run runtime" if cloud_run_runtime else "DISABLE_HEAVY_MODELS"
        _log(f"heavy model loading disabled ({reason}); using cloud-safe fallback mode")
    else:
        # Load heavy models in background so server accepts connections immediately.
        def _model_loader():
            _detector.load_models()

        socketio.start_background_task(_model_loader)

    ensure_background_tasks()

    # NO AUTO-START: Webcam will start only when user clicks "Start Webcam" button
    # This reduces unnecessary frame analysis and Gemini API calls on startup
    _log("runtime initialized; waiting for manual camera start")
    
    # Set initial location for when webcam is eventually started
    auto_loc = _detect_webcam_location()
    if auto_loc:
        _set_active_location(
            auto_loc["location_name"],
            _safe_float(auto_loc["latitude"]),
            _safe_float(auto_loc["longitude"]),
            "auto",
            "webcam",
        )
    else:
        _set_active_location("Unknown", 0.0, 0.0, "auto", "webcam")


@app.post("/api/alerts/register-session")
def alerts_register_session():
    """Register judge contact info for current session."""
    try:
        body = request.get_json(silent=True) or {}
        email = body.get("email")
        phone = body.get("phone")
        
        _alert_system.register_session_contact(email=email, phone=phone)
        return ok({"status": "registered", "email": email, "phone": phone})
    except Exception as exc:
        return err(str(exc), 500)


@app.get("/api/telegram/status")
def telegram_status():
    """Check current Telegram registration status."""
    return ok({
        "is_connected": bool(_alert_system.session_telegram_chat_id),
        "chat_id": _alert_system.session_telegram_chat_id,
        "registration_code": _alert_system.session_telegram_code
    })


@app.post("/api/telegram/request-code")
def telegram_request_code():
    """Generate a new unique code for /start registration."""
    code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
    _alert_system.session_telegram_code = code
    
    bot_username = os.getenv("TELEGRAM_BOT_USERNAME")
    if not bot_username and _alert_system.telegram_token:
        try:
            resp = requests.get(f"https://api.telegram.org/bot{_alert_system.telegram_token}/getMe", timeout=5)
            if resp.status_code == 200:
                bot_username = resp.json().get("result", {}).get("username")
        except Exception:
            pass
            
    return ok({"code": code, "bot_username": bot_username or "ProtegoSafetyBot"})


@app.get("/api/health")
def health_check():
    try:
        cam_status = _camera.get_status()
        models_ready = _detector.models_loaded
        return ok({
            "status": "ok",
            "uptime_seconds": round(time.time() - _startup_time, 1),
            "database": "connected" if _db is not None else "unavailable",
            "camera": "connected" if cam_status.get("is_connected") else "disconnected",
            "models": "ready" if models_ready else "loading",
            "location": _active_location.get("location_name", "Unknown"),
            "source_type": _active_location.get("source_type", "unknown"),
            "detection_loop": "running" if _runtime["detection_loop_running"] else "stopped",
        })
    except Exception as exc:
        return err(str(exc), 500)


@app.post("/api/test/alert")
def test_alert():
    """Test endpoint to trigger a test alert with email notification."""
    try:
        test_alert_obj = {
            "incident_type": "Test Alert",
            "feature_name": "Test Detection",
            "severity_score": 7.5,
            "confidence": 0.95,
            "location": _active_location.get("location_name", "Unknown Location"),
            "camera_latitude": _active_location.get("latitude", 0.0),
            "camera_longitude": _active_location.get("longitude", 0.0),
            "gemini_description": "This is a test alert to verify email notification system is working correctly.",
            "timestamp": _utc_now(),
            "screenshot": None,
        }
        
        result = _alert_system.send_alert(test_alert_obj)
        return ok({
            "message": "Test alert sent",
            "results": result,
        })
    except Exception as exc:
        return err(str(exc), 500)


@app.post("/api/video/analyze")
def video_analyze():
    """Analyze uploaded video with all 8 features and models."""
    try:
        # Check if video file is in request
        if "video" not in request.files:
            return err("No video file provided", 400)
        
        video_file = request.files["video"]
        if video_file.filename == "":
            return err("No selected file", 400)
        
        # Validate file type
        allowed_extensions = {"mp4", "avi", "mov", "mkv", "flv", "wmv", "webm"}
        if not ("." in video_file.filename and video_file.filename.rsplit(".", 1)[1].lower() in allowed_extensions):
            return err("Invalid file type. Allowed: mp4, avi, mov, mkv, flv, wmv, webm", 400)
        
        # Save uploaded file temporarily
        temp_dir = tempfile.gettempdir()
        video_id = str(uuid.uuid4())[:8]
        temp_video_path = os.path.join(temp_dir, f"protego_video_{video_id}.mp4")
        video_file.save(temp_video_path)
        
        _log(f"Processing video: {video_id}")
        
        try:
            # Open video and get properties
            cap = cv2.VideoCapture(temp_video_path)
            if not cap.isOpened():
                return err("Failed to open video file", 400)
            
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            fps = cap.get(cv2.CAP_PROP_FPS)
            frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            
            if total_frames == 0 or fps == 0:
                return err("Invalid video file (no frames or fps)", 400)
            
            duration_seconds = total_frames / fps
            
            # Process video frame by frame through the same detector pipeline used for live feeds.
            incidents: list[dict[str, Any]] = []
            frame_count = 0
            sample_interval = max(1, int(fps // 2))  # Process every 0.5 seconds
            feature_detections = {f"feat-{i}": [] for i in range(1, 9)}
            feature_incident_cooldown: dict[str, float] = {}

            # Isolate offline analysis from live runtime carry-over.
            _detector.reset_state_on_source_change()

            # Force-enable all 8 features for offline analysis, then restore original states.
            original_active_states = {
                fid: bool(meta.get("is_active", True))
                for fid, meta in _detector.features_status.items()
            }
            original_alert_times = dict(getattr(_detector, "_alert_times", {}))
            if hasattr(_detector, "_alert_times"):
                _detector._alert_times = {}
            for fid in _detector.features_status:
                _detector.features_status[fid]["is_active"] = True
                if fid in _detector.feature_prefs:
                    _detector.feature_prefs[fid]["is_enabled"] = True

            def _frame_to_data_url(img: Any) -> str:
                ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 82])
                if not ok:
                    return ""
                import base64 as _b64
                return "data:image/jpeg;base64," + _b64.b64encode(buf).decode("utf-8")
            
            try:
                while cap.isOpened():
                    ret, frame = cap.read()
                    if not ret:
                        break

                    frame_count += 1

                    # Sample every N frames to reduce processing
                    if frame_count % sample_interval != 0:
                        continue

                    try:
                        # Resize frame if needed
                        if frame.shape[0] != 720 or frame.shape[1] != 1280:
                            frame = cv2.resize(frame, (1280, 720))

                        # Process frame with same local + Gemini-integrated live pipeline.
                        results = _detector.process_frame(frame)
                        if not isinstance(results, dict):
                            continue

                        timestamp = round(frame_count / fps, 2)
                        screenshot_b64 = _frame_to_data_url(frame)

                        # Collect per-feature status hits for all 8 features.
                        features_status = results.get("features_status", []) or []
                        gemini_analysis = results.get("gemini_analysis") or {}
                        gemini_summary = str(gemini_analysis.get("gemini_summary") or gemini_analysis.get("scene") or "").strip()
                        for feature in features_status:
                            feature_id = feature.get("feature_id")
                            if not feature_id:
                                continue
                            confidence = float(feature.get("current_confidence", 0.0) or 0.0)
                            is_detecting = bool(feature.get("is_detecting"))
                            if is_detecting:
                                feature_detections.setdefault(feature_id, []).append({
                                    "timestamp": timestamp,
                                    "confidence": confidence,
                                    "is_detecting": True,
                                })

                            # For offline reporting, capture feature-level incidents even when strict live alert gates are not crossed.
                            if is_detecting and confidence >= 0.55:
                                last_ts = feature_incident_cooldown.get(feature_id, -9999.0)
                                if timestamp - last_ts >= 2.0:
                                    feature_name = str(feature.get("feature_name") or feature_id)
                                    desc = (
                                        gemini_summary
                                        or f"{feature_name} pattern detected by local models at confidence {confidence:.2f}."
                                    )
                                    incidents.append({
                                        "id": f"vid-feature-{video_id}-{feature_id}-{frame_count}",
                                        "timestamp": timestamp,
                                        "frame_number": frame_count,
                                        "feature_id": feature_id,
                                        "feature_name": feature_name,
                                        "incident_type": feature_name,
                                        "severity_score": int(max(1, min(10, round(confidence * 10)))),
                                        "confidence": confidence,
                                        "gemini_description": desc,
                                        "threat_level": "high" if confidence >= 0.8 else "medium",
                                        "screenshot": screenshot_b64,
                                    })
                                    feature_incident_cooldown[feature_id] = timestamp

                        # If low-confidence local detections or any flags exist, run Gemini confirmation path.
                        all_detections = results.get("detections", []) or []
                        has_low_conf = any(float(d.get("confidence", 1.0) or 1.0) < 0.70 for d in all_detections)
                        detector_alerts = results.get("alerts", []) or []
                        if has_low_conf or detector_alerts:
                            top_conf = max([float(d.get("confidence", 0.0) or 0.0) for d in all_detections], default=0.5)
                            try:
                                _detector.confirm_with_gemini(
                                    frame,
                                    context_description=(
                                        f"Video-analyzer frame review at {timestamp}s. "
                                        f"has_low_conf={has_low_conf}, flagged_local_events={len(detector_alerts)}"
                                    ),
                                    local_confidence=max(0.5, min(0.95, top_conf)),
                                    feature_key="video-analyzer",
                                )
                            except Exception:
                                pass

                        for alert in detector_alerts:
                            incidents.append({
                                "id": f"vid-local-{video_id}-{frame_count}-{len(incidents)}",
                                "timestamp": timestamp,
                                "frame_number": frame_count,
                                "feature_id": alert.get("feature_id", "unknown"),
                                "feature_name": alert.get("feature_name", alert.get("incident_type", "Unknown Incident")),
                                "incident_type": alert.get("incident_type", alert.get("feature_name", "Unknown Incident")),
                                "severity_score": int(alert.get("severity_score", max(1, min(10, round(float(alert.get("confidence", 0.7) or 0.7) * 10))))),
                                "confidence": float(alert.get("confidence", 0.0) or 0.0),
                                "gemini_description": alert.get("gemini_description") or alert.get("description") or "No description available",
                                "threat_level": alert.get("threat_level", "medium"),
                                "screenshot": screenshot_b64,
                            })

                        # Include Gemini-pending alerts generated by live pipeline thread.
                        gemini_alerts = results.get("gemini_alerts", []) or []
                        for g_alert in gemini_alerts:
                            shot = str(g_alert.get("screenshot") or "")
                            if shot and not shot.startswith("data:image"):
                                shot = "data:image/jpeg;base64," + shot
                            incidents.append({
                                "id": g_alert.get("id", f"vid-gemini-{video_id}-{frame_count}-{len(incidents)}"),
                                "timestamp": timestamp,
                                "frame_number": frame_count,
                                "feature_id": g_alert.get("feature_id", "gemini-vision"),
                                "feature_name": g_alert.get("feature_name", g_alert.get("incident_type", "Gemini Vision Incident")),
                                "incident_type": g_alert.get("incident_type", "Gemini Vision Incident"),
                                "severity_score": int(g_alert.get("severity_score", 7) or 7),
                                "confidence": float(g_alert.get("confidence", 0.0) or 0.0),
                                "gemini_description": g_alert.get("gemini_description") or "No description available",
                                "threat_level": g_alert.get("threat_level", "high"),
                                "screenshot": shot or screenshot_b64,
                            })

                    except Exception as frame_exc:
                        _log(f"Error processing frame {frame_count}: {frame_exc}")
                        continue
            finally:
                cap.release()
                # Restore original feature activation state.
                for fid, old_state in original_active_states.items():
                    if fid in _detector.features_status:
                        _detector.features_status[fid]["is_active"] = old_state
                    if fid in _detector.feature_prefs:
                        _detector.feature_prefs[fid]["is_enabled"] = old_state
                if hasattr(_detector, "_alert_times"):
                    _detector._alert_times = original_alert_times

            incidents.sort(key=lambda x: (float(x.get("timestamp", 0.0)), int(x.get("frame_number", 0))))
            incidents = incidents[:120]
            
            return ok({
                "video_id": video_id,
                "duration_seconds": round(duration_seconds, 2),
                "total_frames": total_frames,
                "fps": round(fps, 2),
                "resolution": f"{frame_width}x{frame_height}",
                "frames_processed": frame_count,
                "alerts_found": len(incidents),
                "alerts": incidents,
                "feature_detections": feature_detections,
                "summary": {
                    "total_incidents": len(incidents),
                    "sample_interval_seconds": 0.5,
                    "features_checked": [
                        "road accident",
                        "person collapsed",
                        "woman in distress",
                        "stampede risk",
                        "suspicious loitering",
                        "illegal waste dumping",
                        "reckless driving",
                        "fire/smoke",
                    ],
                },
            })
            
        finally:
            # Clean up temp file
            if os.path.exists(temp_video_path):
                try:
                    os.remove(temp_video_path)
                    _log(f"Cleaned up temp video: {video_id}")
                except Exception as cleanup_exc:
                    _log(f"Failed to clean up {video_id}: {cleanup_exc}")
    
    except Exception as exc:
        return err(str(exc), 500)


if __name__ == "__main__":
    initialize_runtime()
    port = int(os.getenv("PORT", "5000"))
    _log(f"starting Protego backend on http://127.0.0.1:{port} (async_mode={async_mode})")
    socketio.run(
        app,
        host="0.0.0.0",
        port=port,
        debug=False,
        use_reloader=False,
        log_output=True,
        allow_unsafe_werkzeug=True,
    )

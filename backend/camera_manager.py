from __future__ import annotations

import base64
import os
import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable

import cv2
import numpy as np
import requests
import re

def get_youtube_stream_via_invidious(video_url):
    # Extract video ID from URL
    video_id = re.search(
        r'(?:v=|\/)([0-9A-Za-z_-]{11})', video_url
    )
    if not video_id:
        raise Exception("Invalid YouTube URL")
    
    video_id = video_id.group(1)
    
    # Try multiple public Invidious instances
    instances = [
        "https://invidious.snopyta.org",
        "https://inv.riverside.rocks", 
        "https://invidious.kavin.rocks",
        "https://yt.artemislena.eu",
        "https://invidious.nerdvpn.de"
    ]
    
    for instance in instances:
        try:
            api_url = f"{instance}/api/v1/videos/{video_id}"
            response = requests.get(api_url, timeout=10)
            if response.status_code == 200:
                data = response.json()
                # Get best video stream URL
                formats = data.get('adaptiveFormats', []) + \
                          data.get('formatStreams', [])
                for fmt in formats:
                    if fmt.get('type', '').startswith('video/mp4'):
                        return fmt['url']
        except Exception:
            continue
    
    raise Exception(
        "All Invidious instances failed. Try a different URL."
    )


COOKIES_PATH = os.path.join(os.path.dirname(__file__), "cookies.txt")


class CameraManager:
    def __init__(self, status_callback: Callable[[dict[str, Any]], None] | None = None) -> None:
        self.cap: cv2.VideoCapture | None = None
        self.vidgear_stream: Any = None
        self.source_type: str | None = None
        self.source_kwargs: dict[str, Any] = {}
        self.youtube_original: str | None = None
        self.youtube_is_live = False
        self.youtube_duration = 0
        self.yt_fps = 25.0
        self.yt_last_frame_time = 0.0

        self.frame_lock = threading.Lock()
        self.latest_frame: np.ndarray | None = None

        self.is_running = False
        self.capture_thread: threading.Thread | None = None

        self.status_callback = status_callback
        self.status: dict[str, Any] = {
            "source_type": None,
            "is_connected": False,
            "fps": 0.0,
            "camera_name": "No Camera",
            "resolution": "-",
            "last_frame_time": None,
        }
        self.last_error: str | None = None

    def _log(self, message: str) -> None:
        ts = datetime.now(timezone.utc).isoformat()
        print(f"[{ts}] [camera] {message}")

    def _emit_status(self) -> None:
        if self.status_callback is None:
            return
        try:
            self.status_callback(self.get_status())
        except Exception as exc:
            self._log(f"status callback error: {exc}")

    def get_ydl_opts(self) -> dict[str, Any]:
        opts: dict[str, Any] = {
            "quiet": True,
            "no_warnings": False,
            "extractor_retries": 10,
            "sleep_interval": 3,
            "max_sleep_interval": 6,
            "socket_timeout": 30,
            "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "referer": "https://www.youtube.com/",
            "http_headers": {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept": "text/html,application/xhtml+xml,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
            "format": "best/bestvideo+bestaudio/worst",
            "format_sort": ["res:720", "ext:mp4:m4a"],
            "ignore_no_formats_error": True,
            "noplaylist": True,
            # "extractor_args": {"youtube": {"player_client": ["android"]}},
        }
        if os.path.exists(COOKIES_PATH):
            opts["cookiefile"] = COOKIES_PATH
        return opts

    def _camgear_stream_params(self) -> dict[str, Any]:
        ydl = self.get_ydl_opts()
        return {
            "quiet": ydl.get("quiet"),
            "no_warnings": ydl.get("no_warnings"),
            "extractor_retries": ydl.get("extractor_retries"),
            "sleep_interval": ydl.get("sleep_interval"),
            "max_sleep_interval": ydl.get("max_sleep_interval"),
            "socket_timeout": ydl.get("socket_timeout"),
            "user_agent": ydl.get("user_agent"),
            "referer": ydl.get("referer"),
            "http_headers": ydl.get("http_headers"),
            "format": ydl.get("format"),
            "noplaylist": ydl.get("noplaylist"),
            "extractor_args": ydl.get("extractor_args"),
            **({"cookiefile": ydl.get("cookiefile")} if ydl.get("cookiefile") else {}),
        }

    def extract_with_retry(self, url: str, retries: int = 3) -> dict[str, Any]:
        import yt_dlp

        for attempt in range(retries):
            try:
                with yt_dlp.YoutubeDL(self.get_ydl_opts()) as ydl:
                    return ydl.extract_info(url, download=False)
            except Exception as e:
                message = str(e)
                if "Sign in" in message or "bot" in message.lower():
                    wait = 2 ** attempt
                    self._log(f"[Protego] Bot detection hit, retrying in {wait}s...")
                    time.sleep(wait)
                    continue
                raise
        raise Exception("YouTube blocked all retry attempts. Please try a different video URL.")

    def _start_camgear_with_retry(self, url: str, retries: int = 3):
        from vidgear.gears import CamGear

        try:
            stream_url = get_youtube_stream_via_invidious(url)
            return CamGear(source=stream_url, logging=True).start()
        except Exception as e:
            self._log(f"Invidious failed: {e}. Falling back to yt-dlp.")
            # fallback to yt-dlp
            return CamGear(
                source=url,
                stream_mode=True,
                **{"yt_dlp_opts": self.get_ydl_opts()}
            ).start()

    def _get_youtube_info(self, url: str) -> dict[str, Any] | None:
        try:
            info = self.extract_with_retry(url, retries=3)
            return {
                "is_live": bool(info.get("is_live", False)),
                "title": str(info.get("title") or "YouTube"),
                "duration": int(info.get("duration") or 0),
            }
        except Exception as exc:
            msg = str(exc)
            if "Sign in to confirm your age" in msg:
                self.last_error = (
                    "YouTube blocked this stream due to age-restriction. "
                    "Use a non age-restricted stream URL, or provide cookies.txt for yt-dlp authentication."
                )
            elif "Sign in" in msg or "bot" in msg.lower() or "blocked all retry attempts" in msg.lower():
                self.last_error = (
                    "YouTube is blocking this stream. Please try a different public video URL, "
                    "or use webcam/DroidCam mode instead."
                )
            else:
                self.last_error = f"yt-dlp metadata extraction failed: {msg}"
            self._log(f"yt-dlp info extraction failed: {exc}")
            return None

    def _start_youtube(self, url: str, name: str = "YouTube") -> bool:
        try:
            from vidgear.gears import CamGear

            info = self._get_youtube_info(url) or {}
            if self.last_error and "age-restriction" in self.last_error.lower():
                return False
            is_live = bool(info.get("is_live", False))
            title = str(info.get("title") or name)
            duration = int(info.get("duration") or 0)

            self._log(
                f"YouTube info: '{title}' | live={is_live} | duration={duration}s"
            )

            stream = self._start_camgear_with_retry(url, retries=3)

            test_frame = None
            deadline = time.time() + 10
            while time.time() < deadline:
                test_frame = stream.read()
                if test_frame is not None:
                    break
                time.sleep(0.2)

            if test_frame is None:
                stream.stop()
                raise RuntimeError("No frames from stream")

            try:
                if test_frame.shape[0] != 720 or test_frame.shape[1] != 1280:
                    test_frame = cv2.resize(test_frame, (1280, 720))
            except Exception:
                pass

            self.vidgear_stream = stream
            self.cap = None
            self.source_type = "youtube"
            self.source_kwargs = {
                "youtube_url": url,
                "camera_name": title or name,
            }
            self.youtube_original = url
            self.youtube_is_live = is_live
            self.youtube_duration = duration
            self.yt_fps = 25.0
            self.yt_last_frame_time = time.time()
            self.is_running = True

            with self.frame_lock:
                self.latest_frame = test_frame

            self.status.update(
                {
                    "source_type": "youtube",
                    "is_connected": True,
                    "fps": 0.0,
                    "camera_name": title or name,
                    "resolution": f"{test_frame.shape[1]}x{test_frame.shape[0]}",
                    "last_frame_time": datetime.now(timezone.utc).isoformat(),
                }
            )
            self._emit_status()

            self.capture_thread = threading.Thread(target=self._capture_loop, daemon=True, name="CameraCaptureLoop")
            self.capture_thread.start()
            self._log(f"VidGear connected: {title or name}")
            self.last_error = None
            return True
        except Exception as exc:
            msg = str(exc)
            if "Input URL is invalid" in msg:
                self.last_error = (
                    self.last_error
                    or "Invalid or inaccessible YouTube stream URL. It may require login/cookies or be geo/age restricted."
                )
            elif "Sign in" in msg or "bot" in msg.lower() or "blocked all retry attempts" in msg.lower():
                self.last_error = (
                    "YouTube is blocking this stream. Please try a different public video URL, "
                    "or use webcam/DroidCam mode instead."
                )
            else:
                self.last_error = f"youtube failed: {msg}"
            self._log(f"youtube failed: {exc}")
            self.is_running = False
            self.status["is_connected"] = False
            if self.vidgear_stream is not None:
                try:
                    self.vidgear_stream.stop()
                except Exception:
                    pass
            self.vidgear_stream = None
            return False

    def _restart_youtube_clip(self) -> None:
        if not self.youtube_original:
            time.sleep(2)
            return

        self._log("clip ended - restarting")
        try:
            from vidgear.gears import CamGear

            if self.vidgear_stream is not None:
                try:
                    self.vidgear_stream.stop()
                except Exception:
                    pass

            time.sleep(0.5)
            self.vidgear_stream = self._start_camgear_with_retry(self.youtube_original, retries=3)
            self.yt_last_frame_time = time.time()
            self._log("clip restarted from beginning")
        except Exception as exc:
            self._log(f"restart failed: {exc}")
            time.sleep(2)

    def _build_source(self, source_type: str, kwargs: dict[str, Any]) -> tuple[Any, str] | None:
        if source_type == "webcam":
            index = int(kwargs.get("index", 0))
            return index, kwargs.get("camera_name", f"Laptop Webcam ({index})")

        if source_type == "ipcam":
            ip_address = str(kwargs.get("ip_address", "")).strip()
            if not ip_address:
                self._log("ipcam start failed: missing ip_address")
                return None
            port = kwargs.get("port", 4747)
            url = f"http://{ip_address}:{port}/video"
            return url, kwargs.get("camera_name", f"DroidCam {ip_address}")

        if source_type == "youtube":
            youtube_url = str(kwargs.get("youtube_url", "")).strip()
            if not youtube_url:
                self._log("youtube start failed: missing youtube_url")
                return None
            return youtube_url, kwargs.get("camera_name", "YouTube Live Stream")

        if source_type == "rtsp":
            rtsp_url = str(kwargs.get("rtsp_url", kwargs.get("url", ""))).strip()
            if not rtsp_url:
                self._log("rtsp start failed: missing rtsp_url")
                return None
            return rtsp_url, kwargs.get("camera_name", "RTSP Camera")

        self._log(f"unknown source_type: {source_type}")
        return None

    def start(self, source_type: str = "webcam", **kwargs: Any) -> bool:
        self.stop()
        self.last_error = None

        if source_type == "youtube":
            youtube_url = str(kwargs.get("youtube_url", "")).strip()
            if not youtube_url:
                self._log("youtube start failed: missing youtube_url")
                return False
            return self._start_youtube(youtube_url, kwargs.get("camera_name", "YouTube"))

        source_info = self._build_source(source_type, kwargs)
        if source_info is None:
            return False

        source_target, camera_name = source_info

        try:
            self._log(f"opening {source_type} source: {source_target}")
            cap = cv2.VideoCapture(source_target)
            
            # CRITICAL - set buffer size to prevent stuck frames for network streams
            if source_type in ["youtube", "ipcam"]:
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 10000)

            if not cap or not cap.isOpened():
                self._log(f"failed to open source ({source_type})")
                self.last_error = f"Failed to open source: {source_type}"
                if cap:
                    cap.release()
                return False

            self.cap = cap
            self.source_type = source_type
            self.source_kwargs = dict(kwargs)
            self.is_running = True

            with self.frame_lock:
                self.latest_frame = None

            self.status.update(
                {
                    "source_type": source_type,
                    "is_connected": True,
                    "fps": 0.0,
                    "camera_name": camera_name,
                    "resolution": "-",
                    "last_frame_time": None,
                }
            )
            self._emit_status()

            self.capture_thread = threading.Thread(target=self._capture_loop, daemon=True, name="CameraCaptureLoop")
            self.capture_thread.start()
            self._log(f"successfully connected to {source_type} ({camera_name})")
            self.last_error = None
            
            # Pre-roll delay for network sources to allow ffmpeg/hardware buffers to fill
            if source_type in ["youtube", "ipcam"]:
                self._log(f"waiting 1.5s for network buffer to stabilize...")
                time.sleep(1.5)
                
            return True
        except Exception as exc:
            self._log(f"start error: {exc}")
            self.last_error = f"start error: {exc}"
            return False

    def _capture_loop(self) -> None:
        failure_count = 0
        fps_counter = 0
        fps_window_start = time.time()
        last_success_time = time.time()

        failure_limit = 150 if self.source_type in ["youtube", "ipcam"] else 15

        while self.is_running:
            if self.source_type == "youtube":
                if self.vidgear_stream is None:
                    time.sleep(0.1)
                    continue

                frame = self.vidgear_stream.read()
                if frame is None:
                    if not self.youtube_is_live:
                        self._restart_youtube_clip()
                    else:
                        time.sleep(0.05)
                    continue

                target_interval = 1.0 / max(self.yt_fps, 1.0)
                elapsed_since_last = time.time() - self.yt_last_frame_time
                sleep_time = target_interval - elapsed_since_last
                if sleep_time > 0:
                    time.sleep(sleep_time)
                self.yt_last_frame_time = time.time()

                ok = True
            elif self.cap is None:
                failure_count += 1
                time.sleep(0.1)
            else:
                ok, frame = self.cap.read()

                if not ok or frame is None:
                    failure_count += 1
                    time.sleep(0.05 if self.source_type != "webcam" else 0.01)
                    continue

            if not ok or frame is None:
                continue

            try:
                if frame.shape[0] != 720 or frame.shape[1] != 1280:
                    resized = cv2.resize(frame, (1280, 720))
                else:
                    resized = frame
            except Exception:
                failure_count += 1
                continue

            with self.frame_lock:
                self.latest_frame = resized

            failure_count = 0
            fps_counter += 1
            last_success_time = time.time()
            self.status["is_connected"] = True
            self.status["resolution"] = f"{frame.shape[1]}x{frame.shape[0]}"
            self.status["last_frame_time"] = datetime.now(timezone.utc).isoformat()

            # Stability check: FPS counter window
            now = time.time()
            elapsed = now - fps_window_start
            if elapsed >= 1.0:
                self.status["fps"] = round(fps_counter / elapsed, 2)

                if self.source_type != "youtube" and fps_counter == 0 and (now - last_success_time) > 5.0 and self.is_running:
                    self._log(f"FPS dropped to 0 for 5s. Triggering watchdog reconnect.")
                    failure_count = 11

                fps_counter = 0
                fps_window_start = now

            # WATCHDOG: Reconnect logic
            if self.source_type == "youtube":
                continue

            if failure_count > failure_limit:
                self.status["is_connected"] = False
                self.status["fps"] = 0.0
                self._emit_status()
                self._log(f"Watchdog triggered: camera {self.source_type} failed repeatedly ({failure_count} consecutive misses).")

                source_type = self.source_type
                source_kwargs = dict(self.source_kwargs)

                if source_type is None:
                    self._log("no previous source for watchdog to recover")
                    time.sleep(5)
                    failure_count = 0
                    continue

                self._log(f"attempting watchdog reconnect to {source_type} in 5 seconds...")
                time.sleep(5)

                if not self.is_running:
                    break

                success = self.start(source_type, **source_kwargs)
                if success:
                    self._log("watchdog reconnect successful")
                    return # start() launched its own thread, this one must exit
                else:
                    self._log("watchdog reconnect failed, will retry...")
                    failure_count = 0 # reset to retry after next 10 failures or just continue loop
                    last_success_time = time.time() # don't spam reconnects too fast

        self._log("capture loop stopped")

    def get_frame(self) -> np.ndarray | None:
        with self.frame_lock:
            if self.latest_frame is None:
                return None
            return self.latest_frame.copy()

    def get_frame_base64(self) -> str | None:
        frame = self.get_frame()
        if frame is None:
            return None

        try:
            ok, buffer = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
            if not ok:
                return None
            return base64.b64encode(buffer).decode("utf-8")
        except Exception as exc:
            self._log(f"frame encode error: {exc}")
            return None

    def stop(self) -> None:
        self.is_running = False

        thread = self.capture_thread
        if thread and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout=1.5)

        if self.cap is not None:
            try:
                self.cap.release()
            except Exception as exc:
                self._log(f"release error: {exc}")

        if self.vidgear_stream is not None:
            try:
                self.vidgear_stream.stop()
            except Exception as exc:
                self._log(f"VidGear stop error: {exc}")

        self.cap = None
        self.vidgear_stream = None
        self.capture_thread = None
        self.youtube_original = None
        self.youtube_is_live = False
        self.youtube_duration = 0
        self.yt_fps = 25.0
        self.yt_last_frame_time = 0.0

        self.status["is_connected"] = False
        self.status["fps"] = 0.0
        self._emit_status()
        self._log("camera stopped")

    def switch_source(self, source_type: str, **kwargs: Any) -> bool:
        self._log(f"switching source to {source_type}")
        result = self.start(source_type, **kwargs)
        self._emit_status()
        return result

    def get_last_error(self) -> str | None:
        return self.last_error

    def get_status(self) -> dict[str, Any]:
        return {
            "source_type": self.status.get("source_type"),
            "is_connected": bool(self.status.get("is_connected", False)),
            "fps": float(self.status.get("fps", 0.0)),
            "camera_name": self.status.get("camera_name", "No Camera"),
            "resolution": self.status.get("resolution", "-"),
            "last_frame_time": self.status.get("last_frame_time"),
        }

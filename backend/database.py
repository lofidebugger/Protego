"""
Protego database module.

This file is the single interface between backend runtime logic and Supabase.
All reads/writes for incidents, settings, contacts, and analytics should go through
this module.

Supabase SQL setup (run in Supabase SQL editor):

-- incidents table
create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  incident_type text not null,
  feature_name text not null,
  location text not null,
  camera_name text,
  camera_id text,
  severity_score integer not null,
  gemini_description text,
  vehicle_plates text[] default '{}',
  authority_alerted text[] default '{}',
  screenshot text,
  telegram_status text,
  whatsapp_status text,
  email_status text,
  crowd_density double precision,
  escape_direction text,
  created_at timestamptz not null default now()
);

-- cameras table
create table if not exists public.cameras (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source_type text not null,
  ip_address text,
  youtube_url text,
  location_name text not null,
  latitude double precision not null,
  longitude double precision not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

-- contacts table
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  authority_type text not null,
  email text not null,
  whatsapp_number text not null,
  latitude double precision not null,
  longitude double precision not null,
  created_at timestamptz not null default now()
);

-- preferences table
create table if not exists public.preferences (
  id uuid primary key default gen_random_uuid(),
  min_severity integer not null default 4,
  duplicate_cooldown integer not null default 30,
  telegram_enabled boolean not null default true,
  whatsapp_enabled boolean not null default true,
  email_enabled boolean not null default true,
  feature_settings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
"""

from __future__ import annotations

import csv
import io
import os
import uuid
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from datetime import datetime, timezone
from typing import Any

from dotenv import load_dotenv
from supabase import create_client


FEATURE_NAMES = [
    "Distress & Assault Detection",
    "Road Accident Detection",
    "Medical Emergency Detection",
    "Stampede Prediction",
    "Kidnapping & Loitering",
    "Illegal Dumping Detection",
    "Reckless Driving",
    "Early Fire Detection",
]

DEFAULT_CONTACTS = [
    {
        "name": "KIMS Hospital",
        "authority_type": "hospital",
        "email": "kims.demo@protego.local",
        "whatsapp_number": "+919000000001",
        "latitude": 17.4234,
        "longitude": 78.4567,
    },
    {
        "name": "Apollo Hospital Jubilee Hills",
        "authority_type": "hospital",
        "email": "apollo.demo@protego.local",
        "whatsapp_number": "+919000000002",
        "latitude": 17.4156,
        "longitude": 78.4159,
    },
    {
        "name": "Gachibowli Police Station",
        "authority_type": "police",
        "email": "gachibowli.police@protego.local",
        "whatsapp_number": "+919000000003",
        "latitude": 17.4401,
        "longitude": 78.3489,
    },
    {
        "name": "Madhapur Police Station",
        "authority_type": "police",
        "email": "madhapur.police@protego.local",
        "whatsapp_number": "+919000000004",
        "latitude": 17.4489,
        "longitude": 78.3879,
    },
    {
        "name": "Hyderabad Fire Station",
        "authority_type": "fire",
        "email": "hyderabad.fire@protego.local",
        "whatsapp_number": "+919000000005",
        "latitude": 17.3850,
        "longitude": 78.4867,
    },
    {
        "name": "GHMC Head Office",
        "authority_type": "municipal",
        "email": "ghmc.demo@protego.local",
        "whatsapp_number": "+919000000006",
        "latitude": 17.3800,
        "longitude": 78.4800,
    },
    {
        "name": "Cyberabad Traffic Police",
        "authority_type": "traffic",
        "email": "cyberabad.traffic@protego.local",
        "whatsapp_number": "+919000000007",
        "latitude": 17.4947,
        "longitude": 78.3996,
    },
]


def _utc_now_str() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


class Database:
    def __init__(self) -> None:
        load_dotenv()
        self.supabase_url = os.getenv("SUPABASE_URL", "").strip()
        # Support either key name. User requested SUPABASE_KEY in .env.
        self.supabase_key = os.getenv("SUPABASE_KEY", "").strip() or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        self.analytics_timeout_seconds = 4

        self.supabase = None
        self._last_query_error_log: float = 0.0  # for rate-limiting error logs
        # In-memory fallback — used when Supabase is not configured.
        # Data is lost on restart but everything works for demo.
        self.memory_store: dict[str, list] = {
            "incidents": [],
            "cameras": [],
            "contacts": [],
        }
        self._connect()

    def _connect(self) -> None:
        url = self.supabase_url
        key = self.supabase_key
        if not url or not key:
            self._log_error("supabase_env", "SUPABASE_URL or SUPABASE_KEY missing — running in memory mode (demo)")
            return
        if not url.startswith("https://"):
            self._log_error("supabase_url", f"Invalid URL format '{url}' — must start with https://. Running in memory mode.")
            return
        try:
            self.supabase = create_client(url, key)
            print(f"[{_utc_now_str()}] [database] ✅ Connected to Supabase")
            self._ensure_default_contacts()
        except Exception as exc:
            self._log_error("supabase_client_init", f"{exc} — running in memory mode")
            self.supabase = None

    def is_connected(self) -> bool:
        """Return True only when we have a live Supabase client."""
        return self.supabase is not None

    def _log_error(self, context: str, error: Any) -> None:
        print(f"[{_utc_now_str()}] [database:{context}] {error}")

    def _run_safe(self, fn: Any, default: Any, timeout: int | None = None) -> Any:
        if self.supabase is None:
            return default
        try:
            if timeout is None:
                return fn()
            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(fn)
                return future.result(timeout=timeout)
        except FuturesTimeoutError:
            self._log_error("timeout", f"operation exceeded {timeout}s")
            return default
        except Exception as exc:
            # Rate-limit query error logging: print at most once every 30 seconds
            now_ts = datetime.now(timezone.utc).timestamp()
            if now_ts - self._last_query_error_log > 30:
                self._log_error("query", exc)
                self._last_query_error_log = now_ts
            return default

    def _apply_common_filters(self, query: Any, filters: dict[str, Any]) -> Any:
        if filters.get("incident_type"):
            query = query.eq("incident_type", filters["incident_type"])
        if filters.get("severity_min") is not None:
            query = query.gte("severity_score", int(filters["severity_min"]))
        if filters.get("severity_max") is not None:
            query = query.lte("severity_score", int(filters["severity_max"]))
        if filters.get("date_from"):
            query = query.gte("created_at", filters["date_from"])
        if filters.get("date_to"):
            query = query.lte("created_at", filters["date_to"])
        if filters.get("location"):
            query = query.ilike("location", f"%{filters['location']}%")
        if filters.get("vehicle_plate"):
            query = query.contains("vehicle_plates", [filters["vehicle_plate"]])
        if filters.get("authority_type"):
            query = query.contains("authority_alerted", [filters["authority_type"]])
        return query

    def _default_feature_settings(self) -> list[dict[str, Any]]:
        rows = [
            {
                "feature_name": feature_name,
                "is_enabled": True,
                "severity_override": None,
            }
            for feature_name in FEATURE_NAMES
        ]
        rows.append(
            {
                "_meta": "demo_config",
                "demo_email": os.getenv("DEMO_EMAIL", "").strip(),
                "demo_phone": os.getenv("DEMO_PHONE", "").strip(),
                "show_real_institution_details": True,
            }
        )
        return rows

    def _extract_demo_config(self, feature_settings: Any) -> dict[str, Any]:
        if not isinstance(feature_settings, list):
            return {
                "demo_email": os.getenv("DEMO_EMAIL", "").strip(),
                "demo_phone": os.getenv("DEMO_PHONE", "").strip(),
                "show_real_institution_details": True,
            }
        for row in feature_settings:
            if isinstance(row, dict) and row.get("_meta") == "demo_config":
                return {
                    "demo_email": str(row.get("demo_email", os.getenv("DEMO_EMAIL", "").strip())),
                    "demo_phone": str(row.get("demo_phone", os.getenv("DEMO_PHONE", "").strip())),
                    "show_real_institution_details": bool(row.get("show_real_institution_details", True)),
                }
        return {
            "demo_email": os.getenv("DEMO_EMAIL", "").strip(),
            "demo_phone": os.getenv("DEMO_PHONE", "").strip(),
            "show_real_institution_details": True,
        }

    def _clean_feature_settings(self, feature_settings: Any) -> list[dict[str, Any]]:
        if not isinstance(feature_settings, list):
            return []
        return [
            row
            for row in feature_settings
            if isinstance(row, dict) and row.get("_meta") != "demo_config"
        ]

    def _ensure_default_contacts(self) -> None:
        def _task() -> None:
            response = self.supabase.table("contacts").select("id").limit(1).execute()
            existing = response.data or []
            if existing:
                return
            self.supabase.table("contacts").insert(DEFAULT_CONTACTS).execute()

        self._run_safe(_task, default=None)

    def _query_incidents_for_analytics(self, date_from: str | None, date_to: str | None) -> list[dict[str, Any]]:
        def _task() -> list[dict[str, Any]]:
            query = self.supabase.table("incidents").select("*")
            if date_from:
                query = query.gte("created_at", date_from)
            if date_to:
                query = query.lte("created_at", date_to)
            response = query.execute()
            return response.data or []

        return self._run_safe(_task, default=[], timeout=self.analytics_timeout_seconds)

    # Incident methods
    def save_incident(self, alert_object: dict[str, Any]) -> dict[str, Any] | None:
        def _task() -> dict[str, Any] | None:
            channels = alert_object.get("alert_channels", {}) or {}
            payload = {
                "incident_type": alert_object.get("incident_type", ""),
                "feature_name": alert_object.get("feature_name", alert_object.get("incident_type", "")),
                "location": alert_object.get("location", ""),
                "camera_name": alert_object.get("camera_name", ""),
                "camera_id": alert_object.get("camera_id", ""),
                "severity_score": int(alert_object.get("severity_score", 0)),
                "gemini_description": alert_object.get("gemini_description", ""),
                "vehicle_plates": alert_object.get("vehicle_plates", []) or [],
                "authority_alerted": alert_object.get("authority_alerted", []) or [],
                "screenshot": alert_object.get("screenshot", ""),
                "telegram_status": channels.get("telegram"),
                "whatsapp_status": channels.get("sms", channels.get("whatsapp")),
                "email_status": channels.get("email"),
                "crowd_density": alert_object.get("crowd_density"),
                "escape_direction": alert_object.get("escape_direction"),
            }
            response = self.supabase.table("incidents").insert(payload).execute()
            rows = response.data or []
            return rows[0] if rows else None

        return self._run_safe(_task, default=None)

    def get_incidents(self, filters: dict[str, Any]) -> dict[str, Any]:
        page = max(1, int(filters.get("page", 1) or 1))
        limit = max(1, min(200, int(filters.get("limit", 20) or 20)))
        start = (page - 1) * limit
        end = start + limit - 1

        def _task() -> dict[str, Any]:
            base_query = self.supabase.table("incidents").select("*", count="exact")
            base_query = self._apply_common_filters(base_query, filters)
            response = base_query.order("created_at", desc=True).range(start, end).execute()
            return {
                "incidents": response.data or [],
                "total_count": response.count or 0,
                "page": page,
                "limit": limit,
            }

        return self._run_safe(_task, default={"incidents": [], "total_count": 0, "page": page, "limit": limit})

    def get_incident_by_id(self, incident_id: str) -> dict[str, Any] | None:
        def _task() -> dict[str, Any] | None:
            response = self.supabase.table("incidents").select("*").eq("id", incident_id).limit(1).execute()
            rows = response.data or []
            return rows[0] if rows else None

        return self._run_safe(_task, default=None)

    def get_recent_by_feature(self) -> dict[str, dict[str, Any] | None]:
        result: dict[str, dict[str, Any] | None] = {feature_name: None for feature_name in FEATURE_NAMES}

        def _task() -> dict[str, dict[str, Any] | None]:
            for feature_name in FEATURE_NAMES:
                response = (
                    self.supabase.table("incidents")
                    .select("*")
                    .eq("feature_name", feature_name)
                    .order("created_at", desc=True)
                    .limit(1)
                    .execute()
                )
                rows = response.data or []
                result[feature_name] = rows[0] if rows else None
            return result

        return self._run_safe(_task, default=result)

    def get_today_stats(self) -> dict[str, int]:
        today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()

        def _task() -> dict[str, int]:
            response = (
                self.supabase.table("incidents")
                .select("severity_score,authority_alerted")
                .gte("created_at", today_start)
                .execute()
            )
            rows = response.data or []
            authorities: set[str] = set()
            high_count = 0
            for row in rows:
                if int(row.get("severity_score", 0)) >= 7:
                    high_count += 1
                for authority in row.get("authority_alerted", []) or []:
                    authorities.add(authority)
            return {
                "total_count": len(rows),
                "high_severity_count": high_count,
                "unique_authorities_count": len(authorities),
            }

        return self._run_safe(_task, default={"total_count": 0, "high_severity_count": 0, "unique_authorities_count": 0})

    def export_incidents_csv(self, filters: dict[str, Any]) -> str:
        data = self.get_incidents({**filters, "page": 1, "limit": 10000}).get("incidents", [])
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(
            [
                "id",
                "incident_type",
                "feature_name",
                "location",
                "camera_name",
                "severity_score",
                "vehicle_plates",
                "authority_alerted",
                "telegram_status",
                "whatsapp_status",
                "email_status",
                "created_at",
            ]
        )
        for row in data:
            writer.writerow(
                [
                    row.get("id"),
                    row.get("incident_type"),
                    row.get("feature_name"),
                    row.get("location"),
                    row.get("camera_name"),
                    row.get("severity_score"),
                    ", ".join(row.get("vehicle_plates", []) or []),
                    ", ".join(row.get("authority_alerted", []) or []),
                    row.get("telegram_status"),
                    row.get("whatsapp_status"),
                    row.get("email_status"),
                    row.get("created_at"),
                ]
            )
        return output.getvalue()

    # Analytics methods
    def get_analytics_summary(self, date_from: str | None, date_to: str | None) -> dict[str, Any]:
        rows = self._query_incidents_for_analytics(date_from, date_to)
        if not rows:
            return {
                "total_count": 0,
                "count_by_type": {},
                "most_common_type": None,
                "busiest_location": None,
                "average_severity": 0,
            }

        type_counter = Counter(row.get("incident_type", "Unknown") for row in rows)
        location_counter = Counter(row.get("location", "Unknown") for row in rows)
        avg_severity = round(sum(int(row.get("severity_score", 0)) for row in rows) / max(1, len(rows)), 2)

        return {
            "total_count": len(rows),
            "count_by_type": dict(type_counter),
            "most_common_type": type_counter.most_common(1)[0][0] if type_counter else None,
            "busiest_location": location_counter.most_common(1)[0][0] if location_counter else None,
            "average_severity": avg_severity,
        }

    def get_by_type(self, date_from: str | None, date_to: str | None) -> list[dict[str, Any]]:
        rows = self._query_incidents_for_analytics(date_from, date_to)
        counter = Counter(row.get("feature_name", "Unknown") for row in rows)
        return [{"feature_name": name, "count": count} for name, count in counter.items()]

    def get_over_time(self, date_from: str | None, date_to: str | None) -> list[dict[str, Any]]:
        rows = self._query_incidents_for_analytics(date_from, date_to)
        counter: dict[str, int] = defaultdict(int)
        for row in rows:
            dt = _parse_timestamp(row.get("created_at"))
            if dt is None:
                continue
            day_key = dt.strftime("%Y-%m-%d")
            counter[day_key] += 1
        return [{"date": date_key, "count": counter[date_key]} for date_key in sorted(counter.keys())]

    def get_severity_distribution(self, date_from: str | None, date_to: str | None) -> dict[str, int]:
        rows = self._query_incidents_for_analytics(date_from, date_to)
        result = {"low": 0, "medium": 0, "high": 0}
        for row in rows:
            score = int(row.get("severity_score", 0))
            if score >= 7:
                result["high"] += 1
            elif score >= 4:
                result["medium"] += 1
            else:
                result["low"] += 1
        return result

    def get_peak_hours(self, date_from: str | None, date_to: str | None) -> list[list[int]]:
        rows = self._query_incidents_for_analytics(date_from, date_to)
        matrix = [[0] * 24 for _ in range(7)]
        for row in rows:
            dt = _parse_timestamp(row.get("created_at"))
            if dt is None:
                continue
            matrix[dt.weekday()][dt.hour] += 1
        return matrix

    def get_by_location(self, date_from: str | None, date_to: str | None) -> list[dict[str, Any]]:
        rows = self._query_incidents_for_analytics(date_from, date_to)
        counter = Counter(row.get("location", "Unknown") for row in rows)
        top = counter.most_common(10)
        return [{"location": location, "count": count} for location, count in top]

    def get_delivery_stats(self, date_from: str | None, date_to: str | None) -> dict[str, dict[str, Any]]:
        rows = self._query_incidents_for_analytics(date_from, date_to)

        def _rate(sent: int, total: int) -> int:
            if total == 0:
                return 0
            return int(round((sent / total) * 100))

        stats: dict[str, dict[str, int]] = {
            "telegram": {"sent": 0, "failed": 0, "total": 0},
            "whatsapp": {"sent": 0, "failed": 0, "total": 0},
            "email": {"sent": 0, "failed": 0, "total": 0},
        }

        for row in rows:
            for channel in ["telegram", "whatsapp", "email"]:
                status = row.get(f"{channel}_status")
                if status in ["sent", "failed"]:
                    stats[channel]["total"] += 1
                    stats[channel][status] += 1

        return {
            channel: {
                **values,
                "success_rate": _rate(values["sent"], values["total"]),
            }
            for channel, values in stats.items()
        }

    def get_authority_stats(self, date_from: str | None, date_to: str | None) -> list[dict[str, Any]]:
        rows = self._query_incidents_for_analytics(date_from, date_to)
        grouped: dict[str, dict[str, Any]] = {}
        for row in rows:
            for authority in row.get("authority_alerted", []) or []:
                if authority not in grouped:
                    grouped[authority] = {
                        "authority_name": authority,
                        "count": 0,
                        "incident_types": set(),
                    }
                grouped[authority]["count"] += 1
                grouped[authority]["incident_types"].add(row.get("incident_type", "Unknown"))

        result = []
        for _, value in grouped.items():
            result.append(
                {
                    "authority_name": value["authority_name"],
                    "count": value["count"],
                    "incident_types": sorted(list(value["incident_types"])),
                }
            )
        result.sort(key=lambda item: item["count"], reverse=True)
        return result

    # Settings methods
    def get_cameras(self) -> list[dict[str, Any]]:
        def _task() -> list[dict[str, Any]]:
            response = self.supabase.table("cameras").select("*").order("created_at", desc=True).execute()
            return response.data or []

        return self._run_safe(_task, default=[])

    def save_camera(self, camera_data: dict[str, Any]) -> dict[str, Any] | None:
        def _task() -> dict[str, Any] | None:
            payload = {
                "id": camera_data.get("id") or str(uuid.uuid4()),
                "name": camera_data.get("name"),
                "source_type": camera_data.get("source_type"),
                "ip_address": camera_data.get("ip_address"),
                "youtube_url": camera_data.get("youtube_url"),
                "location_name": camera_data.get("location_name"),
                "latitude": float(camera_data.get("latitude", 0)),
                "longitude": float(camera_data.get("longitude", 0)),
                "is_active": bool(camera_data.get("is_active", False)),
            }

            if payload["is_active"]:
                self.supabase.table("cameras").update({"is_active": False}).neq("id", payload["id"]).execute()

            response = self.supabase.table("cameras").upsert(payload).execute()
            rows = response.data or []
            return rows[0] if rows else None

        return self._run_safe(_task, default=None)

    def delete_camera(self, camera_id: str) -> bool:
        def _task() -> bool:
            self.supabase.table("cameras").delete().eq("id", camera_id).execute()
            return True

        return self._run_safe(_task, default=False)

    def get_contacts(self) -> list[dict[str, Any]]:
        def _task() -> list[dict[str, Any]]:
            response = self.supabase.table("contacts").select("*").order("authority_type").execute()
            return response.data or []

        return self._run_safe(_task, default=[])

    def save_contact(self, contact_data: dict[str, Any]) -> dict[str, Any] | None:
        def _task() -> dict[str, Any] | None:
            payload = {
                "id": contact_data.get("id") or str(uuid.uuid4()),
                "name": contact_data.get("name"),
                "authority_type": contact_data.get("authority_type"),
                "email": contact_data.get("email"),
                "whatsapp_number": contact_data.get("whatsapp_number"),
                "latitude": float(contact_data.get("latitude", 0)),
                "longitude": float(contact_data.get("longitude", 0)),
            }
            response = self.supabase.table("contacts").upsert(payload).execute()
            rows = response.data or []
            return rows[0] if rows else None

        return self._run_safe(_task, default=None)

    def delete_contact(self, contact_id: str) -> bool:
        def _task() -> bool:
            self.supabase.table("contacts").delete().eq("id", contact_id).execute()
            return True

        return self._run_safe(_task, default=False)

    def get_preferences(self) -> dict[str, Any] | None:
        default_payload = {
            "id": str(uuid.uuid4()),
            "min_severity": 4,
            "duplicate_cooldown": 30,
            "telegram_enabled": True,
            "whatsapp_enabled": True,
            "email_enabled": True,
            "feature_settings": self._default_feature_settings(),
        }

        def _task() -> dict[str, Any] | None:
            response = self.supabase.table("preferences").select("*").limit(1).execute()
            rows = response.data or []
            if rows:
                row = rows[0]
                row["demo_config"] = self._extract_demo_config(row.get("feature_settings", []))
                row["feature_settings"] = self._clean_feature_settings(row.get("feature_settings", []))
                row["demo_email"] = row["demo_config"].get("demo_email")
                row["demo_phone"] = row["demo_config"].get("demo_phone")
                row["show_real_institution_details"] = row["demo_config"].get("show_real_institution_details", True)
                return row
            created = self.supabase.table("preferences").insert(default_payload).execute()
            created_rows = created.data or []
            row = created_rows[0] if created_rows else default_payload
            row["demo_config"] = self._extract_demo_config(row.get("feature_settings", []))
            row["feature_settings"] = self._clean_feature_settings(row.get("feature_settings", []))
            row["demo_email"] = row["demo_config"].get("demo_email")
            row["demo_phone"] = row["demo_config"].get("demo_phone")
            row["show_real_institution_details"] = row["demo_config"].get("show_real_institution_details", True)
            return row

        return self._run_safe(_task, default=None)

    def save_preferences(self, preferences_data: dict[str, Any]) -> dict[str, Any] | None:
        def _task() -> dict[str, Any] | None:
            existing = self.get_preferences() or {}
            pref_id = preferences_data.get("id") or existing.get("id") or str(uuid.uuid4())

            existing_features = existing.get("feature_settings", [])
            incoming_features = preferences_data.get("feature_settings", preferences_data.get("features", existing_features))
            demo_existing = self._extract_demo_config(existing.get("feature_settings", []))
            demo_config = {
                "_meta": "demo_config",
                "demo_email": str(preferences_data.get("demo_email", demo_existing.get("demo_email", os.getenv("DEMO_EMAIL", "").strip()))),
                "demo_phone": str(preferences_data.get("demo_phone", demo_existing.get("demo_phone", os.getenv("DEMO_PHONE", "").strip()))),
                "show_real_institution_details": bool(preferences_data.get("show_real_institution_details", demo_existing.get("show_real_institution_details", True))),
            }
            clean_features = self._clean_feature_settings(incoming_features)
            merged_feature_settings = clean_features + [demo_config]

            payload = {
                "id": pref_id,
                "min_severity": int(
                    preferences_data.get("min_severity", preferences_data.get("minimum_severity_threshold", existing.get("min_severity", 4)))
                ),
                "duplicate_cooldown": int(
                    preferences_data.get(
                        "duplicate_cooldown",
                        preferences_data.get("duplicate_alert_cooldown_seconds", existing.get("duplicate_cooldown", 30)),
                    )
                ),
                "telegram_enabled": bool(
                    preferences_data.get(
                        "telegram_enabled",
                        preferences_data.get("channels", {}).get("telegram", existing.get("telegram_enabled", True)),
                    )
                ),
                "whatsapp_enabled": bool(
                    preferences_data.get(
                        "whatsapp_enabled",
                        preferences_data.get("channels", {}).get("sms", preferences_data.get("channels", {}).get("whatsapp", existing.get("whatsapp_enabled", True))),
                    )
                ),
                "email_enabled": bool(
                    preferences_data.get(
                        "email_enabled",
                        preferences_data.get("channels", {}).get("email", existing.get("email_enabled", True)),
                    )
                ),
                "feature_settings": merged_feature_settings,
            }

            response = self.supabase.table("preferences").upsert(payload).execute()
            rows = response.data or []
            row = rows[0] if rows else None
            if row:
                row["demo_config"] = self._extract_demo_config(row.get("feature_settings", []))
                row["feature_settings"] = self._clean_feature_settings(row.get("feature_settings", []))
                row["demo_email"] = row["demo_config"].get("demo_email")
                row["demo_phone"] = row["demo_config"].get("demo_phone")
                row["show_real_institution_details"] = row["demo_config"].get("show_real_institution_details", True)
            return row

        return self._run_safe(_task, default=None)

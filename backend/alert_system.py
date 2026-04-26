from __future__ import annotations

import asyncio
import base64
import os
import re
import smtplib
import threading
import time
from datetime import datetime, timezone
from difflib import SequenceMatcher
from email.mime.image import MIMEImage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any

import requests
from dotenv import load_dotenv
from geopy.distance import geodesic
from telegram import Bot
from twilio.rest import Client as TwilioClient
from location_services import LocationServices

AUTHORITY_REQUIREMENTS: dict[str, list[str]] = {
    "Road Accident Detection": ["hospital", "police"],
    "Medical Emergency Detection": ["hospital"],
    "Distress & Assault Detection": ["police"],
    "Stampede Prediction": ["police", "municipal"],
    "Stampede Warning - Prediction": ["police", "municipal"],
    "Stampede Danger - Imminent": ["police", "municipal"],
    "Kidnapping & Loitering": ["police"],
    "Illegal Dumping Detection": ["municipal"],
    "Reckless Driving": ["traffic"],
    "Early Fire Detection": ["fire", "police"],
}

OVERPASS_QUERY_BY_TYPE: dict[str, str] = {
    "hospital": 'node["amenity"="hospital"]',
    "police": 'node["amenity"="police"]',
    "fire": 'node["amenity"="fire_station"]',
    "municipal": 'node["amenity"="townhall"]',
    "traffic": 'node["amenity"="police"]',
}

_FEATURE_SUBJECT: dict[str, str] = {
    "Distress & Assault Detection": "URGENT INCIDENT ALERT – POSSIBLE ASSAULT / DISTRESS SITUATION DETECTED",
    "Road Accident Detection": "URGENT INCIDENT ALERT – POSSIBLE ROAD ACCIDENT DETECTED",
    "Medical Emergency Detection": "URGENT INCIDENT ALERT – POSSIBLE MEDICAL EMERGENCY DETECTED",
    "Stampede Prediction": "URGENT INCIDENT ALERT – POTENTIAL STAMPEDE RISK DETECTED",
    "Stampede Warning - Prediction": "URGENT INCIDENT ALERT – POTENTIAL STAMPEDE RISK DETECTED",
    "Stampede Danger - Imminent": "URGENT INCIDENT ALERT – IMMINENT STAMPEDE DANGER DETECTED",
    "Kidnapping & Loitering": "URGENT INCIDENT ALERT – SUSPICIOUS ACTIVITY / POSSIBLE KIDNAPPING DETECTED",
    "Illegal Dumping Detection": "INCIDENT ALERT – ILLEGAL DUMPING ACTIVITY DETECTED",
    "Reckless Driving": "INCIDENT ALERT – RECKLESS DRIVING DETECTED",
    "Early Fire Detection": "URGENT INCIDENT ALERT – EARLY FIRE / SMOKE DETECTED",
}

_AUTH_DEPT: dict[str, str] = {
    "police": "State Police Department",
    "hospital": "Medical Services / Emergency Department",
    "fire": "Fire & Emergency Services Department",
    "municipal": "Municipal Corporation",
    "traffic": "Traffic Police Department",
}

_AUTH_EMOJI: dict[str, str] = {
    "police": "🚔",
    "hospital": "🏥",
    "fire": "🚒",
    "municipal": "🏛️",
    "traffic": "🚦",
}

_MAJOR_AUTHORITIES: dict[str, dict[str, list[dict[str, Any]]]] = {
    "hyderabad": {
        "hospital": [
            {
                "name": "NIMS Hyderabad",
                "email": "director@nims.edu.in",
                "phone": "040-23489000",
                "latitude": 17.4239,
                "longitude": 78.4510,
                "capability": "tertiary-care",
            },
            {
                "name": "Apollo Hospitals Jubilee Hills",
                "email": "enquiry_hyd@apollohospitals.com",
                "phone": "040-23607777",
                "latitude": 17.4168,
                "longitude": 78.4095,
                "capability": "multi-speciality-trauma",
            },
            {
                "name": "KIMS Hospitals Secunderabad",
                "email": "contact@kimshospitals.com",
                "phone": "040-44885000",
                "latitude": 17.4399,
                "longitude": 78.4983,
                "capability": "super-speciality",
            },
            {
                "name": "Yashoda Hospitals Secunderabad",
                "email": "info@yashodahospitals.com",
                "phone": "040-45674567",
                "latitude": 17.4417,
                "longitude": 78.4988,
                "capability": "critical-care",
            },
        ],
        "police": [
            {
                "name": "Hyderabad City Police Commissionerate",
                "email": "cp-hyd@tspolice.gov.in",
                "phone": "040-27852468",
                "latitude": 17.4031,
                "longitude": 78.4747,
                "capability": "city-command",
            },
            {
                "name": "Cyberabad Police Commissionerate",
                "email": "cp-cyberabad@tspolice.gov.in",
                "phone": "040-27852468",
                "latitude": 17.4307,
                "longitude": 78.3441,
                "capability": "metro-command",
            },
            {
                "name": "Telangana State Police Control Room",
                "email": "dgp@tspolice.gov.in",
                "phone": "040-27852485",
                "latitude": 17.4065,
                "longitude": 78.4691,
                "capability": "state-command",
            },
        ],
    },
    "default": {
        "hospital": [
            {
                "name": "District Government General Hospital",
                "email": "emergency@govhospital.in",
                "phone": "108",
                "latitude": 0.0,
                "longitude": 0.0,
                "capability": "general-emergency",
            }
        ],
        "police": [
            {
                "name": "District Police Control Room",
                "email": "controlroom@police.gov.in",
                "phone": "100",
                "latitude": 0.0,
                "longitude": 0.0,
                "capability": "district-command",
            }
        ],
    },
}

_CITY_HUBS: dict[str, dict[str, Any]] = {
    "hyderabad": {"name": "Hyderabad", "latitude": 17.3850, "longitude": 78.4867},
    "bengaluru": {"name": "Bengaluru", "latitude": 12.9716, "longitude": 77.5946},
    "chennai": {"name": "Chennai", "latitude": 13.0827, "longitude": 80.2707},
    "kochi": {"name": "Kochi", "latitude": 9.9312, "longitude": 76.2673},
    "coimbatore": {"name": "Coimbatore", "latitude": 11.0168, "longitude": 76.9558},
    "salem": {"name": "Salem", "latitude": 11.6643, "longitude": 78.1460},
}

_CITY_TOP_HOSPITALS: dict[str, list[dict[str, Any]]] = {
    "hyderabad": [
        {"name": "NIMS Hyderabad", "email": "director@nims.edu.in", "phone": "040-23489000", "latitude": 17.4239, "longitude": 78.4510, "capability": "tertiary-care"},
        {"name": "Apollo Hospitals Jubilee Hills", "email": "enquiry_hyd@apollohospitals.com", "phone": "040-23607777", "latitude": 17.4168, "longitude": 78.4095, "capability": "multi-speciality-trauma"},
    ],
    "bengaluru": [
        {"name": "Narayana Health City Bengaluru", "email": "info@narayanahealth.org", "phone": "080-71222222", "latitude": 12.8005, "longitude": 77.7067, "capability": "quaternary-care"},
        {"name": "Manipal Hospital Old Airport Road", "email": "customercare@manipalhospitals.com", "phone": "080-25024444", "latitude": 12.9582, "longitude": 77.6491, "capability": "multi-speciality-trauma"},
    ],
    "chennai": [
        {"name": "Apollo Hospital Greams Road Chennai", "email": "customercare@apollohospitals.com", "phone": "044-28290200", "latitude": 13.0636, "longitude": 80.2510, "capability": "tertiary-care"},
        {"name": "MIOT International Chennai", "email": "hospital@miotinternational.com", "phone": "044-42002288", "latitude": 13.0222, "longitude": 80.1864, "capability": "advanced-trauma"},
    ],
    "kochi": [
        {"name": "Aster Medcity Kochi", "email": "info@astermedcity.com", "phone": "0484-6699999", "latitude": 10.0443, "longitude": 76.2952, "capability": "tertiary-care"},
        {"name": "Rajagiri Hospital Kochi", "email": "info@rajagirihospital.com", "phone": "0484-2905000", "latitude": 10.0402, "longitude": 76.3551, "capability": "critical-care"},
    ],
    "coimbatore": [
        {"name": "Ganga Hospital Coimbatore", "email": "info@gangahospital.com", "phone": "0422-2485000", "latitude": 11.0051, "longitude": 76.9622, "capability": "advanced-trauma"},
        {"name": "PSG Hospitals Coimbatore", "email": "hospital@psgimsr.ac.in", "phone": "0422-4345353", "latitude": 11.0188, "longitude": 77.0023, "capability": "tertiary-care"},
    ],
    "salem": [
        {"name": "Gokulam Hospital Salem", "email": "care@gokulamhospital.com", "phone": "0427-3982000", "latitude": 11.6647, "longitude": 78.1468, "capability": "multi-speciality"},
        {"name": "Manipal Hospital Salem", "email": "customercare@manipalhospitals.com", "phone": "0427-7100000", "latitude": 11.6715, "longitude": 78.1369, "capability": "critical-care"},
    ],
}


class AlertSystem:
    def __init__(self, database: Any) -> None:
        load_dotenv()
        self.database = database

        self.telegram_token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
        self.telegram_chat_id = os.getenv("TELEGRAM_CHAT_ID", "").strip()
        self.telegram_bot = Bot(token=self.telegram_token) if self.telegram_token else None

        self.gmail_address = os.getenv("GMAIL_ADDRESS", "").strip()
        self.gmail_password = os.getenv("GMAIL_PASSWORD", "").strip()

        self.demo_email = os.getenv("DEMO_EMAIL", "").strip() or self.gmail_address
        self.demo_phone = os.getenv("DEMO_PHONE", "").strip()
        self.fast2sms_api_key = os.getenv("FAST2SMS_API_KEY", "").strip()

        self.serpapi_key = os.getenv("SERPAPI_API_KEY", "").strip()
        self.google_api_key = os.getenv("GOOGLE_CSE_API_KEY", "").strip()
        self.google_cse_id = os.getenv("GOOGLE_CSE_ID", "").strip()

        self.twilio_sid = os.getenv("TWILIO_ACCOUNT_SID", "").strip()
        self.twilio_token = os.getenv("TWILIO_AUTH_TOKEN", "").strip()
        self.twilio_phone = os.getenv("TWILIO_PHONE_NUMBER", "").strip()
        self.twilio_client = TwilioClient(self.twilio_sid, self.twilio_token) if self.twilio_sid and self.twilio_token else None
        self.google_places_api_key = os.getenv("GOOGLE_PLACES_API_KEY", "").strip()

        # Layer 4: Email rate limiting (Max 3/hour)
        self.emails_sent_this_hour = 0
        self.email_hour_start = time.time()

        self.location_services = LocationServices()
        self.contacts_cache: list[dict[str, Any]] = []
        self.contacts_json: list[dict[str, Any]] = []

        self.authority_cache: dict[str, dict[str, Any]] = {}
        self.email_cache: dict[str, str] = {}
        self.pending_popups: list[dict[str, Any]] = []
        self._popup_lock = threading.Lock()

        # Session overrides for hackathon judges
        self.session_email = None
        self.session_phone = None
        self.session_telegram_chat_id = None
        self.session_telegram_code = None  # Temporary code for /start verification

        self.load_contacts()
        self._load_contacts_json()

    def _log(self, message: str) -> None:
        ts = datetime.now(timezone.utc).isoformat()
        print(f"[{ts}] [alert] {message}")

    def _cache_key(self, latitude: float, longitude: float, authority_type: str) -> str:
        return f"{authority_type}:{round(latitude, 3)}:{round(longitude, 3)}"

    def _load_contacts_json(self) -> None:
        path = os.path.join(os.path.dirname(__file__), "contacts.json")
        if not os.path.exists(path):
            self.contacts_json = []
            return
        try:
            import json

            with open(path, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
            self.contacts_json = payload if isinstance(payload, list) else []
        except Exception as exc:
            self._log(f"contacts.json load failed: {exc}")
            self.contacts_json = []

    def _get_demo_config_from_db(self) -> dict[str, Any]:
        prefs = self.database.get_preferences() if self.database else None
        if not prefs:
            return {}
        return {
            "demo_email": prefs.get("demo_email"),
            "demo_phone": prefs.get("demo_phone"),
            "show_real_institution_details": prefs.get("show_real_institution_details", True),
        }

    def load_contacts(self) -> None:
        try:
            contacts = self.database.get_contacts() if self.database else []
            self.contacts_cache = contacts or []
            self._log(f"contacts loaded: {len(self.contacts_cache)}")
        except Exception as exc:
            self._log(f"load_contacts failed: {exc}")
            self.contacts_cache = []

    def reload_contacts(self) -> None:
        self.load_contacts()

    def register_session_contact(self, email: str | None = None, phone: str | None = None, telegram_chat_id: str | None = None) -> None:
        if email: self.session_email = str(email).strip()
        if phone: self.session_phone = str(phone).strip()
        if telegram_chat_id: self.session_telegram_chat_id = str(telegram_chat_id).strip()
        self._log(f"session contact registered: email={self.session_email}, phone={self.session_phone}, telegram={self.session_telegram_chat_id}")

    def get_nearby_emergency_services(self, lat: float, lng: float) -> list[dict[str, Any]]:
        if not lat or not lng:
            return []

        try:
            services: list[dict[str, Any]] = []

            if self.google_places_api_key:
                base_url = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
                details_url = "https://maps.googleapis.com/maps/api/place/details/json"
                service_types = ["hospital", "police", "fire_station"]

                for place_type in service_types:
                    response = requests.get(
                        base_url,
                        params={
                            "location": f"{lat},{lng}",
                            "radius": 5000,
                            "type": place_type,
                            "key": self.google_places_api_key,
                        },
                        timeout=20,
                    )
                    data = response.json() if response.status_code == 200 else {}
                    for place in (data.get("results") or [])[:5]:
                        place_lat = float((place.get("geometry") or {}).get("location", {}).get("lat", 0.0) or 0.0)
                        place_lng = float((place.get("geometry") or {}).get("location", {}).get("lng", 0.0) or 0.0)
                        if not place_lat or not place_lng:
                            continue

                        distance_km = geodesic((lat, lng), (place_lat, place_lng)).kilometers
                        phone = ""
                        address = str(place.get("vicinity") or place.get("formatted_address") or "").strip()
                        place_id = str(place.get("place_id") or "").strip()
                        if place_id:
                            details_resp = requests.get(
                                details_url,
                                params={
                                    "place_id": place_id,
                                    "fields": "formatted_phone_number,international_phone_number,name,formatted_address,website",
                                    "key": self.google_places_api_key,
                                },
                                timeout=20,
                            )
                            details = details_resp.json() if details_resp.status_code == 200 else {}
                            result = details.get("result", {}) or {}
                            phone = str(result.get("formatted_phone_number") or result.get("international_phone_number") or "").strip()
                            address = str(result.get("formatted_address") or address).strip()

                        services.append(
                            {
                                "name": str(place.get("name") or "Unknown").strip(),
                                "type": place_type,
                                "phone": phone,
                                "distance": round(distance_km, 2),
                                "google_maps_link": f"https://www.google.com/maps/search/?api=1&query={place_lat},{place_lng}",
                                "address": address,
                                "source": "Google Places",
                            }
                        )

            if not services:
                nearby = self.location_services.find_nearby_authorities(lat, lng, radius_meters=5000)
                for place_type in ["hospital", "police", "fire"]:
                    for place in (nearby.get(place_type, []) or [])[:5]:
                        place_lat = float((place.get("coordinates") or {}).get("lat", lat) or lat)
                        place_lng = float((place.get("coordinates") or {}).get("lon", lng) or lng)
                        services.append(
                            {
                                "name": str(place.get("name") or "Unknown").strip(),
                                "type": place_type,
                                "phone": str(place.get("phone") or place.get("emergency_phone") or "").strip(),
                                "distance": round(float(place.get("distance_km", 0.0) or 0.0), 2),
                                "google_maps_link": f"https://www.google.com/maps/search/?api=1&query={place_lat},{place_lng}",
                                "address": str(place.get("address") or "").strip(),
                                "source": "Overpass",
                            }
                        )

            services.sort(key=lambda item: float(item.get("distance", 999.0) or 999.0))
            return services[:10]
        except Exception as exc:
            self._log(f"nearby services lookup failed: {exc}")
            return []

    def get_contacts_by_type(self, authority_type: str) -> list[dict[str, Any]]:
        return [c for c in self.contacts_cache if str(c.get("authority_type", "")).lower() == authority_type.lower()]

    def match_contact_by_name(self, name: str, authority_type: str) -> dict[str, Any] | None:
        candidates = self.get_contacts_by_type(authority_type)
        if not candidates:
            return None

        target = (name or "").strip().lower()
        best = None
        best_score = -1.0
        for contact in candidates:
            cname = str(contact.get("name", "")).strip().lower()
            if not cname:
                continue
            words_a = set(target.split())
            words_b = set(cname.split())
            overlap = len(words_a.intersection(words_b))
            ratio = SequenceMatcher(None, target, cname).ratio()
            score = overlap * 2.0 + ratio
            if target in cname or cname in target:
                score += 1.0
            if score > best_score:
                best_score = score
                best = contact

        return best if best is not None else candidates[0]

    def _fallback_nearest_from_contacts(self, latitude: float, longitude: float, authority_type: str) -> list[dict[str, Any]]:
        contacts = self.get_contacts_by_type(authority_type)
        rows = []
        for contact in contacts:
            c_lat = float(contact.get("latitude", 0.0))
            c_lon = float(contact.get("longitude", 0.0))
            dist = geodesic((latitude, longitude), (c_lat, c_lon)).kilometers
            rows.append(
                {
                    "name": contact.get("name", "Unknown"),
                    "type": authority_type,
                    "email": contact.get("email", ""),
                    "real_email": contact.get("email", ""),
                    "sms": contact.get("whatsapp_number", ""),
                    "phone": contact.get("phone", "N/A"),
                    "distance_km": round(float(dist), 3),
                    "latitude": c_lat,
                    "longitude": c_lon,
                }
            )
        rows.sort(key=lambda x: x["distance_km"])
        return rows[:5]

    def _search_real_email(self, institution_name: str, authority_type: str) -> str:
        return None  # disabled

    def _contacts_json_by_type(self, authority_type: str) -> list[dict[str, Any]]:
        return [
            row for row in self.contacts_json
            if str(row.get("authority_type", "")).strip().lower() == authority_type.lower()
        ]

    def _match_contacts_json_by_name(self, name: str, authority_type: str) -> dict[str, Any] | None:
        candidates = self._contacts_json_by_type(authority_type)
        if not candidates:
            return None

        target = (name or "").strip().lower()
        best = None
        best_score = -1.0
        for contact in candidates:
            cname = str(contact.get("name", "")).strip().lower()
            if not cname:
                continue
            words_a = set(target.split())
            words_b = set(cname.split())
            overlap = len(words_a.intersection(words_b))
            ratio = SequenceMatcher(None, target, cname).ratio()
            score = overlap * 2.0 + ratio
            if target in cname or cname in target:
                score += 1.0
            if score > best_score:
                best_score = score
                best = contact

        return best if best_score >= 1.2 else None

    def _resolve_authority_contact(self, authority: dict[str, Any], authority_type: str) -> dict[str, Any]:
        resolved = dict(authority)
        db_match = self.match_contact_by_name(str(authority.get("name", "")), authority_type)
        json_match = self._match_contacts_json_by_name(str(authority.get("name", "")), authority_type)
        contact_match = db_match or json_match or {}

        email = str(
            contact_match.get("email")
            or authority.get("email")
            or authority.get("real_email")
            or ""
        ).strip()
        phone = str(contact_match.get("phone") or authority.get("phone") or "").strip()

        if email:
            resolved["email"] = email
            resolved["real_email"] = email
        if phone:
            resolved["phone"] = phone
        resolved["authority_type"] = authority_type
        return resolved

    def _pick_best_authorities(self, alert_object: dict[str, Any], nearby: dict[str, Any]) -> list[dict[str, Any]]:
        feature_name = str(alert_object.get("feature_name", ""))
        incident_type = str(alert_object.get("incident_type", ""))
        authority_types = AUTHORITY_REQUIREMENTS.get(feature_name) or AUTHORITY_REQUIREMENTS.get(incident_type) or ["police"]
        severity = int(alert_object.get("severity_score", 0) or 0)

        latitude = float(alert_object.get("camera_latitude", alert_object.get("latitude", 0.0)) or 0.0)
        longitude = float(alert_object.get("camera_longitude", alert_object.get("longitude", 0.0)) or 0.0)

        self._augment_with_major_authorities(alert_object, nearby, authority_types)

        ranked_by_type: dict[str, list[dict[str, Any]]] = {}
        for authority_type in authority_types:
            rows = nearby.get(authority_type, []) or []
            resolved_rows = [self._resolve_authority_contact(row, authority_type) for row in rows]
            ranked = sorted(
                resolved_rows,
                key=lambda row: self._score_authority(row, authority_type, severity, latitude, longitude),
                reverse=True,
            )
            ranked_by_type[authority_type] = ranked

        selections: list[dict[str, Any]] = []
        used_names: set[str] = set()
        for authority_type in authority_types:
            rows = ranked_by_type.get(authority_type, [])
            desired_count = 2 if severity >= 8 and authority_type in {"hospital", "police"} else 1
            picked = 0
            for resolved in rows:
                name = str(resolved.get("name", "")).strip().lower()
                if name and name not in used_names:
                    selections.append(resolved)
                    used_names.add(name)
                    picked += 1
                if picked >= desired_count:
                    break

        if selections:
            return selections

        fallback_types = ["police", "hospital", "fire"]
        for authority_type in fallback_types:
            rows = nearby.get(authority_type, []) or []
            for row in rows:
                resolved = self._resolve_authority_contact(row, authority_type)
                if resolved.get("name"):
                    return [resolved]

        return []

    def _infer_region_key(self, location_name: str) -> str:
        loc = (location_name or "").lower()
        if any(k in loc for k in ["hyderabad", "cyberabad", "secunderabad", "telangana"]):
            return "hyderabad"
        return "default"

    def _requires_advanced_backup(self, alert_object: dict[str, Any]) -> bool:
        severity = int(alert_object.get("severity_score", 0) or 0)
        incident = str(alert_object.get("incident_type", "")).lower()
        high_impact = ["accident", "fire", "stampede", "medical emergency", "assault", "kidnapping"]
        return severity >= 8 or any(token in incident for token in high_impact)

    def _build_major_reference_rows(
        self,
        latitude: float,
        longitude: float,
        authority_type: str,
        location_name: str,
    ) -> list[dict[str, Any]]:
        region_key = self._infer_region_key(location_name)
        region_rows = _MAJOR_AUTHORITIES.get(region_key, {})
        defaults = _MAJOR_AUTHORITIES.get("default", {})
        source_rows = list(region_rows.get(authority_type, [])) + list(defaults.get(authority_type, []))

        rows: list[dict[str, Any]] = []
        for row in source_rows:
            ref_lat = float(row.get("latitude", 0.0) or 0.0)
            ref_lon = float(row.get("longitude", 0.0) or 0.0)
            distance_km = 0.0
            if latitude and longitude and ref_lat and ref_lon:
                distance_km = geodesic((latitude, longitude), (ref_lat, ref_lon)).kilometers

            rows.append(
                {
                    "name": row.get("name", "Major Authority"),
                    "type": authority_type,
                    "authority_type": authority_type,
                    "distance_km": round(float(distance_km), 3),
                    "phone": row.get("phone", ""),
                    "email": row.get("email", ""),
                    "real_email": row.get("email", ""),
                    "latitude": ref_lat,
                    "longitude": ref_lon,
                    "is_major_fallback": True,
                    "capability": row.get("capability", "standard"),
                }
            )
        return rows

    def _hospital_capability_boost(self, row: dict[str, Any]) -> float:
        name = str(row.get("name", "")).lower()
        capability = str(row.get("capability", "")).lower()
        boost = 0.0
        strong_tokens = ["apollo", "kims", "yashoda", "nims", "medical college", "trauma", "super", "critical"]
        if any(token in name for token in strong_tokens):
            boost += 2.8
        if any(token in capability for token in ["tertiary", "trauma", "super", "critical"]):
            boost += 2.2
        return boost

    def _police_capability_boost(self, row: dict[str, Any]) -> float:
        name = str(row.get("name", "")).lower()
        capability = str(row.get("capability", "")).lower()
        boost = 0.0
        if any(token in name for token in ["commissionerate", "control room", "headquarters", "command"]):
            boost += 2.3
        if any(token in capability for token in ["city-command", "state-command", "metro-command"]):
            boost += 1.7
        return boost

    def _score_authority(
        self,
        row: dict[str, Any],
        authority_type: str,
        severity: int,
        latitude: float,
        longitude: float,
    ) -> float:
        distance = float(row.get("distance_km", 999.0) or 999.0)
        if (not distance or distance >= 999.0) and latitude and longitude and row.get("latitude") and row.get("longitude"):
            try:
                distance = geodesic((latitude, longitude), (float(row.get("latitude")), float(row.get("longitude")))).kilometers
            except Exception:
                distance = 999.0

        has_email = bool(str(row.get("email", "")).strip() or str(row.get("real_email", "")).strip())
        has_phone = bool(str(row.get("phone", "")).strip())

        # Distance matters, but capability becomes more important for severe incidents.
        distance_score = max(0.0, 12.0 - min(distance, 60.0) * 0.2)
        contact_score = (3.0 if has_email else 0.0) + (1.4 if has_phone else 0.0)
        capability_score = 0.0
        if authority_type == "hospital":
            capability_score += self._hospital_capability_boost(row)
            if severity >= 8:
                capability_score *= 1.5
        if authority_type == "police":
            capability_score += self._police_capability_boost(row)
            if severity >= 8:
                capability_score *= 1.35

        fallback_bonus = 1.2 if bool(row.get("is_major_fallback")) and severity >= 7 else 0.0
        return distance_score + contact_score + capability_score + fallback_bonus

    def _augment_with_major_authorities(
        self,
        alert_object: dict[str, Any],
        nearby: dict[str, Any],
        authority_types: list[str],
    ) -> None:
        latitude = float(alert_object.get("camera_latitude", alert_object.get("latitude", 0.0)) or 0.0)
        longitude = float(alert_object.get("camera_longitude", alert_object.get("longitude", 0.0)) or 0.0)
        location_name = str(alert_object.get("location", ""))
        add_major = self._requires_advanced_backup(alert_object)

        for authority_type in authority_types:
            current_rows = nearby.get(authority_type, []) or []
            if authority_type not in {"hospital", "police"}:
                continue
            if not add_major and len(current_rows) >= 2:
                continue

            major_rows = self._build_major_reference_rows(latitude, longitude, authority_type, location_name)
            merged = list(current_rows)
            known_names = {str(row.get("name", "")).strip().lower() for row in merged}
            for major in major_rows:
                name = str(major.get("name", "")).strip().lower()
                if name and name not in known_names:
                    merged.append(major)
                    known_names.add(name)
            nearby[authority_type] = merged

    def _nearest_city_key(self, latitude: float, longitude: float) -> tuple[str, str, float]:
        if not latitude or not longitude:
            return "hyderabad", "Hyderabad", 0.0

        best_key = "hyderabad"
        best_city = "Hyderabad"
        best_distance = float("inf")
        for city_key, city in _CITY_HUBS.items():
            dist = geodesic((latitude, longitude), (float(city["latitude"]), float(city["longitude"]))).kilometers
            if dist < best_distance:
                best_distance = float(dist)
                best_key = city_key
                best_city = str(city["name"])
        return best_key, best_city, round(best_distance, 2)

    def _parse_beds_count(self, value: Any) -> int:
        raw = str(value or "").strip().lower()
        if not raw:
            return 0
        raw = raw.replace(",", "")
        m = re.search(r"\d+", raw)
        if not m:
            return 0
        try:
            return int(m.group(0))
        except Exception:
            return 0

    def _fetch_top_hospitals_overpass(
        self,
        latitude: float,
        longitude: float,
        radius_m: int = 50000,
        limit: int = 4,
    ) -> list[dict[str, Any]]:
        if not latitude or not longitude:
            return []

        query = f"""
[out:json][timeout:20];
(
  node["amenity"="hospital"](around:{radius_m},{latitude},{longitude});
  way["amenity"="hospital"](around:{radius_m},{latitude},{longitude});
  relation["amenity"="hospital"](around:{radius_m},{latitude},{longitude});
  node["healthcare"="hospital"](around:{radius_m},{latitude},{longitude});
  way["healthcare"="hospital"](around:{radius_m},{latitude},{longitude});
  relation["healthcare"="hospital"](around:{radius_m},{latitude},{longitude});
);
out center tags;
"""
        try:
            response = requests.post(
                "https://overpass-api.de/api/interpreter",
                data={"data": query},
                timeout=20,
            )
            if response.status_code != 200:
                return []

            data = response.json()
            elements = data.get("elements", []) or []
            candidates: list[dict[str, Any]] = []

            for el in elements:
                tags = el.get("tags", {}) or {}
                if el.get("type") == "node":
                    h_lat = float(el.get("lat", 0.0) or 0.0)
                    h_lon = float(el.get("lon", 0.0) or 0.0)
                else:
                    center = el.get("center", {}) or {}
                    h_lat = float(center.get("lat", 0.0) or 0.0)
                    h_lon = float(center.get("lon", 0.0) or 0.0)
                if not h_lat or not h_lon:
                    continue

                name = str(tags.get("name:en") or tags.get("name") or "Major Hospital").strip()
                beds = self._parse_beds_count(tags.get("beds"))
                emergency_flag = str(tags.get("emergency", "")).strip().lower() in {"yes", "true", "24/7", "designated"}
                name_l = name.lower()
                strong_name = any(token in name_l for token in ["medical college", "institute", "apollo", "aiims", "nims", "kims", "yashoda", "super", "multi-speciality", "trauma"])
                if not (beds >= 100 or emergency_flag or strong_name):
                    continue

                dist = geodesic((latitude, longitude), (h_lat, h_lon)).kilometers
                phone = str(tags.get("phone") or tags.get("contact:phone") or "108")
                capability = "tertiary-care" if beds >= 250 or strong_name else "general-emergency"
                score = (beds / 50.0) + (3.0 if emergency_flag else 0.0) + (2.0 if strong_name else 0.0) - (dist * 0.03)
                candidates.append(
                    {
                        "name": name,
                        "type": "hospital",
                        "authority_type": "hospital",
                        "email": str(tags.get("email") or tags.get("contact:email") or "").strip(),
                        "real_email": str(tags.get("email") or tags.get("contact:email") or "").strip(),
                        "phone": phone,
                        "distance_km": round(float(dist), 2),
                        "latitude": h_lat,
                        "longitude": h_lon,
                        "capability": capability,
                        "beds": beds,
                        "is_top_hospital": True,
                        "source": "osm-overpass-smart-filter",
                        "_rank": round(score, 3),
                    }
                )

            candidates.sort(key=lambda row: float(row.get("_rank", 0.0)), reverse=True)
            return candidates[:limit]
        except Exception as exc:
            self._log(f"top hospital overpass lookup failed: {exc}")
            return []

    def _augment_with_city_referral_hospitals(
        self,
        alert_object: dict[str, Any],
        nearby: dict[str, Any],
        force_include: bool = False,
    ) -> None:
        if "hospital" not in nearby:
            nearby["hospital"] = []

        should_include = force_include or self._requires_advanced_backup(alert_object)
        if not should_include:
            return

        latitude = float(alert_object.get("camera_latitude", alert_object.get("latitude", 0.0)) or 0.0)
        longitude = float(alert_object.get("camera_longitude", alert_object.get("longitude", 0.0)) or 0.0)
        local_top = self._fetch_top_hospitals_overpass(latitude, longitude, radius_m=50000, limit=4)
        city_key, city_name, city_distance = self._nearest_city_key(latitude, longitude)
        city_hospitals = _CITY_TOP_HOSPITALS.get(city_key, [])

        merged = list(nearby.get("hospital", []) or [])
        known_names = {str(row.get("name", "")).strip().lower() for row in merged}

        for row in local_top:
            name = str(row.get("name", "")).strip()
            lower_name = name.lower()
            if not name or lower_name in known_names:
                continue
            row_copy = dict(row)
            row_copy["referral_city"] = city_name
            row_copy["city_distance_km"] = city_distance
            merged.append(row_copy)
            known_names.add(lower_name)

        # City-level fallback remains useful if local major hospitals are sparse.
        if len(local_top) >= 2:
            nearby["hospital"] = merged
            return

        for row in city_hospitals:
            name = str(row.get("name", "")).strip()
            lower_name = name.lower()
            if not name or lower_name in known_names:
                continue

            dist = 0.0
            ref_lat = float(row.get("latitude", 0.0) or 0.0)
            ref_lon = float(row.get("longitude", 0.0) or 0.0)
            if latitude and longitude and ref_lat and ref_lon:
                dist = geodesic((latitude, longitude), (ref_lat, ref_lon)).kilometers

            merged.append(
                {
                    "name": name,
                    "type": "hospital",
                    "authority_type": "hospital",
                    "email": row.get("email", ""),
                    "real_email": row.get("email", ""),
                    "phone": row.get("phone", ""),
                    "distance_km": round(float(dist), 2),
                    "latitude": ref_lat,
                    "longitude": ref_lon,
                    "capability": row.get("capability", "tertiary-care"),
                    "is_city_referral": True,
                    "referral_city": city_name,
                    "city_distance_km": city_distance,
                }
            )
            known_names.add(lower_name)

        nearby["hospital"] = merged

    def _select_primary_authority(self, alert_object: dict[str, Any], selections: list[dict[str, Any]]) -> dict[str, Any]:
        if not selections:
            return {}

        incident = str(alert_object.get("incident_type", "")).lower()
        preferred_types = ["police", "hospital", "fire"]
        if any(token in incident for token in ["accident", "medical", "fire"]):
            preferred_types = ["hospital", "police", "fire"]

        best = None
        best_rank = -999
        for row in selections:
            row_type = str(row.get("authority_type") or row.get("type") or "police").lower()
            type_bias = 4 - preferred_types.index(row_type) if row_type in preferred_types else 0
            row_rank = type_bias + (3 if row.get("email") else 0) + (1 if row.get("phone") else 0)
            if bool(row.get("is_major_fallback")):
                row_rank += 1
            if row_rank > best_rank:
                best_rank = row_rank
                best = row
        return best or selections[0]

    def _severity_language(self, severity: int) -> tuple[str, str]:
        if severity >= 9:
            return "CRITICAL", "Immediate dispatch required with highest priority."
        if severity >= 7:
            return "HIGH", "Rapid response requested; situation may escalate."
        if severity >= 4:
            return "MODERATE", "Timely verification and response recommended."
        return "LOW", "Please verify and monitor as per standard protocol."

    def find_nearby_with_overpass(
        self, lat: float, lng: float, radius_m: int = 5000
    ) -> dict[str, Any]:
        """
        Find hospitals, police stations, fire stations near coordinates.
        Uses OpenStreetMap Overpass API. FREE. No API key. Works in villages!
        """
        import math

        try:
            query = f"""
[out:json][timeout:15];
(
  node["amenity"="hospital"](around:{radius_m},{lat},{lng});
  node["amenity"="police"](around:{radius_m},{lat},{lng});
  node["amenity"="fire_station"](around:{radius_m},{lat},{lng});
  node["amenity"="clinic"](around:{radius_m},{lat},{lng});
  node["amenity"="doctors"](around:{radius_m},{lat},{lng});
  way["amenity"="hospital"](around:{radius_m},{lat},{lng});
  way["amenity"="police"](around:{radius_m},{lat},{lng});
);
out center tags;
"""
            response = requests.post(
                "https://overpass-api.de/api/interpreter",
                data={"data": query},
                timeout=15,
            )

            if response.status_code != 200:
                return self._emergency_fallback()

            data = response.json()
            elements = data.get("elements", [])

            result: dict[str, Any] = {"hospital": [], "police": [], "fire": []}

            for el in elements:
                tags = el.get("tags", {})
                amenity = tags.get("amenity", "")

                if el["type"] == "node":
                    elat = el.get("lat", 0)
                    elng = el.get("lon", 0)
                else:
                    center = el.get("center", {})
                    elat = center.get("lat", 0)
                    elng = center.get("lon", 0)

                dist = self._haversine(lat, lng, elat, elng)

                name = (
                    tags.get("name:en")
                    or tags.get("name")
                    or amenity.replace("_", " ").title()
                )
                phone = (
                    tags.get("phone")
                    or tags.get("contact:phone")
                    or self._default_phone(amenity)
                )

                place = {
                    "name": name,
                    "type": amenity,
                    "distance_km": round(dist, 2),
                    "phone": phone,
                    "latitude": elat,
                    "longitude": elng,
                    "address": tags.get("addr:full", tags.get("addr:street", "")),
                }

                if amenity in ("hospital", "clinic", "doctors"):
                    result["hospital"].append(place)
                elif amenity == "police":
                    result["police"].append(place)
                elif amenity == "fire_station":
                    result["fire"].append(place)

            for key in result:
                result[key].sort(key=lambda x: x["distance_km"])
                result[key] = result[key][:3]

            total = sum(len(v) for v in result.values())
            if total == 0 and radius_m < 20000:
                self._log(f"[overpass] nothing in {radius_m}m, expanding...")
                return self.find_nearby_with_overpass(lat, lng, radius_m * 2)

            result["emergency_numbers"] = {
                "police": "100",
                "ambulance": "108",
                "fire": "101",
                "women": "1091",
                "unified": "112",
            }

            self._log(
                f"[overpass] found: {len(result['hospital'])} hospitals, "
                f"{len(result['police'])} police, {len(result['fire'])} fire"
            )
            return result

        except Exception as e:
            self._log(f"[overpass] error: {e}")
            return self._emergency_fallback()

    def _haversine(self, lat1: float, lng1: float, lat2: float, lng2: float) -> float:
        import math
        R = 6371
        dlat = math.radians(lat2 - lat1)
        dlng = math.radians(lng2 - lng1)
        a = (
            math.sin(dlat / 2) ** 2
            + math.cos(math.radians(lat1))
            * math.cos(math.radians(lat2))
            * math.sin(dlng / 2) ** 2
        )
        return R * 2 * math.asin(math.sqrt(a))

    def _default_phone(self, amenity: str) -> str:
        return {
            "police": "100",
            "hospital": "108",
            "clinic": "108",
            "fire_station": "101",
        }.get(amenity, "112")

    def _emergency_fallback(self) -> dict[str, Any]:
        return {
            "hospital": [],
            "police": [],
            "fire": [],
            "emergency_numbers": {
                "police": "100",
                "ambulance": "108",
                "fire": "101",
                "women": "1091",
                "unified": "112",
            },
        }

    def get_nearby_authorities(
        self,
        latitude: float,
        longitude: float,
        authority_types: list[str] | None = None,
    ) -> dict[str, Any]:
        nearby = self.find_nearby_with_overpass(latitude, longitude)
        alert_stub = {
            "severity_score": 8,
            "location": "",
            "camera_latitude": latitude,
            "camera_longitude": longitude,
        }
        self._augment_with_major_authorities(alert_stub, nearby, ["hospital", "police"])
        self._augment_with_city_referral_hospitals(alert_stub, nearby, force_include=True)

        for key in ["hospital", "police"]:
            rows = nearby.get(key, [])
            if not isinstance(rows, list):
                continue
            rows = sorted(rows, key=lambda row: float(row.get("distance_km", 999.0) or 999.0))
            nearby[key] = rows[:6]
        return nearby

    def find_nearest_authorities(self, latitude: float, longitude: float, authority_types: list[str]) -> list[dict[str, Any]]:
        nearby = self.find_nearby_with_overpass(latitude, longitude)
        nearest: list[dict[str, Any]] = []
        for authority_type in authority_types:
            rows = nearby.get(authority_type, [])
            if rows:
                nearest.append(rows[0])
        return nearest

    def search_major_authorities_tavily(
        self,
        location_str: str,
        city: str = "",
        state: str = "",
        latitude: float = 0.0,
        longitude: float = 0.0,
    ) -> dict[str, list[dict[str, Any]]]:
        try:
            import json

            cache = getattr(self, "_tavily_cache", {})
            if (
                cache.get("location") == location_str
                and time.time() - float(cache.get("timestamp", 0.0) or 0.0) < 1800
            ):
                print("[tavily] using cache!!")
                return cache.get("result", {"hospital": [], "police": []})

            google_result = self._google_places_major_authorities(latitude, longitude, location_str)
            if google_result.get("hospital") or google_result.get("police"):
                self._tavily_cache = {
                    "location": location_str,
                    "result": google_result,
                    "timestamp": time.time(),
                }
                print(f"[nearby-services] {len(google_result['hospital'])} hospitals, {len(google_result['police'])} police found!!")
                return google_result

            key = os.getenv("TAVILY_API_KEY", "")
            if not key:
                return google_result

            from tavily import TavilyClient

            search_loc = city or state or location_str
            client = TavilyClient(api_key=key)

            gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
            if not gemini_key:
                return {"hospital": [], "police": []}
            import google.generativeai as genai
            genai.configure(api_key=gemini_key)
            gemini_client = genai.GenerativeModel("gemini-2.5-flash")

            print(f"[tavily] searching: {search_loc}...")

            hosp = client.search(
                query=(
                    f"major hospitals {search_loc} India "
                    f"emergency phone number"
                ),
                search_depth="basic",
                max_results=5,
                include_answer=True,
            )

            police = client.search(
                query=(
                    f"main police station {search_loc} India "
                    f"contact phone number"
                ),
                search_depth="basic",
                max_results=5,
                include_answer=True,
            )

            prompt = f"""
Extract hospital and police station
info from these web search results.
Location: {search_loc}

HOSPITAL RESULTS:
{hosp.get('answer','')}
{str(hosp.get('results',[]))[:2000]}

POLICE RESULTS:
{police.get('answer','')}
{str(police.get('results',[]))[:2000]}

Return ONLY this exact JSON:
{{
  "hospitals": [
    {{
      "name": "Full Hospital Name",
      "phone": "phone number or empty string",
      "email": "email if found or empty",
      "type": "Government or Private",
      "address": "address if found"
    }}
  ],
  "police_stations": [
    {{
      "name": "Station Name",
      "phone": "phone number or empty",
      "email": "email if found or empty",
      "jurisdiction": "area name"
    }}
  ]
}}

Rules:
- Max 4 hospitals, 3 police stations
- Only real named institutions
- Prefer large/major/well-known ones
- If phone not found use empty string
- Return ONLY valid JSON nothing else
"""

            gemini_resp = gemini_client.generate_content(prompt)
            raw = (gemini_resp.text or "").strip()
            if "```" in raw:
                parts = raw.split("```")
                for part in parts:
                    part = part.strip()
                    if part.startswith("json"):
                        part = part[4:].strip()
                    if part.startswith("{"):
                        raw = part
                        break

            extracted = json.loads(raw)

            result: dict[str, list[dict[str, Any]]] = {
                "hospital": [],
                "police": [],
            }

            for h in extracted.get("hospitals", []):
                if not h.get("name"):
                    continue
                result["hospital"].append(
                    {
                        "name": h["name"],
                        "phone": h.get("phone", "") or "108",
                        "email": h.get("email", ""),
                        "type": h.get("type", "Hospital"),
                        "address": h.get("address", ""),
                        "source": "Web Search",
                        "has_real_phone": bool(h.get("phone")),
                    }
                )

            for p in extracted.get("police_stations", []):
                if not p.get("name"):
                    continue
                result["police"].append(
                    {
                        "name": p["name"],
                        "phone": p.get("phone", "") or "100",
                        "email": p.get("email", ""),
                        "jurisdiction": p.get("jurisdiction", ""),
                        "source": "Web Search",
                        "has_real_phone": bool(p.get("phone")),
                    }
                )

            self._tavily_cache = {
                "location": location_str,
                "result": result,
                "timestamp": time.time(),
            }

            print(
                f"[tavily] {len(result['hospital'])} hospitals, "
                f"{len(result['police'])} police found!!"
            )

            return result

        except Exception as e:
            print(f"[tavily] error: {e}")
            return {
                "hospital": [],
                "police": [],
            }

    def _google_places_major_authorities(
        self,
        latitude: float,
        longitude: float,
        location_label: str = "",
    ) -> dict[str, list[dict[str, Any]]]:
        if not latitude or not longitude:
            return {"hospital": [], "police": []}

        try:
            services = self.get_nearby_emergency_services(latitude, longitude)
            result: dict[str, list[dict[str, Any]]] = {"hospital": [], "police": []}

            for service in services:
                service_type = str(service.get("type", "")).lower()
                entry = {
                    "name": str(service.get("name", "Unknown")).strip(),
                    "phone": str(service.get("phone", "")).strip(),
                    "address": str(service.get("address", location_label) or location_label).strip(),
                    "distance_km": float(service.get("distance", 0.0) or 0.0),
                    "source": "Google Places",
                    "google_maps_link": str(service.get("google_maps_link", "")).strip(),
                    "has_real_phone": bool(service.get("phone")),
                }

                if service_type == "hospital":
                    result["hospital"].append(entry)
                elif service_type in {"police", "police_station"}:
                    result["police"].append(entry)

            for key in ("hospital", "police"):
                result[key] = sorted(result[key], key=lambda row: float(row.get("distance_km", 999.0) or 999.0))[:6]

            return result
        except Exception as exc:
            print(f"[google-places] error: {exc}")
            return {"hospital": [], "police": []}

    def search_nearest_city_authorities(
        self,
        full_address: str,
        city: str = "",
        state: str = "",
    ) -> dict[str, Any] | None:
        try:
            import json
            from tavily import TavilyClient

            key = os.getenv("TAVILY_API_KEY", "")
            if not key:
                return None

            cache = getattr(self, "_city_auth_cache", {})
            cache_key = full_address.strip().lower()
            if not cache_key:
                return None
            cached = cache.get(cache_key, {})
            if cached and time.time() - float(cached.get("ts", 0.0) or 0.0) < 1800:
                return cached.get("data")

            gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
            groq_key = os.getenv("GROQ_API_KEY", "").strip()

            def _safe_json_block(raw_text: str) -> dict[str, Any] | None:
                raw = (raw_text or "").strip()
                if not raw:
                    return None

                if "```" in raw:
                    parts = raw.split("```")
                    for part in parts:
                        part = part.strip()
                        if part.startswith("json"):
                            part = part[4:].strip()
                        if part.startswith("{"):
                            raw = part
                            break

                start = raw.find("{")
                end = raw.rfind("}")
                if start == -1 or end == -1 or end <= start:
                    return None

                try:
                    return json.loads(raw[start : end + 1])
                except Exception:
                    return None

            def _fallback_city_name() -> str:
                candidate = ", ".join(part for part in [city, state] if part).strip() or full_address.strip()
                if not candidate:
                    return "India"
                parts = [p.strip() for p in candidate.split(",") if p.strip()]
                if len(parts) >= 2:
                    return f"{parts[-2]}, {parts[-1]}"
                return parts[0]

            nearest_city = ""
            gemini_model = None
            if gemini_key:
                try:
                    import google.generativeai as genai

                    genai.configure(api_key=gemini_key)
                    gemini_model = genai.GenerativeModel("gemini-2.5-flash")
                    city_resp = gemini_model.generate_content(
                        f"""Given this location: {full_address}

Determine the best city to search
for major hospitals and emergency
services.

Rules:
- If the location IS a well-known
    city or town itself (like Palai,
    Kottayam, Thrissur, Ernakulam),
    use THAT city name directly
- If it is a village or small area,
    find the nearest large town or
    district headquarters
- Always prefer the most locally
    relevant city, not just the
    nearest metro

Reply with ONLY: CityName, State
Example: Palai, Kerala
Example: Kottayam, Kerala
Example: Ernakulam, Kerala
Nothing else!!"""
                    )
                    nearest_city = (city_resp.text or "").strip()
                except Exception as exc:
                    self._log(f"[city-auth] gemini city resolution failed: {exc}")

            if not nearest_city:
                nearest_city = _fallback_city_name()

            self._log(f"[city-auth] nearest city resolved: {nearest_city}")

            client = TavilyClient(api_key=key)
            hosp = client.search(
                query=(
                    f"top best hospitals in "
                    f"{nearest_city} "
                    f"emergency contact phone "
                    f"number address India"
                ),
                search_depth="advanced",
                max_results=7,
                include_answer=True,
                include_raw_content=False,
            )
            pol = client.search(
                query=(
                    f"police station "
                    f"{nearest_city} "
                    f"headquarters contact "
                    f"phone number India"
                ),
                search_depth="advanced",
                max_results=5,
                include_answer=True,
                include_raw_content=False,
            )

            prompt = f"""
You are extracting emergency
contact information.

Nearest major city: {nearest_city}

HOSPITAL SEARCH:
{hosp.get('answer', '')}
{str(hosp.get('results', []))[:2500]}

POLICE SEARCH:
{pol.get('answer', '')}
{str(pol.get('results', []))[:2000]}

Extract and return ONLY this JSON:
{{
  "nearest_city": "{nearest_city}",
  "hospitals": [
    {{
      "name": "Hospital Name",
      "phone": "number or empty",
      "email": "email or empty",
      "type": "Government/Private",
      "address": "address or empty",
      "speciality": "specialty or empty"
    }}
  ],
  "police_stations": [
    {{
      "name": "Station Name",
      "phone": "number or empty",
      "email": "email or empty",
      "address": "address or empty"
    }}
  ]
}}

Rules:
- Only include REAL named hospitals
    and police stations
- Max 5 hospitals, 3 police stations
- Strongly prefer large well-known
    institutions over small clinics
- For phone: include STD code if
    found (like 0482-123456)
- For email: only include if
    genuinely found in search results
- Search thoroughly for contact
    info - check hospital names
    in results carefully
- If Medicity, Medical College,
    District Hospital, or any major
    hospital name appears in results
    ALWAYS include it
- Return ONLY valid JSON!
"""

            data: dict[str, Any] | None = None

            if gemini_model is not None:
                try:
                    resp = gemini_model.generate_content(prompt)
                    data = _safe_json_block(getattr(resp, "text", "") or "")
                except Exception as exc:
                    self._log(f"[city-auth] gemini extraction failed: {exc}")

            if data is None and groq_key:
                try:
                    from groq import Groq

                    groq_client = Groq(api_key=groq_key)
                    groq_resp = groq_client.chat.completions.create(
                        model="llama-3.3-70b-versatile",
                        messages=[
                            {
                                "role": "system",
                                "content": "Return only valid JSON. No markdown. No explanation.",
                            },
                            {
                                "role": "user",
                                "content": prompt,
                            },
                        ],
                        temperature=0.1,
                        max_tokens=1400,
                    )
                    groq_text = ""
                    if groq_resp and getattr(groq_resp, "choices", None):
                        groq_text = str(groq_resp.choices[0].message.content or "")
                    data = _safe_json_block(groq_text)
                    if data is not None:
                        self._log("[city-auth] used Groq fallback for Tavily extraction")
                except Exception as exc:
                    self._log(f"[city-auth] groq extraction failed: {exc}")

            if data is None:
                data = {"nearest_city": nearest_city, "hospitals": [], "police_stations": []}

            result: dict[str, Any] = {
                "nearest_city": nearest_city,
                "hospitals": [],
                "police_stations": [],
            }

            for h in data.get("hospitals", []):
                if not h.get("name"):
                    continue
                result["hospitals"].append(
                    {
                        "name": h["name"],
                        "phone": h.get("phone", "") or "108",
                        "email": h.get("email", ""),
                        "type": h.get("type", "Hospital"),
                        "address": h.get("address", ""),
                        "speciality": h.get("speciality", ""),
                        "has_real_phone": bool(h.get("phone")),
                        "has_email": bool(h.get("email")),
                    }
                )

            for p in data.get("police_stations", []):
                if not p.get("name"):
                    continue
                result["police_stations"].append(
                    {
                        "name": p["name"],
                        "phone": p.get("phone", "") or "100",
                        "email": p.get("email", ""),
                        "address": p.get("address", ""),
                        "has_real_phone": bool(p.get("phone")),
                        "has_email": bool(p.get("email")),
                    }
                )

            # Guaranteed non-empty baseline so UI never shows a blank panel.
            if not result["hospitals"]:
                normalized = nearest_city.lower()
                city_key = ""
                for key_name in _CITY_TOP_HOSPITALS.keys():
                    if key_name in normalized:
                        city_key = key_name
                        break
                if city_key:
                    for row in _CITY_TOP_HOSPITALS.get(city_key, [])[:3]:
                        result["hospitals"].append(
                            {
                                "name": row.get("name", "Major Hospital"),
                                "phone": row.get("phone", "108"),
                                "email": row.get("email", ""),
                                "type": "Hospital",
                                "address": nearest_city,
                                "speciality": row.get("capability", ""),
                                "has_real_phone": bool(row.get("phone")),
                                "has_email": bool(row.get("email")),
                            }
                        )
                else:
                    result["hospitals"].append(
                        {
                            "name": f"District Government Hospital, {nearest_city}",
                            "phone": "108",
                            "email": "",
                            "type": "Government",
                            "address": nearest_city,
                            "speciality": "Emergency",
                            "has_real_phone": False,
                            "has_email": False,
                        }
                    )

            if not result["police_stations"]:
                fallback_police = _MAJOR_AUTHORITIES.get("hyderabad", {}).get("police", [])[:1]
                if fallback_police:
                    for row in fallback_police:
                        result["police_stations"].append(
                            {
                                "name": row.get("name", f"District Police Control Room, {nearest_city}"),
                                "phone": row.get("phone", "100"),
                                "email": row.get("email", ""),
                                "address": nearest_city,
                                "has_real_phone": bool(row.get("phone")),
                                "has_email": bool(row.get("email")),
                            }
                        )
                else:
                    result["police_stations"].append(
                        {
                            "name": f"District Police Control Room, {nearest_city}",
                            "phone": "100",
                            "email": "",
                            "address": nearest_city,
                            "has_real_phone": False,
                            "has_email": False,
                        }
                    )

            if not hasattr(self, "_city_auth_cache"):
                self._city_auth_cache = {}
            self._city_auth_cache[cache_key] = {
                "data": result,
                "ts": time.time(),
            }

            print(
                f"[tavily] city search done: {len(result['hospitals'])} hospitals, "
                f"{len(result['police_stations'])} police"
            )
            return result
        except Exception as e:
            print(f"[tavily-city] error: {e}")
            nearest_city = ", ".join(part for part in [city, state] if part).strip() or full_address or "Unknown"
            return {
                "nearest_city": nearest_city,
                "hospitals": [
                    {
                        "name": f"District Government Hospital, {nearest_city}",
                        "phone": "108",
                        "email": "",
                        "type": "Government",
                        "address": nearest_city,
                        "speciality": "Emergency",
                        "has_real_phone": False,
                        "has_email": False,
                    }
                ],
                "police_stations": [
                    {
                        "name": f"District Police Control Room, {nearest_city}",
                        "phone": "100",
                        "email": "",
                        "address": nearest_city,
                        "has_real_phone": False,
                        "has_email": False,
                    }
                ],
            }

    # Compatibility alias used by rules engine.
    def find_nearest(self, latitude: float, longitude: float, authority_types: list[str]) -> list[dict[str, Any]]:
        return self.find_nearest_authorities(latitude, longitude, authority_types)

    def _format_timestamp(self, value: str | None) -> str:
        if not value:
            return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return dt.strftime("%Y-%m-%d %H:%M:%S UTC")
        except Exception:
            return value

    def _get_subject_line(self, alert_object: dict[str, Any]) -> str:
        feature = str(alert_object.get("feature_name", ""))
        incident = str(alert_object.get("incident_type", ""))
        return (
            _FEATURE_SUBJECT.get(feature)
            or _FEATURE_SUBJECT.get(incident)
            or f"INCIDENT ALERT – {(incident or feature or 'INCIDENT').upper()} DETECTED"
        )

    def _vehicle_line(self, alert_object: dict[str, Any]) -> str:
        plates = alert_object.get("vehicle_plates", []) or []
        return ", ".join(plates) if plates else "N/A"

    def _format_telegram_caption(self, alert_object: dict[str, Any]) -> str:
        nearest = alert_object.get("primary_authority") or alert_object.get("nearest_authority") or {}
        severity = int(alert_object.get("severity_score", 0))
        severity_emoji = "🔴" if severity >= 8 else "🟠" if severity >= 5 else "🟡"
        severity_label, severity_note = self._severity_language(severity)
        incident = alert_object.get("incident_type", "Unknown Incident")
        location = alert_object.get("location", "Unknown Location")
        lat = float(alert_object.get("camera_latitude", alert_object.get("latitude", 0.0)) or 0.0)
        lon = float(alert_object.get("camera_longitude", alert_object.get("longitude", 0.0)) or 0.0)
        if location.lower() in {"unknown", "unknown location"} and lat and lon:
            location = f"Lat: {lat:.4f}, Lon: {lon:.4f}"
        timestamp = self._format_timestamp(alert_object.get("timestamp"))
        description = str(alert_object.get("gemini_description") or alert_object.get("groq_description") or "No description available.")
        if len(description) > 260:
            description = description[:257] + "..."
        authority_name = nearest.get("name", "Emergency Services")
        auth_type = str(nearest.get("authority_type") or nearest.get("type", "police")).lower()
        authority_emoji = _AUTH_EMOJI.get(auth_type, "🏛️")
        distance = nearest.get("distance_km", "N/A")
        backups = [
            str(name).strip() for name in (alert_object.get("authority_alerted") or [])
            if str(name).strip() and str(name).strip() != authority_name
        ]
        backup_line = ", ".join(backups[:2]) if backups else "None"

        caption = (
            f"Emergency Coordination Message | Protego\n\n"
            f"Incident: {incident} {severity_emoji}\n"
            f"Severity: {severity_label} ({severity}/10)\n"
            f"Priority Note: {severity_note}\n"
            f"Location: {location}\n"
            f"Time (UTC): {timestamp}\n\n"
            f"Primary Addressee: {authority_name}\n"
            f"Primary Type: {auth_type.title()}\n"
            f"Estimated Distance: {distance} km\n"
            f"Backup Options: {backup_line}\n\n"
            f"Assessment Summary: {description}\n\n"
            f"Request: Please initiate field verification and dispatch per your SOP. {authority_emoji}\n"
            f"Protego Note: AI-generated draft queued for duty-operator validation."
        )
        # Telegram photo caption limit is 1024 chars
        if len(caption) > 1024:
            caption = caption[:1021] + "..."
        return caption

    def _generate_telegram_message(self, incident: dict[str, Any]) -> str:
        feature = incident.get("incident_type", "Incident")
        severity = incident.get("severity_score", 7)
        location = incident.get("location", "Unknown Location")
        lat = float(incident.get("camera_latitude", incident.get("latitude", 0.0)) or 0.0)
        lon = float(incident.get("camera_longitude", incident.get("longitude", 0.0)) or 0.0)
        if location.lower() in {"unknown", "unknown location"} and lat and lon:
            location = f"Lat: {lat:.4f}, Lon: {lon:.4f}"
        description = incident.get("description") or incident.get("gemini_description", "") or incident.get("groq_description", "")
        action = incident.get("action") or incident.get("recommended_action", "")
        
        nearby = incident.get("nearby_authorities", {}) or {}
        hosp_list = nearby.get("hospital", [])[:3]
        pol_list = nearby.get("police", [])[:2]
        
        severity_emoji = "🔴" if severity >= 8 else "🟠" if severity >= 5 else "🟡"
        
        msg = f"<b>🚨 PROTEGO URGENT ALERT {severity_emoji}</b>\n\n"
        msg += f"<b>Incident:</b> {feature}\n"
        msg += f"<b>Severity:</b> {severity}/10\n"
        msg += f"<b>Location:</b> {location}\n\n"
        
        msg += f"<b>📝 AI Analysis:</b>\n{description}\n\n"
        
        if action:
            msg += f"<b>⚡ Action Needed:</b>\n{action}\n\n"
            
        msg += f"<b>🏥 Nearby Hospitals:</b>\n"
        if hosp_list:
            for h in hosp_list:
                msg += f"• {h.get('name', 'Unknown')} - {h.get('phone', '108')} ({h.get('distance_km', '?')}km)\n"
        else:
            msg += "• None found nearby\n"
            
        msg += f"\n<b>👮 Nearby Police Stations:</b>\n"
        if pol_list:
            for p in pol_list:
                msg += f"• {p.get('name', 'Unknown')} - {p.get('phone', '100')} ({p.get('distance_km', '?')}km)\n"
        else:
            msg += "• None found nearby\n"
            
        msg += "\n<i>Protego AI Public Safety System - Powered by Groq Vision AI</i>"
        return msg

    def send_telegram(self, alert_object: dict[str, Any], screenshot_base64: str | None) -> str:
        target_chat_id = self.session_telegram_chat_id or self.telegram_chat_id
        if not self.telegram_token or not target_chat_id:
            return "failed: telegram not configured"

        message = self._generate_telegram_message(alert_object)
        payload = screenshot_base64 or ""
        if payload and "," in payload:
            payload = payload.split(",", 1)[1]

        image_bytes = None
        if payload:
            try:
                image_bytes = base64.b64decode(payload)
            except Exception:
                image_bytes = None

        async def _send() -> None:
            bot = Bot(token=self.telegram_token)
            async with bot:
                if image_bytes:
                    await bot.send_photo(
                        chat_id=target_chat_id,
                        photo=image_bytes,
                        caption="📸 <b>Incident Screenshot captured by Protego System</b>",
                        parse_mode="HTML"
                    )
                
                await bot.send_message(
                    chat_id=target_chat_id,
                    text=message,
                    parse_mode="HTML"
                )

                try:
                    from gtts import gTTS
                    import tempfile
                    
                    feature = alert_object.get("incident_type", "Incident")
                    severity = alert_object.get("severity_score", 7)
                    location = alert_object.get("location", "Unknown Location")
                    lat = float(alert_object.get("camera_latitude", alert_object.get("latitude", 0.0)) or 0.0)
                    lon = float(alert_object.get("camera_longitude", alert_object.get("longitude", 0.0)) or 0.0)
                    if location.lower() in {"unknown", "unknown location"} and lat and lon:
                        location = "the marked GPS coordinates"
                    tts_text = f"Protego Emergency Alert. {feature} detected at {location}. Severity is {severity} out of 10. Immediate action is required."
                    tts = gTTS(text=tts_text, lang='en', tld='co.in')
                    
                    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as fp:
                        tts.save(fp.name)
                        temp_path = fp.name
                    
                    with open(temp_path, "rb") as audio_file:
                        await bot.send_voice(
                            chat_id=target_chat_id,
                            voice=audio_file,
                            caption="🔊 Automated Voice Alert"
                        )
                    os.unlink(temp_path)
                except Exception as tts_e:
                    self._log(f"telegram tts failed: {tts_e}")

        try:
            asyncio.run(_send())
            self._log("telegram sent")
            return "sent"
        except Exception as exc:
            self._log(f"telegram failed: {exc}")
            return f"failed: {exc}"

    def _email_html(self, alert_object: dict[str, Any], institution_name: str, real_email: str, demo_email: str, show_real: bool) -> str:
        incident_type = str(alert_object.get("incident_type", "Incident"))
        location = str(alert_object.get("location", "Unknown"))
        camera_name = str(alert_object.get("camera_name", "Surveillance Camera"))
        camera_id = str(alert_object.get("camera_id", "PRO-789"))
        severity_score = int(alert_object.get("severity_score", 0))
        description = str(alert_object.get("gemini_description") or alert_object.get("groq_description") or "No AI assessment available.")
        timestamp = self._format_timestamp(alert_object.get("timestamp"))
        confidence = int(alert_object.get("confidence", 0.65) * 100) if isinstance(alert_object.get("confidence"), float) else 85
        
        nearest = alert_object.get("nearest_authority") or {}
        auth_type = str(nearest.get("type", "police")).lower()
        
        # Mapping for template
        authority_title = {
            "hospital": "The Emergency Department",
            "police": "The Station House Officer",
            "fire": "The Fire Officer",
            "municipal": "The Municipal Commissioner",
            "traffic": "The Traffic Inspector"
        }.get(auth_type, "To Whom It May Concern")
        
        severity_color = "red" if severity_score >= 8 else "orange" if severity_score >= 5 else "#ffc107"
        severity_label = "CRITICAL" if severity_score >= 8 else "HIGH" if severity_score >= 6 else "MEDIUM" if severity_score >= 4 else "LOW"
        
        response_unit = {
            "hospital": "ambulance and medical team",
            "police": "police patrol unit",
            "fire": "fire engine",
            "municipal": "maintenance/sanitation crew",
            "traffic": "traffic interceptor"
        }.get(auth_type, "emergency response unit")

        # Plates
        plates = alert_object.get("vehicle_plates", []) or []
        plates_html = ""
        if plates:
            plates_html = f"""
            <tr>
                <td style="padding: 6px 0; color: #888;">Vehicle Plates:</td>
                <td style="padding: 6px 0; font-family: monospace; font-weight: bold;">{", ".join(plates)}</td>
            </tr>
            """

        # Authorities alerted list
        auth_alerted = alert_object.get("authority_alerted", []) or [institution_name]
        auth_alerted_str = ", ".join(auth_alerted)

        # Extract nearby authorities for the email
        nearby = alert_object.get("nearby_authorities", {}) or {}
        hosp_list = nearby.get("hospital", [])[:3]
        pol_list = nearby.get("police", [])[:2]

        hospitals_html = ""
        if hosp_list:
            for h in hosp_list:
                h_name = h.get('name', 'Unknown Hospital')
                h_phone = h.get('phone', '108')
                h_dist = h.get('distance_km', '?')
                hospitals_html += f"""
                <div style="margin-bottom: 8px;">
                    <strong>{h_name}</strong><br>
                    <span style="color: #666; font-size: 12px;">📞 {h_phone} | 📍 {h_dist}km away</span>
                </div>
                """
        else:
            hospitals_html = "<p style='color: #888; font-size: 13px; margin: 0;'>No nearby hospitals found in database.</p>"

        police_html = ""
        if pol_list:
            for p in pol_list:
                p_name = p.get('name', 'Unknown Police Station')
                p_phone = p.get('phone', '100')
                p_dist = p.get('distance_km', '?')
                police_html += f"""
                <div style="margin-bottom: 8px;">
                    <strong>{p_name}</strong><br>
                    <span style="color: #666; font-size: 12px;">📞 {p_phone} | 📍 {p_dist}km away</span>
                </div>
                """
        else:
            police_html = "<p style='color: #888; font-size: 13px; margin: 0;'>No nearby police stations found in database.</p>"

        nearby_html = f"""
    <!-- Nearby Authorities Box -->
    <div style="margin: 0 30px 20px; background: #f8f9fa; border: 1px solid #ddd; padding: 15px; border-radius: 4px;">
        <h3 style="color: #333; margin: 0 0 12px;">🏥 NEARBY EMERGENCY SERVICES</h3>
        <table style="width: 100%; border-collapse: collapse;">
            <tr>
                <td style="width: 50%; vertical-align: top; padding-right: 10px;">
                    <h4 style="color: #e63946; margin: 0 0 8px; font-size: 14px;">Hospitals / Medical</h4>
                    {hospitals_html}
                </td>
                <td style="width: 50%; vertical-align: top; padding-left: 10px; border-left: 1px solid #eee;">
                    <h4 style="color: #0077b6; margin: 0 0 8px; font-size: 14px;">Police / Law Enforcement</h4>
                    {police_html}
                </td>
            </tr>
        </table>
    </div>
        """

        return f"""
<div style="font-family: Arial, sans-serif; max-width: 650px; margin: 0 auto; background: #ffffff; border: 2px solid #e63946; border-radius: 8px; overflow: hidden;">
    <!-- Header -->
    <div style="background: #0a0f1e; padding: 20px; text-align: center;">
        <h1 style="color: #e63946; margin: 0; font-size: 24px;">🛡️ PROTEGO SAFETY ALERT</h1>
        <p style="color: #888; margin: 5px 0 0;">AI-Powered Public Safety System</p>
    </div>

    <!-- Salutation -->
    <div style="padding: 25px 30px 0;">
        <p style="font-size: 16px; color: #333;">
            Dear {authority_title},<br>
            <strong>{institution_name}</strong>
        </p>
        <p style="color: #555;">
            This is an automated emergency alert from Protego, an AI-powered public safety surveillance system. Our system has detected a potential <strong>{incident_type}</strong> incident in your jurisdiction that requires immediate attention.
        </p>
    </div>

    <!-- Incident Details Box -->
    <div style="margin: 20px 30px; background: #fff5f5; border-left: 4px solid #e63946; padding: 15px; border-radius: 4px;">
        <h3 style="color: #e63946; margin: 0 0 12px;">📋 INCIDENT DETAILS</h3>
        <table style="width: 100%; border-collapse: collapse;">
            <tr>
                <td style="padding: 6px 0; color: #888; width: 40%;">Incident Type:</td>
                <td style="padding: 6px 0; font-weight: bold; color: #e63946;">{incident_type}</td>
            </tr>
            <tr>
                <td style="padding: 6px 0; color: #888;">Location:</td>
                <td style="padding: 6px 0; font-weight: bold;">{location}</td>
            </tr>
            <tr>
                <td style="padding: 6px 0; color: #888;">Date and Time:</td>
                <td style="padding: 6px 0;">{timestamp} IST</td>
            </tr>
            <tr>
                <td style="padding: 6px 0; color: #888;">Severity Level:</td>
                <td style="padding: 6px 0;">
                    <span style="background: {severity_color}; color: white; padding: 2px 10px; border-radius: 12px; font-weight: bold;">
                        {severity_label} ({severity_score}/10)
                    </span>
                </td>
            </tr>
            {plates_html}
            <tr>
                <td style="padding: 6px 0; color: #888;">Camera ID:</td>
                <td style="padding: 6px 0;">{camera_name} — {camera_id}</td>
            </tr>
            <tr>
                <td style="padding: 6px 0; color: #888;">GPS Coordinates:</td>
                <td style="padding: 6px 0;">
                    {alert_object.get('latitude', 0)}, {alert_object.get('longitude', 0)}
                    <a href="https://maps.google.com/?q={alert_object.get('latitude', 0)},{alert_object.get('longitude', 0)}" style="color: #4cc9f0; margin-left: 8px;">View on Map →</a>
                </td>
            </tr>
        </table>
    </div>

    <!-- AI Analysis Box -->
    <div style="margin: 0 30px 20px; background: #f0f7ff; border-left: 4px solid #4cc9f0; padding: 15px; border-radius: 4px;">
        <h3 style="color: #4cc9f0; margin: 0 0 10px;">🤖 AI ANALYSIS</h3>
        <p style="color: #333; margin: 0; line-height: 1.6;">{description}</p>
        <p style="color: #888; font-size: 12px; margin: 8px 0 0;">
            Analysis powered by Groq Vision AI (Llama 3 Scout) — Confidence: {confidence}%
        </p>
    </div>

    <!-- Screenshot -->
    <div style="margin: 0 30px 20px;">
        <h3 style="color: #333; margin: 0 0 10px;">📸 INCIDENT SCREENSHOT</h3>
        <img src="cid:incident_screenshot" style="width: 100%; border-radius: 6px; border: 1px solid #ddd;" alt="Incident Screenshot"/>
        <p style="color: #888; font-size: 11px; margin: 6px 0 0;">
            Screenshot captured at moment of detection. Bounding boxes indicate detected persons and objects.
        </p>
    </div>

    <!-- Action Required -->
    <div style="margin: 0 30px 20px; background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; border-radius: 4px;">
        <h3 style="color: #856404; margin: 0 0 8px;">⚡ IMMEDIATE ACTION REQUIRED</h3>
        <p style="color: #856404; margin: 0;">
            Please dispatch the nearest available {response_unit} to the above location immediately. This alert has been simultaneously sent to: {auth_alerted_str}
        </p>
    </div>

{nearby_html}

    <!-- Demo Notice -->
    <div style="margin: 0 30px 20px; background: #f8f9fa; border: 1px dashed #999; padding: 12px; border-radius: 4px;">
        <p style="color: #666; font-size: 12px; margin: 0;">
            ℹ️ <strong>System Note:</strong> This alert is intended for {institution_name} ({real_email}). Currently in demonstration mode — delivered to {demo_email}. In live deployment this would be sent directly to the institution's official emergency contact.
        </p>
    </div>

    <!-- Footer -->
    <div style="background: #0a0f1e; padding: 15px 30px; text-align: center;">
        <p style="color: #888; font-size: 12px; margin: 0;">
            🛡️ Protego AI Safety System | Powered by YOLOv8 + Groq Vision<br>
            Emergency Numbers: Police 100 | Ambulance 108 | Fire 101 | Unified 112<br>
            This is an automated message. Please do not reply to this email.
        </p>
    </div>
</div>
"""

    def send_email(self, alert_object: dict[str, Any], screenshot_base64: str | None) -> str:
        # Reset counter every hour
        now = time.time()
        if now - self.email_hour_start > 3600:
            self.emails_sent_this_hour = 0
            self.email_hour_start = now

        # Hard limit: Layer 4 Throttling
        if self.emails_sent_this_hour >= 3:
            self._log("global email limit reached (3/hour) — skipping email")
            return "rate_limited"

        if not self.gmail_address or not self.gmail_password:
            return "failed: gmail not configured"

        db_demo = self._get_demo_config_from_db()
        demo_email = str(db_demo.get("demo_email") or self.demo_email).strip()
        show_real = bool(db_demo.get("show_real_institution_details", True))

        nearest = alert_object.get("nearest_authority") or {}
        institution_name = str(nearest.get("name", "Nearest Authority"))
        real_email = str(nearest.get("real_email", "public@institution.example"))

        msg = MIMEMultipart("related")
        msg["From"] = self.gmail_address
        target_email = str(self.session_email or demo_email or self.gmail_address).strip()
        msg["To"] = target_email
        msg["Subject"] = self._get_subject_line(alert_object)

        html = self._email_html(alert_object, institution_name, real_email, demo_email, show_real)
        alt = MIMEMultipart("alternative")
        alt.attach(MIMEText(html, "html"))
        msg.attach(alt)

        payload = screenshot_base64 or ""
        if payload and "," in payload:
            payload = payload.split(",", 1)[1]
        if payload:
            try:
                image_data = base64.b64decode(payload)
                image_part = MIMEImage(image_data)
                image_part.add_header("Content-ID", "<screenshot>")
                image_part.add_header("Content-Disposition", "inline", filename="alert.jpg")
                msg.attach(image_part)
            except Exception as exc:
                self._log(f"email image attach failed: {exc}")

        try:
            with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
                server.login(self.gmail_address, self.gmail_password)
                server.send_message(msg)
            
            self.emails_sent_this_hour += 1
            self._log(f"email sent to recipient: {target_email} (count: {self.emails_sent_this_hour}/3)")
            return "sent"
        except Exception as exc:
            self._log(f"email failed: {exc}")
            return f"failed: {exc}"

    def send_alert_email(self, incident: dict[str, Any], screenshot: str | None = None, recipient_email: str | None = None) -> bool:
        try:
            gmail = os.getenv("GMAIL_ADDRESS", "")
            password = os.getenv("GMAIL_PASSWORD", "")
            demo_email = os.getenv("DEMO_EMAIL", gmail)
            target_email = str(recipient_email or demo_email or gmail).strip()

            if not gmail or not password:
                print("[email] credentials missing")
                return False

            feature = incident.get("incident_type", "Public Safety Incident")
            severity = int(incident.get("severity_score", 7) or 7)
            location = incident.get("location", "Unknown Location")
            description = incident.get("description") or incident.get("gemini_description", "") or incident.get("groq_description", "")
            action = incident.get("action") or incident.get("recommended_action", "")
            timestamp = datetime.now().strftime("%d %B %Y at %I:%M %p IST")

            nearby = incident.get("nearby_authorities", {}) or {}
            if not nearby:
                lat = float(incident.get("camera_latitude", incident.get("latitude", 0.0)) or 0.0)
                lon = float(incident.get("camera_longitude", incident.get("longitude", 0.0)) or 0.0)
                nearby = self.find_nearby_with_overpass(lat, lon) if (lat and lon) else self._emergency_fallback()
            self._augment_with_city_referral_hospitals(incident, nearby, force_include=False)

            recipients = self._pick_best_authorities(incident, nearby)
            primary_recipient = self._select_primary_authority(incident, recipients)

            primary_email = str(primary_recipient.get("email", "")).strip()
            recipient_emails = [target_email] if target_email else [gmail]

            incident["primary_authority"] = primary_recipient
            incident["nearest_authority"] = primary_recipient
            incident["authority_alerted"] = [str(row.get("name", "")).strip() for row in recipients if str(row.get("name", "")).strip()]

            combined = incident.get("combined_authorities", {}) or {}
            if not combined:
                tavily_cache = getattr(self, "_tavily_cache", {}).get("result", {})
                combined = {
                    "nearby_hospitals": nearby.get("hospital", [])[:2],
                    "nearby_police": nearby.get("police", [])[:2],
                    "major_hospitals": (tavily_cache.get("hospital", []) if isinstance(tavily_cache, dict) else [])[:3],
                    "major_police": (tavily_cache.get("police", []) if isinstance(tavily_cache, dict) else [])[:2],
                    "emergency_numbers": nearby.get(
                        "emergency_numbers",
                        {
                            "police": "100",
                            "ambulance": "108",
                            "fire": "101",
                            "unified": "112",
                        },
                    ),
                }
                incident["combined_authorities"] = combined

            auth_html = """
<h3 style="color:#1a1a2e;
font-size:15px;margin:20px 0 10px;">
Nearby Emergency Services
</h3>
<table width="100%" style="
border-collapse:collapse;
font-size:12px;margin-bottom:16px;">
<tr style="background:#1a1a2e;
color:#fff;">
<th style="padding:8px;
text-align:left;">Institution</th>
<th style="padding:8px;
text-align:left;">Phone</th>
<th style="padding:8px;
text-align:left;">Distance</th>
</tr>"""

            for h in combined.get("nearby_hospitals", []):
                auth_html += f"""
<tr style="background:#f0fff4;">
<td style="padding:8px;
border:1px solid #ddd;">
Hospital {h.get('name','')}</td>
<td style="padding:8px;
border:1px solid #ddd;">
{h.get('phone','108')}</td>
<td style="padding:8px;
border:1px solid #ddd;">
{h.get('distance_km','?')} km</td>
</tr>"""

            for p in combined.get("nearby_police", []):
                auth_html += f"""
<tr style="background:#eff6ff;">
<td style="padding:8px;
border:1px solid #ddd;">
Police {p.get('name','')}</td>
<td style="padding:8px;
border:1px solid #ddd;">
{p.get('phone','100')}</td>
<td style="padding:8px;
border:1px solid #ddd;">
{p.get('distance_km','?')} km</td>
</tr>"""

            auth_html += "</table>"

            city_name = incident.get("city_name", "Nearest City")
            city_hospitals = incident.get("city_hospitals", []) or []
            city_police = incident.get("city_police", []) or []
            city_rows = ""

            for h in city_hospitals:
                phone_color = "#16a34a" if h.get("has_real_phone") else "#92400e"
                city_rows += f"""
<tr>
<td style="padding:10px;border:1px solid #e9d5ff;">
🏥 <strong>{h.get('name','')}</strong>
<br>
<span style="color:#888;font-size:11px;">
{h.get('type','')}{' · ' + h.get('speciality','') if h.get('speciality') else ''}
</span>
</td>
<td style="padding:10px;border:1px solid #e9d5ff;color:{phone_color};font-weight:bold;">
{h.get('phone','108')}
</td>
<td style="padding:10px;border:1px solid #e9d5ff;color:#2563eb;">
{h.get('email','-')}
</td>
</tr>"""

            for p in city_police:
                phone_color = "#16a34a" if p.get("has_real_phone") else "#92400e"
                city_rows += f"""
<tr>
<td style="padding:10px;border:1px solid #e9d5ff;">
👮 <strong>{p.get('name','')}</strong>
<br>
<span style="color:#888;font-size:11px;">
{p.get('address','')}
</span>
</td>
<td style="padding:10px;border:1px solid #e9d5ff;color:{phone_color};font-weight:bold;">
{p.get('phone','100')}
</td>
<td style="padding:10px;border:1px solid #e9d5ff;color:#2563eb;">
{p.get('email','-')}
</td>
</tr>"""

            city_section = ""
            if city_hospitals or city_police:
                city_section = f"""
<h3 style="color:#7c3aed;font-size:15px;margin:24px 0 10px;font-family:Arial;">
🌐 Major Authorities in Nearest City ({city_name})
</h3>
<p style="color:#888;font-size:12px;margin:0 0 10px;">
The following major hospitals and police stations are located in the nearest city to the incident location, identified via AI web search:
</p>
<table width="100%" style="border-collapse:collapse;font-size:13px;">
<tr style="background:#7c3aed;color:#fff;">
<th style="padding:10px;text-align:left;">Institution</th>
<th style="padding:10px;text-align:left;">Phone</th>
<th style="padding:10px;text-align:left;">Email</th>
</tr>
{city_rows if city_rows else '<tr><td colspan="3" style="padding:10px;color:#888;">No city authority data available</td></tr>'}
</table>
<p style="color:#888;font-size:11px;margin:8px 0 0;font-style:italic;">
Note: This email is sent to the demo address {demo_email} but is intended for the authorities listed above. In production, alerts would be delivered directly to their emergency contact addresses.
</p>
"""

            auth_html += city_section

            auth_html += """
<h3 style="color:#1a1a2e;
font-size:15px;margin:16px 0 10px;">
Major Regional Authorities
</h3>
<table width="100%" style="
border-collapse:collapse;
font-size:12px;margin-bottom:16px;">
<tr style="background:#4a0080;
color:#fff;">
<th style="padding:8px;
text-align:left;">Institution</th>
<th style="padding:8px;
text-align:left;">Phone</th>
<th style="padding:8px;
text-align:left;">Email</th>
</tr>"""

            for h in combined.get("major_hospitals", []):
                auth_html += f"""
<tr style="background:#fdf4ff;">
<td style="padding:8px;
border:1px solid #ddd;">
Hospital {h.get('name','')}</td>
<td style="padding:8px;
border:1px solid #ddd;">
{h.get('phone','108')}</td>
<td style="padding:8px;
border:1px solid #ddd;">
{h.get('email','-')}</td>
</tr>"""

            for p in combined.get("major_police", []):
                auth_html += f"""
<tr style="background:#f0f4ff;">
<td style="padding:8px;
border:1px solid #ddd;">
Police {p.get('name','')}</td>
<td style="padding:8px;
border:1px solid #ddd;">
{p.get('phone','100')}</td>
<td style="padding:8px;
border:1px solid #ddd;">
{p.get('email','-')}</td>
</tr>"""

            en = combined.get("emergency_numbers", {})
            auth_html += f"""
</table>
<div style="background:#f0fdf4;
border:1px solid #bbf7d0;
padding:12px;border-radius:6px;">
<strong style="font-size:12px;">
National Emergency Numbers:
</strong><br>
<span style="font-size:12px;">
Police: <b>{en.get('police', '100')}</b> &nbsp;|&nbsp;
Ambulance: <b>{en.get('ambulance', '108')}</b> &nbsp;|&nbsp;
Fire: <b>{en.get('fire', '101')}</b> &nbsp;|&nbsp;
Women: <b>1091</b> &nbsp;|&nbsp;
Unified: <b>{en.get('unified', '112')}</b>
</span>
</div>"""

            addressed_to = primary_recipient.get("name") or "The Officer In Charge"
            addressed_type = str(primary_recipient.get("authority_type") or primary_recipient.get("type") or "authority").title()
            backup_targets = [name for name in incident.get("authority_alerted", []) if name != addressed_to]
            backup_targets_line = ", ".join(backup_targets[:3]) if backup_targets else "No backup authority selected"
            intended_authority_email = primary_email or "Not Available"
            dispatch_mode_note = f"Delivered to configured safety mailbox ({recipient_emails[0]}) for human validation and onward dispatch."
            referral_hospital = None
            for hospital in nearby.get("hospital", []) or []:
                if bool(hospital.get("is_top_hospital")) or bool(hospital.get("is_city_referral")):
                    referral_hospital = hospital
                    break

            variant_seed = f"{feature}|{severity}|{location}|{incident.get('timestamp', '')}"
            variant_index = sum(ord(ch) for ch in variant_seed) % 3
            opening_lines = [
                "This communication is issued for immediate emergency coordination based on a verified incident escalation from the Protego monitoring workflow.",
                "This is an urgent field coordination notice from Protego following a validated escalation event at the location below.",
                "Please treat this as a priority operational alert generated by Protego and cleared through the incident escalation pipeline.",
            ]
            action_lines = [
                "Kindly dispatch your nearest available emergency unit for on-site verification and first response.",
                "Please mobilize the nearest response team immediately and confirm ground verification at the earliest.",
                "Immediate deployment of your field response unit is requested as per emergency SOP.",
            ]
            closing_lines = [
                "Kindly acknowledge receipt and share response status through your standard control channel.",
                "An acknowledgment from your duty control desk is requested after dispatch initiation.",
                "Please confirm receipt and provide action status once the response unit is en route.",
            ]
            opening_line = opening_lines[variant_index]
            action_line = action_lines[variant_index]
            closing_line = closing_lines[variant_index]
            referral_note = ""
            if severity >= 7 and referral_hospital and any(token in str(feature).lower() for token in ["accident", "medical", "fire"]):
                referral_type = "nearest major hospital" if bool(referral_hospital.get("is_top_hospital")) else "nearest city tertiary hospital"
                referral_note = (
                    f"For critical care escalation, dispatch ambulance support for immediate stabilization and coordinate transfer to "
                    f"{referral_hospital.get('name', 'the designated tertiary hospital')} ({referral_type}, {referral_hospital.get('referral_city', 'nearest city')})."
                )

            severity_color = "#dc2626" if severity >= 8 else "#d97706" if severity >= 5 else "#16a34a"

            html = f"""
<!DOCTYPE html>
<html>
<body style=\"margin:0;padding:0;font-family:Georgia,serif;background:#f5f5f5;\">
<div style=\"max-width:650px;margin:20px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 15px rgba(0,0,0,0.1);\">
<div style=\"background:#1a1a2e;padding:24px 32px;\">
<table width=\"100%\"><tr><td>
<h1 style=\"color:#fff;margin:0;font-size:22px;font-family:Arial;\">PROTEGO SAFETY SYSTEM</h1>
<p style=\"color:#4cc9f0;margin:4px 0 0;font-size:13px;\">AI-Powered Public Safety Surveillance</p>
</td><td align=\"right\"><div style=\"background:{severity_color};padding:8px 16px;border-radius:20px;\">
<p style=\"color:#fff;margin:0;font-size:13px;font-weight:bold;\">SEVERITY {severity}/10</p>
</div></td></tr></table>
</div>

<div style=\"background:{severity_color};padding:14px 32px;\">
<h2 style=\"color:#fff;margin:0;font-size:18px;\">URGENT: {str(feature).upper()} DETECTED</h2>
<p style=\"color:rgba(255,255,255,0.9);margin:4px 0 0;font-size:13px;\">{timestamp} - {location}</p>
</div>

<div style=\"padding:32px;\">
<p style=\"color:#333;font-size:14px;line-height:1.7;margin:0 0 14px;\"><strong>From:</strong> Protego Safety Operations Desk &lt;{gmail}&gt;<br><strong>To:</strong> {addressed_to}, {addressed_type} Control Desk<br><strong>Intended Official Email:</strong> {intended_authority_email}<br><strong>Date:</strong> {timestamp}<br><strong>Subject:</strong> Urgent Alert - {feature} at {location}</p>
<p style=\"color:#333;font-size:14px;line-height:1.7;\">Dear Sir/Madam,</p>
<p style=\"color:#333;font-size:14px;line-height:1.7;margin:0 0 20px;\">{opening_line}</p>
<p style=\"color:#333;font-size:14px;line-height:1.7;margin:0 0 20px;\">Our AI surveillance system has detected a <strong>{feature}</strong> incident at <strong>{location}</strong> on <strong>{timestamp}</strong>, with a threat severity rating of <strong style=\"color:{severity_color};\">{severity} out of 10</strong>, requiring your immediate attention.</p>

<div style=\"background:#fff8e1;border-left:4px solid #f59e0b;padding:16px;margin:20px 0;border-radius:4px;\">
<p style=\"margin:0;font-weight:bold;color:#92400e;font-size:13px;\">AI Analysis:</p>
<p style=\"margin:8px 0 0;color:#333;font-size:13px;line-height:1.6;\">{description}</p>
</div>

{f"<div style='background:#eef6ff;border-left:4px solid #2563eb;padding:16px;margin:20px 0;border-radius:4px;'><p style='margin:0;font-weight:bold;color:#1e40af;font-size:13px;'>Critical Care Referral Recommendation:</p><p style='margin:8px 0 0;color:#333;font-size:13px;line-height:1.6;'>{referral_note}</p></div>" if referral_note else ""}

{"<div style='background:#fef2f2;border-left:4px solid #ef4444;padding:16px;margin:20px 0;border-radius:4px;'><p style='margin:0;font-weight:bold;color:#991b1b;font-size:13px;'>Recommended Action:</p><p style='margin:8px 0 0;color:#333;font-size:13px;'>" + str(action) + "</p></div>" if action else ""}

<div style=\"background:#f8fafc;border-left:4px solid #475569;padding:16px;margin:20px 0;border-radius:4px;\">
<p style=\"margin:0;font-weight:bold;color:#334155;font-size:13px;\">Operational Request:</p>
<p style=\"margin:8px 0 0;color:#333;font-size:13px;line-height:1.6;\">{action_line}</p>
</div>

{auth_html}

{"<h3 style='color:#1a1a2e;font-size:15px;margin:24px 0 12px;font-family:Arial;'>Incident Screenshot</h3><img src='cid:screenshot' style='width:100%;border-radius:6px;border:1px solid #ddd;'/>" if screenshot else ""}

<p style=\"color:#333;font-size:14px;line-height:1.7;margin:24px 0 0;\">We request immediate operational action for this incident. Backup coordination options identified by Protego: <strong>{backup_targets_line}</strong>.</p>
<p style=\"color:#333;font-size:14px;line-height:1.7;margin:12px 0 0;\">{closing_line}</p>
<p style=\"color:#333;font-size:14px;line-height:1.7;margin:16px 0 0;\">Yours faithfully,<br><br><strong>Protego Safety Operations</strong><br>Incident Coordination Desk<br><span style=\"color:#888;font-size:12px;\">{dispatch_mode_note}</span></p>
</div>

<div style=\"background:#f8f8f8;padding:16px 32px;border-top:1px solid #eee;\">
<p style=\"color:#aaa;font-size:11px;margin:0;text-align:center;\">Protego AI Public Safety System - Powered by Groq Vision AI - Protecting communities across India</p>
</div>
</div>
</body>
</html>
"""

            msg = MIMEMultipart("related")
            msg["Subject"] = f"URGENT: {feature} at {location} | Severity {severity}/10 | Protego Safety Alert"
            msg["From"] = f"Protego Safety System <{gmail}>"
            msg["To"] = ", ".join(recipient_emails)
            msg.attach(MIMEText(html, "html"))

            if screenshot:
                try:
                    img_data = base64.b64decode(screenshot)
                    img = MIMEImage(img_data)
                    img.add_header("Content-ID", "<screenshot>")
                    img.add_header("Content-Disposition", "inline", filename="incident.jpg")
                    msg.attach(img)
                except Exception as e:
                    print(f"[email] screenshot attach failed: {e}")

            with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
                server.login(gmail, password)
                server.sendmail(gmail, recipient_emails, msg.as_string())

            print(f"[email] sent to {', '.join(recipient_emails)}")
            return True
        except Exception as e:
            print(f"[email] failed: {e}")
            return False

    def send_whatsapp_twilio(self, alert_object: dict[str, Any]) -> str:
        db_demo = self._get_demo_config_from_db()
        demo_phone = str(db_demo.get("demo_phone") or self.demo_phone).strip()
        
        if not self.twilio_client:
            return "failed: Twilio not configured"
        if not demo_phone:
            return "failed: DEMO_PHONE missing"

        # Ensure whatsapp: prefix
        to_phone = demo_phone if demo_phone.startswith("whatsapp:") else f"whatsapp:{demo_phone}"
        from_phone = self.twilio_phone if self.twilio_phone.startswith("whatsapp:") else f"whatsapp:{self.twilio_phone}"

        nearest = alert_object.get("nearest_authority") or {}
        message = (
            f"🛡️ *PROTEGO CRITICAL ALERT*\n\n"
            f"*Incident:* {alert_object.get('incident_type', 'Incident')}\n"
            f"*Location:* {alert_object.get('location', 'Unknown')}\n"
            f"*Severity:* {alert_object.get('severity_score', 0)}/10\n"
            f"*Nearest Authority:* {nearest.get('name', 'N/A')}\n"
            f"*Phone:* {nearest.get('phone', 'N/A')}\n\n"
            f"*AI Analysis:* _{alert_object.get('gemini_description', alert_object.get('groq_description', 'N/A'))[:200]}_"
        )

        try:
            self.twilio_client.messages.create(
                body=message,
                from_=from_phone,
                to=to_phone
            )
            return "sent"
        except Exception as exc:
            self._log(f"Twilio WhatsApp failed: {exc}")
            return f"failed: {exc}"

    def make_voice_call_twilio(self, alert_object: dict[str, Any]) -> str:
        # 5 minute cooldown between calls!!
        import time
        now = time.time()
        last_call = getattr(
            self, '_last_voice_call', 0
        )
        if now - last_call < 300:
            self._log(
                "voice call skipped - "
                "cooldown active!!"
            )
            return "skipped: cooldown"
        self._last_voice_call = now

        db_demo = self._get_demo_config_from_db()
        demo_phone = str(db_demo.get("demo_phone") or self.demo_phone).strip()
        
        if not self.twilio_client:
            return "failed: Twilio not configured"
        if not demo_phone:
            return "failed: DEMO_PHONE missing"
        
        try:
            import google.generativeai as genai
            import os
            import re
            gemini_key = os.getenv('GEMINI_API_KEY', '')
            if gemini_key:
                genai.configure(api_key=gemini_key)
                gemini_model = genai.GenerativeModel('gemini-2.5-flash')
                resp = gemini_model.generate_content(
                    f"Write a 3 sentence emergency call script. "
                    f"Incident: {alert_object.get('incident_type')}. "
                    f"Location: {alert_object.get('location')}. "
                    f"Severity: {alert_object.get('severity_score')}/10. "
                    f"Start with Hello this is Protego. "
                    f"End with Please respond immediately. "
                    f"No special characters."
                )
                script = re.sub(
                    r'[^\w\s.,!?-]',
                    '',
                    (resp.text or "").strip()
                )
            else:
                raise ValueError("No Gemini key")
        except Exception:
            script = (
                f"Hello this is Protego AI. "
                f"{alert_object.get('incident_type')} "
                f"detected at "
                f"{alert_object.get('location')}. "
                f"Severity "
                f"{alert_object.get('severity_score')} "
                f"out of 10. "
                f"Please respond immediately."
            )

        twiml = (
            f"<Response>"
            f"<Say voice=\"alice\">"
            f"{script}"
            f"</Say>"
            f"</Response>"
        )
        
        try:
            self.twilio_client.calls.create(
                twiml=twiml,
                from_=self.twilio_phone,
                to=demo_phone
            )
            self._log(f"Twilio Voice call initiated to: {demo_phone}")
            return "called"
        except Exception as exc:
            self._log(f"Twilio Voice failed: {exc}")
            return f"failed: {exc}"

    def send_sms_fast2sms(self, alert_object: dict[str, Any]) -> str:
        # Replaced by WhatsApp
        return self.send_whatsapp_twilio(alert_object)

    def dispatch_erss_112(self, alert_object: dict[str, Any]) -> str:
        # Structured as real 112 payload, routed to demo SMS for now.
        erss_payload = {
            "incident_type": alert_object.get("incident_type"),
            "severity": alert_object.get("severity_score"),
            "location": {
                "name": alert_object.get("location"),
                "latitude": alert_object.get("camera_latitude", alert_object.get("latitude")),
                "longitude": alert_object.get("camera_longitude", alert_object.get("longitude")),
            },
            "description": alert_object.get("gemini_description") or alert_object.get("groq_description"),
            "contact": {"demo_phone": self._get_demo_config_from_db().get("demo_phone") or self.demo_phone},
        }

        # For demo we do not call real 112 endpoint.
        sms_result = self.send_sms_fast2sms({**alert_object, "incident_type": f"112 ERSS Dispatch: {alert_object.get('incident_type')}"})
        return "dispatched-demo" if sms_result == "sent" else f"failed: {sms_result}"

    def send_voice_alert_telegram(self, alert_object: dict[str, Any]) -> str:
        """Generate a gTTS voice alert and send it to Telegram as a voice note."""
        if not self.telegram_token or not self.telegram_chat_id:
            return "failed: telegram not configured"
        try:
            import io
            from gtts import gTTS

            incident = alert_object.get("incident_type", "Unknown Incident")
            location = alert_object.get("location", "Unknown Location")
            severity = int(alert_object.get("severity_score", 0))
            description = str(alert_object.get("gemini_description") or alert_object.get("groq_description") or "")[:200]
            nearest = alert_object.get("nearest_authority") or {}
            authority_name = nearest.get("name", "Emergency Services")

            speech_text = (
                f"Attention. This is an automated alert from the Protego AI Public Safety Surveillance System. "
                f"A {incident} has been detected at {location}. "
                f"Severity score: {severity} out of 10. "
                f"{description}. "
                f"Nearest authority: {authority_name}. "
                f"Please verify and respond immediately."
            )

            mp3_buffer = io.BytesIO()
            gTTS(text=speech_text, lang="en", slow=False).write_to_fp(mp3_buffer)
            mp3_buffer.seek(0)

            async def _send_voice() -> None:
                target_chat_id = self.session_telegram_chat_id or self.telegram_chat_id
                bot = Bot(token=self.telegram_token)
                async with bot:
                    await bot.send_voice(
                        chat_id=target_chat_id,
                        voice=mp3_buffer,
                        caption=f"🔊 Voice Alert: {incident} at {location}",
                    )

            asyncio.run(_send_voice())
            self._log("voice alert sent to telegram")
            return "sent"
        except Exception as exc:
            self._log(f"voice alert failed: {exc}")
            return f"failed: {exc}"

    def send_telegram_voice_summary(self, incident: dict[str, Any]) -> None:
        try:
            import tempfile
            import google.generativeai as genai
            genai.configure(api_key=os.getenv("GEMINI_API_KEY", ""))
            gemini_model = genai.GenerativeModel("gemini-2.5-flash")

            feature = incident.get("incident_type", "Incident")
            severity = int(incident.get("severity_score", 7) or 7)
            location = incident.get("location", "Unknown Location")
            description = incident.get("description") or incident.get("gemini_description", "") or incident.get("groq_description", "")

            gemini_resp = gemini_model.generate_content(
                f"Write a short voice alert script to be spoken by an AI safety system.\n"
                f"Incident: {feature}\nSeverity: {severity}/10\nLocation: {location}\nDetails: {description}\n\n"
                f"Rules:\n- Max 4 sentences\n- Speak clearly and urgently\n- No special characters or emojis\n"
                f"- Natural spoken English\n- End with emergency number 112\n- Sound like a real emergency alert"
            )

            script = (gemini_resp.text or "").strip()
            script = re.sub(r"[^\w\s.,!?-]", "", script)
            print(f"[voice] script: {script}")

            tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
            tmp_path = tmp.name
            tmp.close()

            engine = pyttsx3.init()
            engine.setProperty("rate", 145)
            engine.setProperty("volume", 1.0)

            voices = engine.getProperty("voices")
            for voice in voices:
                if "english" in str(voice.name).lower():
                    engine.setProperty("voice", voice.id)
                    break

            engine.save_to_file(script, tmp_path)
            engine.runAndWait()

            async def _send() -> None:
                target_chat_id = self.session_telegram_chat_id or self.telegram_chat_id
                bot = telegram.Bot(token=self.telegram_token)
                async with bot:
                    with open(tmp_path, "rb") as voice_file:
                        await bot.send_voice(
                            chat_id=target_chat_id,
                            voice=voice_file,
                            caption=f"🔊 Voice Alert: {feature} · Severity {severity}/10",
                        )

            asyncio.run(_send())
            os.unlink(tmp_path)
            print("[voice] telegram voice note sent!!")
        except Exception as e:
            print(f"[voice-note] {e}")

    def send_alert(self, alert_object: dict[str, Any]) -> dict[str, Any]:
        latitude = float(alert_object.get("camera_latitude", alert_object.get("latitude", 0.0)) or 0.0)
        longitude = float(alert_object.get("camera_longitude", alert_object.get("longitude", 0.0)) or 0.0)

        if latitude and longitude:
            nearby = self.find_nearby_with_overpass(latitude, longitude)
            nearby_services = self.get_nearby_emergency_services(latitude, longitude)
        else:
            nearby = self._emergency_fallback()
            nearby_services = []
        self._augment_with_city_referral_hospitals(alert_object, nearby, force_include=False)

        alert_object["nearby_authorities"] = nearby
        alert_object["nearby_services"] = nearby_services
        selected_authorities = self._pick_best_authorities(alert_object, nearby)
        primary = self._select_primary_authority(alert_object, selected_authorities)
        alert_object["primary_authority"] = primary or {}
        alert_object["nearest_authority"] = primary or {}
        alert_object["authority_alerted"] = [row.get("name", "Emergency Services") for row in selected_authorities] or ["Emergency Services"]
        alert_object["email_recipients"] = [row.get("email", "") for row in selected_authorities if row.get("email")]

        nearby_overpass = alert_object.get("nearby_authorities", {})
        tavily_cache = getattr(self, "_tavily_cache", {}).get("result", {})
        combined = {
            "nearby_hospitals": nearby_overpass.get("hospital", [])[:2],
            "nearby_police": nearby_overpass.get("police", [])[:2],
            "major_hospitals": tavily_cache.get("hospital", [])[:3],
            "major_police": tavily_cache.get("police", [])[:2],
            "emergency_numbers": nearby_overpass.get(
                "emergency_numbers",
                {
                    "police": "100",
                    "ambulance": "108",
                    "fire": "101",
                    "unified": "112",
                },
            ),
        }
        alert_object["combined_authorities"] = combined

        demo_email = str(self._get_demo_config_from_db().get("demo_email") or self.demo_email).strip() or self.gmail_address
        email_targets: list[str] = []
        if self.session_email:
            email_targets.append(self.session_email)
        else:
            if demo_email:
                email_targets.append(demo_email)
            for contact in self.contacts_cache:
                email = str(contact.get("email", "")).strip()
                if email and email not in email_targets:
                    email_targets.append(email)
        alert_object["email_sent_to"] = []

        city_auth_cache: dict[str, Any] = {}
        for value in getattr(self, "_city_auth_cache", {}).values():
            if isinstance(value, dict):
                city_auth_cache = value.get("data", {})
                break

        alert_object["city_name"] = city_auth_cache.get("nearest_city", "")
        alert_object["city_hospitals"] = city_auth_cache.get("hospitals", [])[:3]
        alert_object["city_police"] = city_auth_cache.get("police_stations", [])[:2]

        screenshot_base64 = alert_object.get("screenshot")

        results: dict[str, str] = {
            "telegram": "failed",
            "whatsapp": "failed",
            "email": "failed",
            "voice_call": "skipped",
            "voice_telegram": "skipped",
            "erss_112": "failed",
        }

        def _telegram() -> None:
            results["telegram"] = self.send_telegram(alert_object, screenshot_base64)
            if results["telegram"] == "sent":
                threading.Thread(
                    target=self.send_telegram_voice_summary,
                    args=(alert_object,),
                    daemon=True,
                ).start()
                results["voice_telegram"] = "queued"

        def _whatsapp() -> None:
            results["whatsapp"] = self.send_whatsapp_twilio(alert_object)

        def _email() -> None:
            sent_to: list[str] = []
            for target_email in email_targets:
                if self.send_alert_email(alert_object, screenshot_base64, recipient_email=target_email):
                    sent_to.append(target_email)
            alert_object["email_sent_to"] = sent_to
            results["email"] = "sent" if sent_to else "failed"

        threads = [
            threading.Thread(target=_telegram, daemon=True),
            threading.Thread(target=_whatsapp, daemon=True),
            threading.Thread(target=_email, daemon=True),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        # If Fast2SMS fails, we still rely on telegram result and continue.
        if results.get("telegram") == "sent":
            try:
                results["voice_call"] = self.make_voice_call_twilio(alert_object)
            except Exception as e:
                results["voice_call"] = f"failed: {e}"
        results["erss_112"] = self.dispatch_erss_112(alert_object)

        # Delivery logging to console and Supabase via incident channel fields at save time.
        self._log(f"delivery status: {results}")
        alert_object["alert_channels"] = results

        popup = {
            "id": f"popup-{int(time.time() * 1000)}",
            "incident_type": str(alert_object.get("incident_type", "Incident")),
            "severity": int(alert_object.get("severity_score", 0) or 0),
            "description": str(alert_object.get("gemini_description") or alert_object.get("groq_description") or alert_object.get("description") or ""),
            "timestamp": str(alert_object.get("timestamp") or datetime.now(timezone.utc).isoformat()),
            "nearby_services": nearby_services,
            "email_sent_to": list(alert_object.get("email_sent_to", []) or []),
        }
        with self._popup_lock:
            self.pending_popups.append(popup)
            self.pending_popups = self.pending_popups[-20:]
        alert_object["pending_popup"] = popup
        return alert_object

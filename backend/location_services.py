import os
import requests
import re
import math
from typing import Any, List, Dict
from datetime import datetime, timezone
from bs4 import BeautifulSoup
from geopy.distance import geodesic

INDIA_EMERGENCY = {
    "police_national": "100",
    "ambulance_national": "108", 
    "fire_national": "101",
    "emergency_unified": "112",
    "women_helpline": "1091",
    "child_helpline": "1098",
    "disaster_management": "1077"
}

TELANGANA_CONTACTS = {
    "ts_police_control": "040-27852485",
    "ts_police_email": "dgp@tspolice.gov.in",
    "hyderabad_commissioner": "040-27852468",
    "cyberabad_police": "040-27852468",
    "ghmc_control_room": "040-21111111",
    "ghmc_email": "commissioner@ghmc.gov.in",
    "telangana_fire": "040-23220018",
    "ems_ambulance": "108",
    "apollo_hyderabad": "040-23607777",
    "kims_hyderabad": "040-44885000",
    "care_hospital": "040-30418888",
    "yashoda_hospital": "040-45674567"
}

class LocationServices:
    def __init__(self, api_key: str = None):
        self.api_key = (api_key or os.getenv("GEOAPIFY_API_KEY", "").strip())
        self.overpass_url = "https://overpass-api.de/api/interpreter"

    def _log(self, message: str):
        now = datetime.now(timezone.utc).isoformat()
        print(f"[{now}] [location-service] {message}")

    def search_contacts(self, place_name: str, city: str) -> Dict[str, str]:
        """Disabled — was using DuckDuckGo which caused timeouts."""
        return {"phone": "N/A", "email": "N/A"}  # disabled

    def _match_telangana_fallback(self, name: str, item_type: str) -> Dict[str, str]:
        """Match against known Telangana contacts."""
        name_lower = name.lower()
        matches = {}
        
        if "police" in name_lower:
            if "cyberabad" in name_lower:
                matches["phone"] = TELANGANA_CONTACTS["cyberabad_police"]
            elif "hyderabad" in name_lower:
                matches["phone"] = TELANGANA_CONTACTS["hyderabad_commissioner"]
            else:
                matches["phone"] = TELANGANA_CONTACTS["ts_police_control"]
            matches["email"] = TELANGANA_CONTACTS["ts_police_email"]
            matches["emergency_phone"] = INDIA_EMERGENCY["police_national"]

        elif "hospital" in name_lower:
            if "apollo" in name_lower: matches["phone"] = TELANGANA_CONTACTS["apollo_hyderabad"]
            elif "kims" in name_lower: matches["phone"] = TELANGANA_CONTACTS["kims_hyderabad"]
            elif "care" in name_lower: matches["phone"] = TELANGANA_CONTACTS["care_hospital"]
            elif "yashoda" in name_lower: matches["phone"] = TELANGANA_CONTACTS["yashoda_hospital"]
            matches["emergency_phone"] = INDIA_EMERGENCY["ambulance_national"]

        elif "fire" in name_lower:
            matches["phone"] = TELANGANA_CONTACTS["telangana_fire"]
            matches["emergency_phone"] = INDIA_EMERGENCY["fire_national"]

        elif "municipal" in name_lower or "townhall" in name_lower or "ghmc" in name_lower:
            matches["phone"] = TELANGANA_CONTACTS["ghmc_control_room"]
            matches["email"] = TELANGANA_CONTACTS["ghmc_email"]

        return matches

    def find_nearby_authorities(self, lat: float, lon: float, radius_meters: int = 5000) -> Dict[str, List[Dict[str, Any]]]:
        """Find nearby authorities using Overpass API."""
        query = f"""
        [out:json][timeout:25];
        (
          node["amenity"="hospital"](around:{radius_meters},{lat},{lon});
          node["amenity"="clinic"](around:{radius_meters},{lat},{lon});
          node["healthcare"="hospital"](around:{radius_meters},{lat},{lon});
          node["amenity"="police"](around:{radius_meters},{lat},{lon});
          node["amenity"="fire_station"](around:{radius_meters},{lat},{lon});
          node["amenity"="townhall"](around:{radius_meters},{lat},{lon});
          node["office"="government"](around:{radius_meters},{lat},{lon});
          node["emergency"="ambulance_station"](around:{radius_meters},{lat},{lon});
        );
        out body;
        """
        
        try:
            resp = requests.post(self.overpass_url, data=query, timeout=30)
            if resp.status_code != 200:
                self._log(f"Overpass failed: {resp.status_code}")
                return {}
                
            data = resp.json()
            elements = data.get("elements", [])
            
            # If fewer than 3 results, expand search to 10km
            if len(elements) < 3 and radius_meters < 10000:
                self._log(f"Low results ({len(elements)}), expanding search to 10km...")
                return self.find_nearby_authorities(lat, lon, 10000)

            authorities = {
                "hospital": [],
                "police": [],
                "fire": [],
                "municipal": []
            }

            for el in elements:
                tags = el.get("tags", {})
                name = tags.get("name", "Unknown Authority")
                lat_el, lon_el = el.get("lat"), el.get("lon")
                dist = geodesic((lat, lon), (lat_el, lon_el)).km
                
                # Determine type
                item_type = "municipal"
                if any(k in tags for k in ["hospital", "clinic", "healthcare"]): item_type = "hospital"
                elif tags.get("amenity") == "police": item_type = "police"
                elif tags.get("amenity") == "fire_station": item_type = "fire"
                elif tags.get("emergency") == "ambulance_station": item_type = "hospital"
                
                # Verify from and enrich contact
                phone = tags.get("phone", tags.get("contact:phone", "N/A"))
                email = tags.get("email", tags.get("contact:email", "N/A"))
                website = tags.get("website", tags.get("contact:website", "N/A"))
                
                # Telangana/India Fallbacks
                fallbacks = self._match_telangana_fallback(name, item_type)
                if phone == "N/A": phone = fallbacks.get("phone", "N/A")
                if email == "N/A": email = fallbacks.get("email", "N/A")
                
                # Web enrichment if still missing
                if phone == "N/A" or email == "N/A":
                    enriched = self.search_contacts(name, "Hyderabad") # City can be dynamic later
                    if phone == "N/A": phone = enriched["phone"]
                    if email == "N/A": email = enriched["email"]

                card = {
                    "name": name,
                    "type": item_type,
                    "distance_km": round(dist, 2),
                    "address": tags.get("addr:full", tags.get("addr:street", "Nearby Address")),
                    "phone": phone,
                    "email": email,
                    "website": website,
                    "emergency_phone": fallbacks.get("emergency_phone", INDIA_EMERGENCY.get(f"{item_type}_national", "112")),
                    "coordinates": {"lat": lat_el, "lon": lon_el},
                    "has_emergency": True,
                    "overpass_verified": True
                }
                
                if item_type in authorities:
                    authorities[item_type].append(card)

            # Sort by distance
            for k in authorities:
                authorities[k].sort(key=lambda x: x["distance_km"])
                
            return authorities

        except Exception as e:
            self._log(f"Authority search error: {e}")
            return {}

if __name__ == "__main__":
    ls = LocationServices()
    print(ls.find_nearby_authorities(17.4447, 78.3483)) # Gachibowli test

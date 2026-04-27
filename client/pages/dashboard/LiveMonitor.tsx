import { useState, useEffect, useRef, useCallback } from "react";
import {
  Video, MapPin, ShieldAlert, Siren, Play, Pause, Maximize2,
  Clock, Target, Radio, Wifi, Zap, Cpu, Mail, MessageCircle,
  Smartphone, MoreVertical, Loader2, CheckCircle, XCircle,
  Camera, Youtube, ChevronRight, ChevronLeft
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { io } from "socket.io-client";
import { useToast } from "@/components/ui/use-toast";
import AdminSetupModal from "@/components/AdminSetupModal";
import EmergencyCallOverlay from "@/components/EmergencyCallOverlay";
import { EmergencyAlertModal } from "../../components/EmergencyAlertModal";
import { useEmergencySpeech } from "@/hooks/useEmergencySpeech";
import { apiUrl } from "@/lib/api";

const API = apiUrl("");
const VOICE_AUTO_DELAY_MS = 120000;

interface Detection {
  label: string; confidence: number;
  bbox: [number, number, number, number];
  detection_type: string; color: string;
}

interface Alert {
  id: string; incident_type: string; feature_name: string;
  location: string; severity_score: number; gemini_description: string;
  description?: string;
  authority_alerted: string[]; vehicle_plates?: string[];
  screenshot: string; timestamp: string;
  alert_channels?: { telegram: "sent" | "failed"; sms: "sent" | "failed"; email: "sent" | "failed"; };
  crowd_density?: number; escape_direction?: string;
  nearby_authorities?: {
    hospital?: Array<{ name: string; distance_km: number; phone: string }>;
    police?: Array<{ name: string; distance_km: number; phone: string }>;
    fire?: Array<{ name: string; distance_km: number; phone: string }>;
    emergency_numbers?: { police: string; ambulance: string; fire: string; women: string; unified: string };
  };
}

interface Stats {
  total_alerts: number; high_severity: number;
  authorities_contacted: number; active_cameras: number;
}

interface GeminiThreat {
  feature?: string;
  type: string;
  description: string;
  severity: number;
  confidence: number;
  action: string;
  evidence?: string;
}

interface GeminiAnalysis {
  scene: string;
  people_count: number;
  vehicles_count: number;
  threats: GeminiThreat[];
  safe: boolean;
  timestamp: string;
  gemini_reasoning?: string;
}

type CameraTab = "webcam" | "droidcam" | "youtube" | "rtsp";

interface LocationObj {
  latitude: number;
  longitude: number;
  accuracy?: number;
  full_address?: string;
  village?: string;
  city?: string;
  state?: string;
  postcode?: string;
  method: "gps" | "manual";
}

interface AuthorityRow {
  name: string;
  distance_km: number;
  phone?: string;
  type?: string;
  email?: string;
}

interface NearbyAuthoritiesData {
  hospital?: AuthorityRow[];
  police?: AuthorityRow[];
  fire?: AuthorityRow[];
  emergency_numbers?: {
    police: string;
    ambulance: string;
    fire: string;
    women: string;
    unified: string;
  };
}

interface TavilyAuthority {
  name: string;
  phone?: string;
  email?: string;
  type?: string;
  address?: string;
  jurisdiction?: string;
  source?: string;
  has_real_phone?: boolean;
}

interface TavilyAuthoritiesData {
  hospital?: TavilyAuthority[];
  police?: TavilyAuthority[];
  searching?: boolean;
}

interface CityHospitalRow {
  name: string;
  phone?: string;
  email?: string;
  type?: string;
  address?: string;
  speciality?: string;
  has_real_phone?: boolean;
}

interface CityPoliceRow {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  has_real_phone?: boolean;
}

interface CityAuthoritiesData {
  nearest_city?: string;
  hospitals?: CityHospitalRow[];
  police_stations?: CityPoliceRow[];
}

// ── LocationPanel ─────────────────────────────────────────────────────────
function LocationPanel({ onLocationSet }: { onLocationSet: (loc: LocationObj) => void }) {
  const [detecting, setDetecting] = useState(false);
  const [location, setLocation] = useState<LocationObj | null>(null);
  const [manualInput, setManualInput] = useState("");
  const [error, setError] = useState("");

  const detectGPS = async () => {
    setDetecting(true);
    setError("");
    if (!navigator.geolocation) {
      setError("GPS not available. Please enter manually.");
      setDetecting(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const acc = pos.coords.accuracy;
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
            { headers: { "User-Agent": "Protego-Safety/1.0" } }
          );
          const data = await res.json();
          const addr = data.address || {};
          const locationObj: LocationObj = {
            latitude: lat, longitude: lng, accuracy: acc,
            full_address: data.display_name,
            village: addr.village || addr.suburb || addr.town || "",
            city: addr.city || addr.town || addr.district || "",
            state: addr.state || "",
            postcode: addr.postcode || "",
            method: "gps",
          };
          await fetch(`${API}/api/location/set`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(locationObj),
          });
          setLocation(locationObj);
          onLocationSet(locationObj);
        } catch {
          const locationObj: LocationObj = {
            latitude: lat, longitude: lng,
            full_address: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
            method: "gps",
          };
          await fetch(`${API}/api/location/set`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(locationObj),
          }).catch(() => null);
          setLocation(locationObj);
          onLocationSet(locationObj);
        }
        setDetecting(false);
      },
      () => {
        setError("GPS denied. Please enter location manually below.");
        setDetecting(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const setManual = async () => {
    if (!manualInput.trim()) return;
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(manualInput)}&format=json&limit=1&countrycodes=in`,
        { headers: { "User-Agent": "Protego-Safety/1.0" } }
      );
      const data = await res.json();
      if (data.length > 0) {
        const result = data[0];
        const locationObj: LocationObj = {
          latitude: parseFloat(result.lat),
          longitude: parseFloat(result.lon),
          full_address: result.display_name,
          method: "manual",
        };
        await fetch(`${API}/api/location/set`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(locationObj),
        });
        setLocation(locationObj);
        onLocationSet(locationObj);
      } else {
        setError("Location not found. Try a nearby town name.");
      }
    } catch {
      setError("Could not geocode. Check your connection.");
    }
  };

  return (
    <div style={{
      background: "#0d0d1a",
      border: `1px solid ${location ? "#4ade80" : "#4cc9f0"}`,
      borderRadius: "10px", padding: "14px", marginBottom: "12px",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
        <p style={{ color: "#4cc9f0", fontWeight: "bold", fontSize: "12px", margin: 0, textTransform: "uppercase", letterSpacing: "1px" }}>
          📍 Location
        </p>
        {location && (
          <span style={{ background: "#4ade80", color: "#000", fontSize: "9px", padding: "2px 8px", borderRadius: "10px", fontWeight: "bold" }}>
            {location.method === "gps" ? "🎯 GPS" : "✏️ Manual"}
          </span>
        )}
      </div>
      {location ? (
        <div>
          <p style={{ color: "#4ade80", fontSize: "12px", margin: "0 0 4px", lineHeight: "1.4" }}>
            {location.village && location.village + ", "}
            {location.city}
            {location.state && ", " + location.state}
            {location.postcode && " - " + location.postcode}
          </p>
          <p style={{ color: "#555", fontSize: "10px", margin: "0 0 8px" }}>
            {location.latitude?.toFixed(4)}, {location.longitude?.toFixed(4)}
            {location.accuracy && ` · ±${Math.round(location.accuracy)}m`}
          </p>
          <button onClick={() => { setLocation(null); setError(""); }}
            style={{ background: "none", border: "1px solid #333", color: "#666", fontSize: "10px", padding: "3px 8px", borderRadius: "4px", cursor: "pointer" }}>
            Change
          </button>
        </div>
      ) : (
        <div>
          <button onClick={detectGPS} disabled={detecting}
            style={{ width: "100%", background: detecting ? "#1a2a1a" : "rgba(74,222,128,0.1)", border: "1px solid #4ade80", color: "#4ade80", padding: "8px", borderRadius: "6px", cursor: detecting ? "default" : "pointer", fontSize: "12px", fontWeight: "bold", marginBottom: "8px" }}>
            {detecting ? "🔄 Detecting..." : "🎯 Auto-Detect My Location"}
          </button>
          <div style={{ display: "flex", gap: "6px" }}>
            <input value={manualInput} onChange={e => setManualInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && setManual()}
              placeholder="Enter village, town, city..."
              style={{ flex: 1, background: "#111", border: "1px solid #333", color: "#fff", padding: "6px 10px", borderRadius: "6px", fontSize: "12px", outline: "none" }} />
            <button onClick={setManual}
              style={{ background: "#1a1a4a", border: "1px solid #4cc9f0", color: "#4cc9f0", padding: "6px 12px", borderRadius: "6px", cursor: "pointer", fontSize: "12px" }}>
              Set
            </button>
          </div>
          {error && (
            <p style={{ color: "#f87171", fontSize: "11px", margin: "6px 0 0" }}>⚠️ {error}</p>
          )}
        </div>
      )}
    </div>
  );
}

const TooltipIcon = ({ icon: Icon, status, label }: { icon: React.ElementType, status: "sent" | "failed", label: string }) => (
  <div className="relative group">
    <Icon
      className={cn(
        "w-4 h-4",
        status === "sent" ? "text-green-400" : "text-red-400"
      )}
    />
    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-black text-white text-xs rounded py-1 px-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
      {label}: {status}
    </div>
  </div>
);

// ── NearbyAuthorities ─────────────────────────────────────────────────────
function NearbyAuthorities({ nearby }: { nearby?: Alert["nearby_authorities"] }) {
  if (!nearby) return null;
  const emergency = nearby.emergency_numbers || {} as NonNullable<typeof nearby>["emergency_numbers"];
  const hasResults = (nearby.hospital?.length || 0) + (nearby.police?.length || 0) > 0;
  if (!hasResults && !emergency) return null;
  return (
    <div style={{ background: "#0d1a0d", border: "1px solid #4ade80", borderRadius: "8px", padding: "12px", marginTop: "10px" }}>
      <p style={{ color: "#4ade80", fontWeight: "bold", fontSize: "11px", margin: "0 0 10px", textTransform: "uppercase" }}>📍 Nearby Authorities</p>
      {nearby.hospital?.slice(0, 2).map((h, i) => (
        <div key={i} style={{ marginBottom: "8px", paddingBottom: "8px", borderBottom: "1px solid #1a2a1a" }}>
          <p style={{ color: "#fff", fontSize: "12px", margin: "0 0 2px", fontWeight: "bold" }}>🏥 {h.name}</p>
          <p style={{ color: "#888", fontSize: "10px", margin: 0 }}>{h.distance_km} km away · 📞 {h.phone}</p>
        </div>
      ))}
      {nearby.police?.slice(0, 2).map((p, i) => (
        <div key={i} style={{ marginBottom: "8px", paddingBottom: "8px", borderBottom: "1px solid #1a2a1a" }}>
          <p style={{ color: "#fff", fontSize: "12px", margin: "0 0 2px", fontWeight: "bold" }}>👮 {p.name}</p>
          <p style={{ color: "#888", fontSize: "10px", margin: 0 }}>{p.distance_km} km away · 📞 {p.phone}</p>
        </div>
      ))}
      {emergency && (
        <div style={{ background: "#111", borderRadius: "6px", padding: "8px", marginTop: "6px" }}>
          <p style={{ color: "#666", fontSize: "10px", margin: "0 0 4px", fontWeight: "bold" }}>🆘 Emergency Numbers</p>
          <p style={{ color: "#4ade80", fontSize: "11px", margin: 0 }}>
            Police: <strong>100</strong>&nbsp;·&nbsp;Ambulance: <strong>108</strong>&nbsp;·&nbsp;Fire: <strong>101</strong>&nbsp;·&nbsp;All: <strong>112</strong>
          </p>
        </div>
      )}
    </div>
  );
}

function NearbyAuthoritiesPreview({ nearby }: { nearby: NearbyAuthoritiesData }) {
  const cards: Array<{ label: string; emoji: string; rows?: AuthorityRow[] }> = [
    { label: "Hospitals", emoji: "🏥", rows: nearby.hospital },
    { label: "Police", emoji: "👮", rows: nearby.police },
    { label: "Fire", emoji: "🚒", rows: nearby.fire },
  ];

  return (
    <div className="rounded-2xl border border-white/[0.05] bg-white/[0.02] p-5 space-y-3">
      <div className="text-[10px] text-primary font-black uppercase tracking-[0.25em]">Nearby Authorities</div>
      <div className="grid grid-cols-1 gap-2">
        {cards.filter(card => (card.rows || []).length > 0).map(card => (
          <div key={card.label} className="rounded-xl border border-white/[0.05] p-3 space-y-1">
            <div className="text-[9px] text-white/60 uppercase tracking-widest font-black">{card.emoji} {card.label}</div>
            {(card.rows || []).slice(0, 3).map((row, idx) => (
              <div key={idx} className="text-[10px] text-white/50">
                {row.name}{row.distance_km != null ? ` — ${row.distance_km.toFixed(1)}km` : ""}{row.phone ? ` — ${row.phone}` : ""}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function MajorAuthoritiesPreview({ data, loading }: { data: TavilyAuthoritiesData | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-purple-500/20 bg-purple-500/5 p-5">
        <div className="text-[10px] text-purple-400 font-black uppercase tracking-[0.25em] mb-3">Major Authorities</div>
        <div className="text-[10px] text-white/40 animate-pulse">🔍 Searching for major hospitals & police stations...</div>
      </div>
    );
  }
  if (!data || (!(data.hospital?.length) && !(data.police?.length))) return null;
  return (
    <div className="rounded-2xl border border-purple-500/20 bg-purple-500/5 p-5 space-y-3">
      <div className="text-[10px] text-purple-400 font-black uppercase tracking-[0.25em]">Major Authorities (Web Search)</div>
      <div className="grid grid-cols-1 gap-2">
        {(data.hospital || []).length > 0 && (
          <div className="rounded-xl border border-white/[0.05] p-3 space-y-1">
            <div className="text-[9px] text-white/60 uppercase tracking-widest font-black">🏥 Top Hospitals</div>
            {(data.hospital || []).map((h, i) => (
              <div key={i} className="text-[10px] text-white/50">
                {h.name}
                {h.address ? ` — ${h.address}` : ""}
                {h.phone ? (
                  <span className={h.has_real_phone ? " text-green-400" : " text-orange-400"}> — {h.phone}</span>
                ) : null}
              </div>
            ))}
          </div>
        )}
        {(data.police || []).length > 0 && (
          <div className="rounded-xl border border-white/[0.05] p-3 space-y-1">
            <div className="text-[9px] text-white/60 uppercase tracking-widest font-black">👮 Top Police Stations</div>
            {(data.police || []).map((p, i) => (
              <div key={i} className="text-[10px] text-white/50">
                {p.name}
                {p.jurisdiction ? ` (${p.jurisdiction})` : ""}
                {p.phone ? (
                  <span className={p.has_real_phone ? " text-green-400" : " text-orange-400"}> — {p.phone}</span>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CityAuthoritiesPreview({ cityAuth, cityAuthLoading }: { cityAuth: CityAuthoritiesData | null; cityAuthLoading: boolean }) {
  return (
    <div style={{
      marginTop: "14px",
      background: "linear-gradient(135deg, #0a0a1f, #0d0a1a)",
      border: "1px solid #7c3aed",
      borderRadius: "12px",
      padding: "16px",
      boxShadow: "0 0 15px rgba(124,58,237,0.15)",
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "12px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "16px" }}>🌐</span>
          <div>
            <p style={{
              color: "#a78bfa",
              fontWeight: "bold",
              fontSize: "12px",
              margin: 0,
              textTransform: "uppercase",
              letterSpacing: "1px",
            }}>
              Nearest City Authorities
            </p>
            {cityAuth?.nearest_city && (
              <p style={{ color: "#666", fontSize: "10px", margin: "2px 0 0" }}>
                📍 {cityAuth.nearest_city}
              </p>
            )}
          </div>
        </div>
        <span style={{
          color: "#555",
          fontSize: "9px",
          background: "#1a0a2e",
          padding: "3px 8px",
          borderRadius: "10px",
          border: "1px solid #4a1a6e",
        }}>
          AI Web Search
        </span>
      </div>

      {cityAuthLoading && (
        <div style={{ textAlign: "center", padding: "16px" }}>
          <p style={{ color: "#7c3aed", fontSize: "12px", margin: "0 0 4px" }}>
            🔍 Searching major authorities...
          </p>
          <p style={{ color: "#444", fontSize: "10px", margin: 0 }}>
            Using Tavily + Gemini AI
          </p>
        </div>
      )}

      {!cityAuthLoading && !cityAuth && (
        <p style={{
          color: "#444",
          fontSize: "11px",
          textAlign: "center",
          padding: "12px",
          margin: 0,
        }}>
          Set location to find major hospitals and police stations in the nearest city
        </p>
      )}

      {cityAuth && (
        <div>
          {(cityAuth.hospitals?.length || 0) > 0 && (
            <div style={{ marginBottom: "12px" }}>
              <p style={{
                color: "#a78bfa",
                fontSize: "10px",
                fontWeight: "bold",
                margin: "0 0 8px",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}>
                🏥 Major Hospitals
              </p>
              {(cityAuth.hospitals || []).map((h, i) => (
                <div key={i} style={{
                  background: "rgba(124,58,237,0.05)",
                  border: "1px solid #2a1a4a",
                  borderRadius: "8px",
                  padding: "10px",
                  marginBottom: "6px",
                }}>
                  <p style={{ color: "#fff", fontSize: "12px", fontWeight: "bold", margin: "0 0 3px" }}>
                    {h.name}
                  </p>
                  {(h.type || h.speciality) && (
                    <p style={{ color: "#888", fontSize: "10px", margin: "0 0 4px" }}>
                      {h.type}{h.speciality ? ` · ${h.speciality}` : ""}
                    </p>
                  )}
                  {h.address && (
                    <p style={{ color: "#555", fontSize: "10px", margin: "0 0 4px" }}>
                      📍 {h.address.slice(0, 50)}
                    </p>
                  )}
                  <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "2px" }}>
                    <span style={{
                      color: h.has_real_phone ? "#4ade80" : "#f97316",
                      fontSize: "11px",
                      fontWeight: "bold",
                    }}>
                      📞 {h.phone || "108"} {h.has_real_phone ? "✓" : "⚡"}
                    </span>
                    {h.email && (
                      <span style={{ color: "#60a5fa", fontSize: "11px" }}>
                        ✉️ {h.email}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {(cityAuth.police_stations?.length || 0) > 0 && (
            <div>
              <p style={{
                color: "#a78bfa",
                fontSize: "10px",
                fontWeight: "bold",
                margin: "0 0 8px",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}>
                👮 Major Police Stations
              </p>
              {(cityAuth.police_stations || []).map((p, i) => (
                <div key={i} style={{
                  background: "rgba(124,58,237,0.05)",
                  border: "1px solid #2a1a4a",
                  borderRadius: "8px",
                  padding: "10px",
                  marginBottom: "6px",
                }}>
                  <p style={{ color: "#fff", fontSize: "12px", fontWeight: "bold", margin: "0 0 3px" }}>
                    {p.name}
                  </p>
                  {p.address && (
                    <p style={{ color: "#555", fontSize: "10px", margin: "0 0 4px" }}>
                      📍 {p.address.slice(0, 50)}
                    </p>
                  )}
                  <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                    <span style={{
                      color: p.has_real_phone ? "#4ade80" : "#f97316",
                      fontSize: "11px",
                      fontWeight: "bold",
                    }}>
                      📞 {p.phone || "100"} {p.has_real_phone ? "✓" : "⚡"}
                    </span>
                    {p.email && (
                      <span style={{ color: "#60a5fa", fontSize: "11px" }}>
                        ✉️ {p.email}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GeminiSidebar({ geminiData, geminiLog }: { geminiData: GeminiAnalysis | null; geminiLog: GeminiAnalysis[] }) {
  const isThreat = !!geminiData && !geminiData.safe && (geminiData.threats?.length || 0) > 0;

  return (
    <div style={{
      width: "300px",
      minWidth: "300px",
      background: "#0d0d1a",
      border: `1px solid ${isThreat ? "#ef4444" : "#7c3aed"}`,
      borderRadius: "12px",
      padding: "16px",
      height: "calc(100vh - 120px)",
      overflowY: "auto",
      transition: "border-color 0.3s",
      boxShadow: isThreat ? "0 0 20px rgba(239,68,68,0.3)" : "none"
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        marginBottom: "16px",
        paddingBottom: "12px",
        borderBottom: "1px solid #1a1a2e"
      }}>
        <span style={{
          fontSize: "18px",
          animation: geminiData ? "none" : "pulse 1.5s infinite"
        }}>♊</span>
        <div>
          <p style={{
            color: "#a78bfa",
            fontWeight: "bold",
            margin: 0,
            fontSize: "13px"
          }}>
            GEMINI 2.5 FLASH BRAIN
          </p>
          <p style={{
            color: "#666",
            margin: 0,
            fontSize: "10px"
          }}>
            {geminiData ? `Last: ${geminiData.timestamp}` : "Waiting for video..."}
          </p>
        </div>
        <div style={{
          marginLeft: "auto",
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          background: isThreat ? "#ef4444" : geminiData ? "#4ade80" : "#666",
          boxShadow: isThreat ? "0 0 8px #ef4444" : geminiData ? "0 0 8px #4ade80" : "none"
        }} />
      </div>

      {!geminiData && (
        <div style={{
          textAlign: "center",
          padding: "40px 20px",
          color: "#444"
        }}>
          <p style={{
            fontSize: "32px",
            margin: "0 0 12px"
          }}>
            👁️
          </p>
          <p style={{
            fontSize: "13px",
            lineHeight: "1.6"
          }}>
            Start a camera stream to begin Gemini multimodal analysis...
          </p>
        </div>
      )}

      {geminiData && (
        <>
          <div style={{
            background: isThreat ? "rgba(239,68,68,0.1)" : "rgba(74,222,128,0.1)",
            border: `1px solid ${isThreat ? "#ef4444" : "#4ade80"}`,
            borderRadius: "8px",
            padding: "12px",
            marginBottom: "12px"
          }}>
            <p style={{
              color: isThreat ? "#ef4444" : "#4ade80",
              fontWeight: "bold",
              fontSize: "11px",
              margin: "0 0 6px",
              textTransform: "uppercase",
              letterSpacing: "1px"
            }}>
              {isThreat ? "⚠️ THREAT DETECTED" : "✅ SCENE SAFE"}
            </p>
            <p style={{
              color: "#ccc",
              fontSize: "12px",
              margin: "0 0 8px",
              lineHeight: "1.5"
            }}>
              {geminiData.scene}
            </p>
            <div style={{
              display: "flex",
              gap: "12px"
            }}>
              <span style={{
                color: "#888",
                fontSize: "11px"
              }}>
                👥 {geminiData.people_count} people
              </span>
              <span style={{
                color: "#888",
                fontSize: "11px"
              }}>
                🚗 {geminiData.vehicles_count} vehicles
              </span>
            </div>
          </div>

          {isThreat && geminiData.threats.map((t, i) => (
            <div key={i} style={{
              background: "rgba(239,68,68,0.08)",
              border: "1px solid #ef4444",
              borderRadius: "8px",
              padding: "12px",
              marginBottom: "8px"
            }}>
              <div style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "6px"
              }}>
                <p style={{
                  color: "#ef4444",
                  fontWeight: "bold",
                  fontSize: "12px",
                  margin: 0
                }}>
                  🚨 {t.feature || t.type}
                </p>
                <span style={{
                  background: "#ef4444",
                  color: "#fff",
                  fontSize: "10px",
                  padding: "2px 6px",
                  borderRadius: "10px",
                  fontWeight: "bold"
                }}>
                  {t.severity}/10
                </span>
              </div>
              <p style={{
                color: "#fca5a5",
                fontSize: "11px",
                margin: "0 0 6px",
                lineHeight: "1.5"
              }}>
                {t.description}
              </p>
              <p style={{
                color: "#fb923c",
                fontSize: "11px",
                margin: "0 0 4px"
              }}>
                ⚡ {t.action}
              </p>
              <p style={{
                color: "#666",
                fontSize: "10px",
                margin: 0
              }}>
                Evidence: {t.evidence || "N/A"}
                <br />
                Confidence: {Math.round((t.confidence || 0) * 100)}%
              </p>
            </div>
          ))}

          {geminiData.gemini_reasoning && (
            <div style={{
              background: "rgba(124,58,237,0.05)",
              border: "1px solid #4ade80",
              borderRadius: "8px",
              padding: "10px",
              marginBottom: "12px"
            }}>
              <p style={{
                color: "#a78bfa",
                fontSize: "10px",
                fontWeight: "bold",
                margin: "0 0 4px",
                textTransform: "uppercase"
              }}>
                Gemini Reasoning (Thought)
              </p>
              <p style={{
                color: "#888",
                fontSize: "11px",
                margin: 0,
                lineHeight: "1.5",
                fontStyle: "italic"
              }}>
                "{geminiData.gemini_reasoning}"
              </p>
            </div>
          )}

          <div style={{
            borderTop: "1px solid #1a1a2e",
            paddingTop: "10px"
          }}>
            <p style={{
              color: "#444",
              fontSize: "10px",
              margin: "0 0 8px",
              textTransform: "uppercase",
              letterSpacing: "1px"
            }}>
              Analysis Log
            </p>
            {geminiLog.map((log, i) => (
              <div key={i} style={{
                display: "flex",
                gap: "6px",
                marginBottom: "4px",
                alignItems: "flex-start"
              }}>
                <span style={{
                  color: "#444",
                  fontSize: "10px",
                  minWidth: "50px",
                  flexShrink: 0
                }}>
                  {log.timestamp}
                </span>
                <span style={{
                  color: log.safe ? "#4ade80" : "#ef4444",
                  fontSize: "10px",
                  lineHeight: "1.4"
                }}>
                  {log.safe ? "✅" : "🚨"} {(log.scene || "").substring(0, 45)}...
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Webcam Tab ─────────────────────────────────────────────────────────────
function WebcamTab({ onActivate, isActive, detectedLocation, nearbyAuthorities, cityAuth, cityAuthLoading, tavilyData, tavilyLoading }:
  {
    onActivate: () => void;
    isActive: boolean;
    detectedLocation: string;
    nearbyAuthorities: NearbyAuthoritiesData;
    cityAuth: CityAuthoritiesData | null;
    cityAuthLoading: boolean;
    tavilyData: TavilyAuthoritiesData | null;
    tavilyLoading: boolean;
  }) {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-primary/10 border border-primary/20">
            <Camera className="w-5 h-5 text-primary" />
          </div>
          <div>
            <div className="text-sm font-black uppercase tracking-widest">Laptop Webcam</div>
            <div className="text-[10px] text-white/40 uppercase tracking-widest">Uses your built-in or USB camera</div>
          </div>
        </div>

        <Button
          onClick={onActivate}
          className={cn("w-full h-12 rounded-2xl font-black uppercase tracking-widest text-[11px] gap-3",
            isActive ? "bg-green-500/20 border border-green-500/30 text-green-400 hover:bg-green-500/30"
              : "bg-primary text-white hover:bg-primary/90")}
        >
          {isActive ? (
            <>
              <span className="w-2 h-2 rounded-full bg-green-400 inline-block animate-pulse" />
              Webcam Active
            </>
          ) : (
            <>
              <Camera className="w-4 h-4" />
              Activate Webcam
            </>
          )}
        </Button>

        {detectedLocation && detectedLocation !== "Unknown" && (
          <div className="flex items-center gap-2 text-[11px] text-green-400 font-black uppercase tracking-widest">
            <MapPin className="w-3.5 h-3.5" />
            Detected: {detectedLocation}
          </div>
        )}
      </div>

      {Object.keys(nearbyAuthorities).length > 0 && <NearbyAuthoritiesPreview nearby={nearbyAuthorities} />}
      <CityAuthoritiesPreview cityAuth={cityAuth} cityAuthLoading={cityAuthLoading} />
      <MajorAuthoritiesPreview data={tavilyData} loading={tavilyLoading} />
    </div>
  );
}

// ── DroidCam Tab ───────────────────────────────────────────────────────────
function DroidcamTab({
  onActivate,
  cityAuth,
  cityAuthLoading,
  tavilyData,
  tavilyLoading,
}: {
  onActivate: (ip: string, port: number, name: string) => void;
  cityAuth: CityAuthoritiesData | null;
  cityAuthLoading: boolean;
  tavilyData: TavilyAuthoritiesData | null;
  tavilyLoading: boolean;
}) {
  const [ip, setIp] = useState("");
  const [port, setPort] = useState("4747");
  const [name, setName] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [activating, setActivating] = useState(false);
  const { toast } = useToast();

  const testConnection = async () => {
    if (!ip.trim()) { toast({ title: "Enter an IP address first", variant: "destructive" }); return; }
    setTesting(true); setTestResult(null);
    try {
      const res = await fetch(`${API}/api/camera/test`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip_address: ip, port: Number(port) || 4747 }),
      });
      const data = await res.json();
      setTestResult({ ok: data.success, msg: data.message || (data.success ? "Connection successful!" : "Cannot connect") });
    } catch { setTestResult({ ok: false, msg: "Network error — is the backend running?" }); }
    finally { setTesting(false); }
  };

  const activate = async () => {
    if (!ip.trim()) { toast({ title: "Enter an IP address", variant: "destructive" }); return; }
    setActivating(true);
    try { await onActivate(ip, Number(port) || 4747, name || `DroidCam ${ip}`); }
    finally { setActivating(false); }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-blue-500/10 border border-blue-500/20">
            <Smartphone className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <div className="text-sm font-black uppercase tracking-widest">Connect DroidCam</div>
            <div className="text-[10px] text-white/40 uppercase tracking-widest">Your phone as AI camera</div>
          </div>
        </div>

        <div className="space-y-3">
          <Input value={name} onChange={e => setName(e.target.value)}
            placeholder="Camera Name (e.g. My Phone Camera)"
            className="bg-black/40 border-white/10 h-10 rounded-xl text-[12px]" />
          <div className="grid grid-cols-3 gap-2">
            <Input value={ip} onChange={e => setIp(e.target.value)}
              placeholder="192.168.1.X"
              className="col-span-2 bg-black/40 border-white/10 h-10 rounded-xl text-[12px]" />
            <Input value={port} onChange={e => setPort(e.target.value)}
              placeholder="4747"
              className="bg-black/40 border-white/10 h-10 rounded-xl text-[12px]" />
          </div>
          <div className="text-[10px] text-white/30 uppercase tracking-widest">Find this IP in the DroidCam app on your phone</div>
        </div>

        {testResult && (
          <div className={cn("flex items-center gap-2 text-[11px] font-black rounded-xl p-3",
            testResult.ok ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400")}>
            {testResult.ok ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {testResult.msg}
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={testConnection} disabled={testing} variant="outline"
            className="flex-1 h-10 rounded-xl border-white/10 text-[10px] font-black uppercase tracking-widest bg-white/[0.03] hover:bg-white/[0.08]">
            {testing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Test Connection
          </Button>
          <Button onClick={activate} disabled={activating}
            className="flex-1 h-10 rounded-xl bg-primary text-white hover:bg-primary/90 text-[10px] font-black uppercase tracking-widest">
            {activating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Activate DroidCam
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-white/[0.05] bg-white/[0.02] p-5 space-y-3">
        <div className="text-[10px] text-white/60 font-black uppercase tracking-[0.25em]">Setup Instructions</div>
        {[
          "Download DroidCam from the Play Store (free)",
          "Open DroidCam on your phone",
          "Note the IP address shown in the app",
          "Make sure phone and laptop are on the same WiFi",
          "Enter the IP above and click Activate",
        ].map((step, i) => (
          <div key={i} className="flex items-start gap-3 text-[11px] text-white/40">
            <span className="text-[9px] font-black text-primary uppercase tracking-widest mt-0.5 min-w-[20px]">Step {i + 1}</span>
            <span>{step}</span>
          </div>
        ))}
      </div>
      <CityAuthoritiesPreview cityAuth={cityAuth} cityAuthLoading={cityAuthLoading} />
      <MajorAuthoritiesPreview data={tavilyData} loading={tavilyLoading} />
    </div>
  );
}

// ── YouTube Tab ────────────────────────────────────────────────────────────
function YoutubeTab({
  onActivate,
  selectedLocation,
  nearbyAuthorities,
  cityAuth,
  cityAuthLoading,
  tavilyData,
  tavilyLoading,
}: {
  onActivate: (url: string, name: string, location: LocationObj) => void;
  selectedLocation: LocationObj | null;
  nearbyAuthorities: NearbyAuthoritiesData;
  cityAuth: CityAuthoritiesData | null;
  cityAuthLoading: boolean;
  tavilyData: TavilyAuthoritiesData | null;
  tavilyLoading: boolean;
}) {
  const [url, setUrl] = useState("");
  const [streamName, setStreamName] = useState("");
  const [activating, setActivating] = useState(false);
  const { toast } = useToast();

  const activate = async () => {
    if (!url.trim()) { toast({ title: "Enter a YouTube URL", variant: "destructive" }); return; }
    if (!selectedLocation) {
      toast({ title: "Set a location first", description: "Use the Location panel above before loading the stream.", variant: "destructive" });
      return;
    }
    setActivating(true);
    try { await onActivate(url, streamName || "YouTube Stream", selectedLocation); }
    finally { setActivating(false); }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-red-500/10 border border-red-500/20">
            <Youtube className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <div className="text-sm font-black uppercase tracking-widest">YouTube Live Stream</div>
            <div className="text-[10px] text-white/40 uppercase tracking-widest">Remote camera monitoring</div>
          </div>
        </div>

        <div className="space-y-3">
          <Input value={streamName} onChange={e => setStreamName(e.target.value)}
            placeholder="Stream Name (e.g. Traffic Camera — MG Road)"
            className="bg-black/40 border-white/10 h-10 rounded-xl text-[12px]" />
          <Input value={url} onChange={e => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            className="bg-black/40 border-white/10 h-10 rounded-xl text-[12px]" />
          <div className="text-[10px] text-white/30 uppercase tracking-widest">Must be a YouTube LIVE stream, not a regular video</div>
        </div>

        <div className="space-y-2">
          <div className="text-[10px] text-white/60 font-black uppercase tracking-widest flex items-center gap-2">
            <MapPin className="w-3 h-3 text-primary" /> Stream Location
          </div>
          <div className="rounded-xl border border-white/10 bg-black/30 p-3">
            {selectedLocation ? (
              <>
                <div className="text-[12px] text-white font-semibold">
                  {selectedLocation.full_address || [selectedLocation.village, selectedLocation.city, selectedLocation.state].filter(Boolean).join(", ")}
                </div>
                <div className="text-[10px] text-white/40 mt-1">
                  {selectedLocation.latitude.toFixed(4)}, {selectedLocation.longitude.toFixed(4)}
                  {selectedLocation.accuracy ? ` · ±${Math.round(selectedLocation.accuracy)}m` : ""}
                </div>
              </>
            ) : (
              <div className="text-[11px] text-white/40">
                Use the Location panel above to set the stream location. Nearby police, hospitals, and email targeting will use that location.
              </div>
            )}
          </div>
        </div>

        <Button onClick={activate} disabled={activating}
          className="w-full h-12 rounded-2xl bg-primary text-white hover:bg-primary/90 font-black uppercase tracking-widest text-[11px] gap-3">
          {activating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Youtube className="w-4 h-4" />}
          {activating ? "Loading Stream..." : "Load Stream"}
        </Button>
      </div>

      <div className="rounded-2xl border border-orange-500/20 bg-orange-500/5 p-4 space-y-2">
        <div className="text-[10px] text-orange-400 font-black uppercase tracking-widest">⚠ Note</div>
        <div className="text-[11px] text-white/50 leading-relaxed">
          YouTube stream loading takes 10–15 seconds. yt-dlp must be installed. The selected location above controls nearby authority lookup and email targeting.
        </div>
      </div>

      {Object.keys(nearbyAuthorities).length > 0 && <NearbyAuthoritiesPreview nearby={nearbyAuthorities} />}
      <CityAuthoritiesPreview cityAuth={cityAuth} cityAuthLoading={cityAuthLoading} />
      <MajorAuthoritiesPreview data={tavilyData} loading={tavilyLoading} />
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function LiveMonitor() {
  const { toast } = useToast();
  const lastProcessedTsRef = useRef(0);
  const [socket, setSocket] = useState<any>(null);
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const [isWebcamActive, setIsWebcamActive] = useState(false);
  const [isManualStream, setIsManualStream] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [latestAlert, setLatestAlert] = useState<Alert | null>(null);
  const [alertHistory, setAlertHistory] = useState<Alert[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [geminiAnalysis, setGeminiAnalysis] = useState<GeminiAnalysis | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [activeTab, setActiveTab] = useState<CameraTab>("webcam");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [rtspUrl, setRtspUrl] = useState("");
  const [isStartingStream, setIsStartingStream] = useState(false);
  const [location, setLocation] = useState<LocationObj | null>(null);
  const [isLocationLoading, setIsLocationLoading] = useState(true);
  const [isSetupModalOpen, setIsSetupModalOpen] = useState(false);
  const [isEmergencyCallOpen, setIsEmergencyCallOpen] = useState(false);
  const [nearbyAuthorities, setNearbyAuthorities] = useState<NearbyAuthoritiesData>({});
  const [isFetchingTavily, setIsFetchingTavily] = useState(false);
  const [alertModalOpen, setAlertModalOpen] = useState(false);
  const [currentAlert, setCurrentAlert] = useState<Alert | null>(null);
  const [activeLocationName, setActiveLocationName] = useState("Unknown");
  const [tavilyData, setTavilyData] = useState<TavilyAuthoritiesData | null>(null);
  const [tavilyLoading, setTavilyLoading] = useState(false);
  const [userLocation, setUserLocation] = useState<LocationObj | null>(null);
  const [cityAuth, setCityAuth] = useState<CityAuthoritiesData | null>(null);
  const [cityAuthLoading, setCityAuthLoading] = useState(false);
  const [cameraStatus, setCameraStatus] = useState("disconnected");
  const [cameraName, setCameraName] = useState("N/A");
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [isAlertsConfigured, setIsAlertsConfigured] = useState(false);
  const [activeCallIncident, setActiveCallIncident] = useState<{ incident_type: string; location: string; severity: number } | null>(null);
  const [isCallOverlayOpen, setIsCallOverlayOpen] = useState(false);
  const [geminiData, setGeminiData] = useState<GeminiAnalysis | null>(null);
  const [geminiLog, setGeminiLog] = useState<GeminiAnalysis[]>([]);
  const [activeCamera, setActiveCamera] = useState<CameraTab | null>(null);
  const [voiceAlertText, setVoiceAlertText] = useState("");
  const [isVoicePlaying, setIsVoicePlaying] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fullScreenRef = useRef<HTMLDivElement>(null);
  const isLiveRef = useRef(true);
  const imgRef = useRef<HTMLImageElement>(null);
  const voicedEmailAlertIdsRef = useRef<Set<string>>(new Set());
  const scheduledVoiceAlertIdsRef = useRef<Set<string>>(new Set());
  const delayedVoiceTimeoutsRef = useRef<Record<string, number>>({});

  const { speak } = useEmergencySpeech();

  const playBackendVoiceAlert = useCallback(async (text: string) => {
    try {
      const res = await fetch(`${API}/api/voice/emergency`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        throw new Error(`voice fallback failed: ${res.status}`);
      }

      const audioBlob = await res.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audio.preload = "auto";
      audio.play().catch(() => null);
      audio.onended = () => URL.revokeObjectURL(audioUrl);
      audio.onerror = () => URL.revokeObjectURL(audioUrl);
    } catch (error) {
      console.error("Backend voice fallback failed", error);
    }
  }, []);

  const buildVoiceAlertText = useCallback((alertData: Alert) => {
    const location = alertData.location || "Unknown";
    const time = alertData.timestamp
      ? new Date(alertData.timestamp).toLocaleTimeString()
      : new Date().toLocaleTimeString();
    const incidentSummary = (alertData.gemini_description || alertData.description || alertData.feature_name || alertData.incident_type || "Incident detected").trim();

    return [
      "Due to trial limitations of Twilio, real-time phone calls to unverified numbers are restricted.",
      "However, we have implemented a real-time voice alert system that replicates emergency calls instantly.",
      "Emergency Alert.",
      `What was detected: ${incidentSummary}.`,
      `Location: ${location}.`,
      `Time: ${time}.`,
      "Immediate attention is required. Please respond promptly.",
    ].join(" ");
  }, []);

  const playVoiceMessage = useCallback(async (message: string) => {
    setIsVoicePlaying(true);
    try {
      const browserSpoke = speak({ text: message });
      if (!browserSpoke) {
        await playBackendVoiceAlert(message);
      }
    } finally {
      window.setTimeout(() => setIsVoicePlaying(false), 3500);
    }
  }, [playBackendVoiceAlert, speak]);

  const openLiveAlertPopup = useCallback((alertData: Alert) => {
    const uniqueId = String(alertData.id || `${alertData.incident_type}-${alertData.timestamp || Date.now()}`);
    const message = buildVoiceAlertText(alertData);

    if (!scheduledVoiceAlertIdsRef.current.has(uniqueId)) {
      scheduledVoiceAlertIdsRef.current.add(uniqueId);
      delayedVoiceTimeoutsRef.current[uniqueId] = window.setTimeout(() => {
        void playVoiceMessage(message);
      }, VOICE_AUTO_DELAY_MS);
    }

    if (voicedEmailAlertIdsRef.current.has(uniqueId)) {
      // Keep the popup open for the latest detection, but don't duplicate voice text state.
      setCurrentAlert(alertData);
      setAlertModalOpen(true);
      setVoiceAlertText(message);
      return;
    }

    voicedEmailAlertIdsRef.current.add(uniqueId);
    setCurrentAlert(alertData);
    setAlertModalOpen(true);
    setVoiceAlertText(message);
  }, [buildVoiceAlertText, playVoiceMessage]);

  const handlePlayVoiceAlert = useCallback(async () => {
    if (!currentAlert) return;

    const message = voiceAlertText || buildVoiceAlertText(currentAlert);
    await playVoiceMessage(message);
  }, [buildVoiceAlertText, currentAlert, playVoiceMessage, voiceAlertText]);

  useEffect(() => {
    return () => {
      Object.values(delayedVoiceTimeoutsRef.current).forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      delayedVoiceTimeoutsRef.current = {};
    };
  }, []);

  const fetchAuthorities = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/authorities/nearby`);
      const data = await res.json();
      const payload = data?.data ?? data;
      setNearbyAuthorities(payload?.authorities || {});
      setActiveLocationName(payload?.location?.name || payload?.location?.location_name || "Unknown");
    } catch { /* silently ignore */ }
  }, []);

  const loadMajorAuthorities = useCallback(async () => {
    try {
      setTavilyLoading(true);
      const res = await fetch(`${API}/api/location/authorities`);
      const data = await res.json();
      const payload = data?.data ?? data;
      if (!payload.searching) {
        setTavilyData((payload.hospital?.length || payload.police?.length) ? payload : null);
        setTavilyLoading(false);
      }
      // If searching=true, keep spinner — socket tavily_authorities will fire when done
    } catch {
      setTavilyLoading(false);
    }
  }, []);

  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(async (position) => {
        const { latitude, longitude } = position.coords;
        try {
          const res = await fetch(`${API}/api/location/update`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ latitude, longitude })
          });
          const data = await res.json();
          if (data.success) {
            setActiveLocationName(data.data.location_name);
            await fetchAuthorities();
            void loadMajorAuthorities();
          }
        } catch (err) {
          console.error("Failed to update GPS location", err);
        }
      }, (error) => {
        console.warn("Geolocation blocked or failed", error);
        fetchAuthorities(); // fallback to current server location
        void loadMajorAuthorities();
      });
    } else {
      fetchAuthorities();
      void loadMajorAuthorities();
    }
  }, [fetchAuthorities, loadMajorAuthorities]);

  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(async (position) => {
        const { latitude, longitude } = position.coords;
        try {
          const res = await fetch(`${API}/api/location/update`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ latitude, longitude })
          });
          const data = await res.json();
          if (data.success) {
            setActiveLocationName(data.data.location_name);
            await fetchAuthorities();
            void loadMajorAuthorities();
          }
        } catch (err) {
          console.error("Failed to update GPS location", err);
        }
      }, (error) => {
        console.warn("Geolocation blocked or failed", error);
        fetchAuthorities(); // fallback to current server location
        void loadMajorAuthorities();
      });
    } else {
      fetchAuthorities();
      void loadMajorAuthorities();
    }
  }, [fetchAuthorities, loadMajorAuthorities]);

  const handleLocationSet = useCallback(async (loc: LocationObj) => {
    setUserLocation(loc);
    setCityAuth(null);
    setCityAuthLoading(true);
    setActiveLocationName(
      [loc.village, loc.city, loc.state].filter(Boolean).join(", ") || loc.full_address || "Unknown"
    );
    await fetchAuthorities();
    void loadMajorAuthorities();
  }, [fetchAuthorities, loadMajorAuthorities]);

  // Initial data fetch and GPS location
  useEffect(() => {
    // 1. Fetch initial stats
    fetch(`${API}/api/stats/today`).then(r => r.json()).then(data => {
      const p = data?.data ?? data;
      setStats({ total_alerts: p?.total_incidents || 0, high_severity: p?.high_severity_count || 0, authorities_contacted: p?.authorities_contacted || 0, active_cameras: p?.active_cameras || 0 });
    }).catch(() => null);

    fetch(`${API}/api/location/search-authorities`, {
      method: "POST",
    }).catch(() => { });

    // 2. Browser GPS Collection
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(async (position) => {
        const { latitude, longitude } = position.coords;
        try {
          const res = await fetch(`${API}/api/location/update`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ latitude, longitude })
          });
          const data = await res.json();
          if (data.success) {
            setActiveLocationName(data.data.location_name);
            await fetchAuthorities();
            void loadMajorAuthorities();
          }
        } catch (err) {
          console.error("Failed to update GPS location", err);
        }
      }, (error) => {
        console.warn("Geolocation blocked or failed", error);
        fetchAuthorities(); // fallback to current server location
        void loadMajorAuthorities();
      });
    } else {
      fetchAuthorities();
      void loadMajorAuthorities();
    }
  }, [fetchAuthorities, loadMajorAuthorities]);

  // Socket
  useEffect(() => {
    const socket = io(import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000', {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    });
    setSocket(socket);
    setIsSocketConnected(true);

    socket.on("connect", () => {
      setCameraStatus("connected");
      toast({ title: "Connected to Safety Engine", duration: 2000 });
    });
    socket.on("disconnect", () => {
      setCameraStatus("disconnected");
      setIsSocketConnected(false);
      toast({ title: "Connection Lost", description: "Reconnecting...", variant: "destructive" });
    });
    socket.on("frame", (data: any) => {
      if (!isLiveRef.current) return;
      const b64 = typeof data === "string" ? data : data?.frame;
      if (b64 && imgRef.current) {
        imgRef.current.src = `data:image/jpeg;base64,${b64}`;
      }
    });
    // Detection data moved to polling for GCloud Run stability
    /*
    socket.on("new_alert", (data: Alert) => { ... });
    socket.on("alert", (alert: Alert) => { ... });
    socket.on("gemini_analysis", (data: GeminiAnalysis) => { ... });
    */
    socket.on("gemini_reset", () => {
      setGeminiData(null);
      setGeminiLog([]);
    });
    socket.on("location_updated", (location: LocationObj & { location_name?: string }) => {
      setUserLocation(location);
      setCityAuth(null);
      setCityAuthLoading(true);
      setActiveLocationName(location.location_name || location.full_address || "Unknown");
      fetchAuthorities();
      void loadMajorAuthorities();
    });
    socket.on("city_authorities_loading", () => {
      setCityAuthLoading(true);
      setCityAuth(null);
    });
    socket.on("city_authorities", (data: CityAuthoritiesData) => {
      setCityAuth(data || null);
      setCityAuthLoading(false);
    });
    socket.on("tavily_authorities", (data: TavilyAuthoritiesData) => {
      setTavilyData(data || null);
      setTavilyLoading(false);
    });
    return () => {
      socket.disconnect();
    };
  }, [toast]);

  // Polling for detection results (GCloud Run compatibility)
  useEffect(() => {
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`${API}/api/detections/latest`);
        const data = await res.json();
        
        if (!data || data.timestamp <= lastProcessedTsRef.current) return;
        lastProcessedTsRef.current = data.timestamp;

        if (data.camera_status) {
          setCameraStatus(data.camera_status.status);
          if (data.camera_status.camera_name) setCameraName(data.camera_status.camera_name);
        }

        if (data.gemini_analysis) {
          setGeminiData(data.gemini_analysis);
          setGeminiLog(prev => {
            if (prev[0]?.timestamp === data.gemini_analysis.timestamp) return prev;
            return [data.gemini_analysis, ...prev.slice(0, 29)];
          });
        }

        if (data.latest_alert) {
          const alert = data.latest_alert;
          // Check if this is a new alert by ID or timestamp
          setLatestAlert(alert);
          setAlertHistory(prev => {
            if (prev.find(a => a.id === alert.id)) return prev;
            return [alert, ...prev].slice(0, 4);
          });
          
          if (alert.severity_score >= 7) {
            openLiveAlertPopup(alert);
            toast({
              title: "🚨 New High-Severity Alert!",
              description: `${alert.incident_type} detected.`,
              variant: "destructive",
            });
          }
        }
      } catch (e) {
        console.error("Polling failed:", e);
      }
    }, 2500);

    return () => clearInterval(pollInterval);
  }, [toast, openLiveAlertPopup]);

  // WebRTC capture for Webcam mode
  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    const startWebcam = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;

          videoRef.current.onloadedmetadata = () => {
            videoRef.current!.play();

            intervalId = setInterval(() => {
              const video = videoRef.current;
              if (!video || video.readyState < 2 || video.videoWidth === 0) return;

              const canvas = document.createElement('canvas');
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const base64Data = canvas.toDataURL('image/jpeg', 0.8);
                fetch(`${API}/api/webcam/frame`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ frame: base64Data })
                }).catch(err => console.error("Webcam upload failed:", err));
              }
            }, 2000);
          };
        }
      } catch (err) {
        console.error("Error accessing webcam: ", err);
        toast({ title: "Webcam Access Denied", description: "Please allow webcam access in your browser.", variant: "destructive" });
      }
    };

    const stopWebcam = () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      if (intervalId) clearInterval(intervalId);
    };

    if (activeCamera === "webcam") {
      startWebcam();
    } else {
      stopWebcam();
    }

    return () => {
      stopWebcam();
    };
  }, [activeCamera, toast]);

  // Activate webcam
  const activateWebcam = async () => {
    setCameraStatus("connecting");
    try {
      const res = await fetch(`${API}/api/camera/source`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_type: "webcam" }),
      });
      const data = await res.json();
      const payload = data?.data ?? data;
      if (payload?.active_location?.location_name) setActiveLocationName(payload.active_location.location_name);
      setActiveCamera("webcam");
      await fetchAuthorities();
      toast({ title: "Webcam activated", duration: 2000 });
    } catch (e) {
      toast({ title: "Failed to activate webcam", variant: "destructive" });
      setCameraStatus("disconnected");
    }
  };

  // Activate DroidCam
  const activateDroidcam = async (ip: string, port: number, name: string) => {
    setCameraStatus("connecting");
    try {
      const res = await fetch(`${API}/api/camera/source`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_type: "ipcam", ip_address: ip, port, camera_name: name }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: data?.error || "Failed to connect", variant: "destructive" }); setCameraStatus("disconnected"); return; }
      setActiveCamera("droidcam");
      await fetchAuthorities();
      toast({ title: "DroidCam connected", duration: 2000 });
    } catch (e) {
      toast({ title: "Connection error", variant: "destructive" });
      setCameraStatus("disconnected");
    }
  };

  // Activate YouTube
  const activateYoutube = async (url: string, name: string, location: LocationObj) => {
    setCameraStatus("connecting");
    try {
      const locationName = [location.village, location.city, location.state].filter(Boolean).join(", ") || location.full_address || "Unknown";
      const res = await fetch(`${API}/api/camera/source`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_type: "youtube",
          url,
          youtube_url: url,
          camera_name: name,
          location_name: locationName,
          latitude: location.latitude,
          longitude: location.longitude,
          location,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 503) {
          toast({
            title: "YouTube Stream Blocked",
            description: data?.message || "YouTube is blocking this stream. Please try a different public video URL, or use webcam/DroidCam mode instead.",
            variant: "destructive"
          });
          setCameraStatus("disconnected");
          return;
        }
        toast({
          title: "Stream Loading Failed",
          description: data?.error || data?.message || "YouTube stream could not be processed. Please check the URL.",
          variant: "destructive"
        });
        setCameraStatus("disconnected");
        return;
      }
      setActiveCamera("youtube");
      setActiveLocationName(locationName);
      await fetchAuthorities();
      toast({
        title: "YouTube Stream Initialized",
        description: "yt-dlp is extracting the feed. Please wait 10-15 seconds for playback.",
        duration: 8000
      });
    } catch (e) {
      toast({ title: "Stream error", variant: "destructive" });
      setCameraStatus("disconnected");
    }
  };

  const connectRTSP = async () => {
    if (!rtspUrl.trim()) return;
    try {
      const res = await fetch(`${API}/api/camera/source`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source: "rtsp",
          url: rtspUrl.trim(),
        }),
      });
      const data = await res.json();
      if (data.error) {
        alert(`RTSP Error: ${data.error}`);
        return;
      }
      if (!res.ok) {
        alert(`RTSP Error: ${data?.message || "Could not connect RTSP stream"}`);
        return;
      }
      setActiveCamera("rtsp");
      toast({ title: "RTSP stream connected", duration: 3000 });
    } catch (e) {
      console.error(e);
    }
  };

  const getSeverityStatus = (score: number) => score >= 7 ? "high" : score >= 4 ? "medium" : "low";

  const TABS: { id: CameraTab; label: string; icon: any }[] = [
    { id: "webcam", label: "📷 Webcam", icon: Camera },
    { id: "droidcam", label: "📱 DroidCam", icon: Smartphone },
    { id: "youtube", label: "▶ YouTube", icon: Youtube },
  ];

  return (
    <div className="flex flex-col gap-8 pb-20">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5">
        <div>
          <h1 className="text-3xl font-black tracking-tighter uppercase mb-2">Live Monitor</h1>
          <p className="text-xs text-white/40 font-medium uppercase tracking-widest">Real-time camera surveillance, AI detections, and emergency dispatch</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className={cn("flex items-center gap-3 px-4 py-2.5 border rounded-2xl transition-colors",
            cameraStatus === "connected" ? "bg-primary/20 border-primary/20" :
              cameraStatus === "connecting" ? "bg-orange-500/20 border-orange-500/20" : "bg-red-900/40 border-red-500/40")}>
            <Radio className={cn("w-3.5 h-3.5",
              cameraStatus === "connected" ? "text-primary animate-pulse" :
                cameraStatus === "connecting" ? "text-orange-400 animate-pulse" : "text-red-500")} />
            <span className={cn("text-[10px] font-black uppercase tracking-[0.3em]",
              cameraStatus === "connected" ? "text-primary" : cameraStatus === "connecting" ? "text-orange-400" : "text-red-500")}>
              {cameraStatus === "connected" ? `LIVE • ${cameraName}` :
                cameraStatus === "connecting" ? "CONNECTING..." : "DISCONNECTED"}
            </span>
          </div>
          <Button
            onClick={() => setIsSetupModalOpen(true)}
            variant="outline"
            className="rounded-2xl border-white/10 bg-white/5 hover:bg-blue-600/20 hover:border-blue-500/50 text-[10px] font-black uppercase tracking-widest gap-2"
          >
            <Smartphone size={14} className="text-blue-400" />
            Setup Alerts
          </Button>
        </div>
      </div>

      <div className="premium-glass bg-white/[0.01] border-white/[0.03] rounded-3xl p-4 lg:p-5">
        <div className="flex flex-wrap gap-2">
          {TABS.map(tab => (
            <Button
              key={tab.id}
              variant="ghost"
              size="sm"
              className={cn("text-[10px] font-black uppercase tracking-[0.15em] px-5 h-9 transition-all rounded-xl",
                activeTab === tab.id ? "bg-white/[0.08] text-white shadow-xl" : "text-white/30 hover:text-white hover:bg-white/[0.04]")}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </Button>
          ))}
          <button
            onClick={() => setActiveTab("rtsp")}
            style={{
              height: "36px",
              borderRadius: "12px",
              border: "1px solid rgba(76,201,240,0.35)",
              padding: "0 16px",
              fontSize: "10px",
              fontWeight: 800,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              cursor: "pointer",
              background: activeTab === "rtsp" ? "#4cc9f0" : "transparent",
              color: activeTab === "rtsp" ? "#000" : "#4cc9f0",
            }}
          >
            📡 RTSP
          </button>
        </div>
      </div>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          <div
            ref={fullScreenRef}
            data-live-feed
            className={cn(
              "premium-glass relative aspect-video bg-black rounded-3xl overflow-hidden border border-white/[0.06]",
              isFullScreen && "fixed inset-0 z-50 w-full h-full rounded-none"
            )}
          >
            <img ref={imgRef} className={cn("w-full h-full object-contain", activeCamera === "webcam" ? "hidden" : "block")} alt="Live feed" />
            <video ref={videoRef} autoPlay playsInline muted className={cn("w-full h-full object-contain", activeCamera === "webcam" ? "block" : "hidden")} />
            <AnimatePresence>
              {!isSocketConnected && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center text-center"
                >
                  <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
                  <p className="text-lg font-bold">Connecting to Safety Engine...</p>
                  <p className="text-sm text-gray-400">Please wait.</p>
                </motion.div>
              )}
            </AnimatePresence>
            {streamError && (
              <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center text-center p-4">
                <XCircle className="w-12 h-12 text-red-500 mb-4" />
                <p className="text-xl font-bold text-red-400">Stream Error</p>
                <p className="text-gray-300 mt-2">{streamError}</p>
              </div>
            )}
            <div className="absolute top-4 left-4 flex items-center gap-2">
              <div className={cn(
                "flex items-center gap-2 text-xs font-bold py-1 px-3 rounded-full",
                isSocketConnected ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"
              )}>
                <span className={cn("w-2 h-2 rounded-full", isSocketConnected ? "bg-green-500 animate-pulse" : "bg-red-500")} />
                {isSocketConnected ? "CONNECTED" : "DISCONNECTED"}
              </div>
            </div>
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/70 to-transparent">
              <div className="flex justify-between items-end">
                <div>
                  <h2 className="text-2xl font-bold">Main Feed</h2>
                  <div className="flex items-center gap-2 text-sm text-gray-300">
                    <MapPin size={16} />
                    <span>{activeLocationName}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => (videoRef.current?.paused ? videoRef.current?.play() : videoRef.current?.pause())}
                    size="icon"
                    variant="ghost"
                    className="text-white hover:bg-white/10"
                  >
                    {isWebcamActive ? <Pause size={20} /> : <Play size={20} />}
                  </Button>
                  <Button
                    onClick={() => setIsFullScreen(!isFullScreen)}
                    size="icon"
                    variant="ghost"
                    className="text-white hover:bg-white/10"
                  >
                    <Maximize2 size={20} />
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl premium-glass p-5 bg-white/[0.02] border-white/[0.05] space-y-4">
            <div className="flex items-center gap-2 text-[10px] text-white/40 font-black uppercase tracking-[0.25em]">
              <ChevronRight className="w-4 h-4 text-primary" />
              Camera Source
            </div>
            <LocationPanel onLocationSet={handleLocationSet} />
            {activeTab === "webcam" && (
              <WebcamTab
                onActivate={activateWebcam}
                isActive={activeCamera === "webcam"}
                detectedLocation={activeLocationName}
                nearbyAuthorities={nearbyAuthorities}
                cityAuth={cityAuth}
                cityAuthLoading={cityAuthLoading}
                tavilyData={tavilyData}
                tavilyLoading={tavilyLoading}
              />
            )}
            {activeTab === "droidcam" && (
              <DroidcamTab
                onActivate={activateDroidcam}
                cityAuth={cityAuth}
                cityAuthLoading={cityAuthLoading}
                tavilyData={tavilyData}
                tavilyLoading={tavilyLoading}
              />
            )}
            {activeTab === "youtube" && (
              <YoutubeTab
                onActivate={activateYoutube}
                selectedLocation={userLocation}
                nearbyAuthorities={nearbyAuthorities}
                cityAuth={cityAuth}
                cityAuthLoading={cityAuthLoading}
                tavilyData={tavilyData}
                tavilyLoading={tavilyLoading}
              />
            )}
            {activeTab === "rtsp" && (
              <div>
                <p style={{ color: "#888", fontSize: "12px", marginBottom: "8px" }}>
                  Connect any IP camera,
                  DVR or government CCTV
                  that supports RTSP protocol
                </p>
                <input
                  value={rtspUrl}
                  onChange={e => setRtspUrl(e.target.value)}
                  placeholder="http://pendelcam.kip.uni-heidelberg.de/mjpg/video.mjpg"
                  style={{
                    width: "100%",
                    background: "#111",
                    border: "1px solid #333",
                    color: "#fff",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    fontSize: "11px",
                    marginBottom: "6px",
                    boxSizing: "border-box",
                  }}
                />
                <p style={{ color: "#444", fontSize: "10px", marginBottom: "10px" }}>
                  Examples:
                  rtsp://admin:admin@IP/stream1
                  rtsp://IP:554/live/ch0
                </p>
                <button
                  onClick={connectRTSP}
                  style={{
                    width: "100%",
                    background: "rgba(76,201,240,0.1)",
                    border: "1px solid #4cc9f0",
                    color: "#4cc9f0",
                    padding: "10px",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontWeight: "bold",
                    fontSize: "13px",
                  }}
                >
                  📡 Connect RTSP Stream
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Alerts Today", value: stats?.total_alerts ?? 0, icon: Target, color: "text-primary", bg: "bg-primary/10" },
              { label: "Critical Severity", value: stats?.high_severity ?? 0, icon: ShieldAlert, color: "text-primary", bg: "bg-primary/20", glow: true },
              { label: "Authorities Alerted", value: stats?.authorities_contacted ?? 0, icon: Siren, color: "text-orange-400", bg: "bg-orange-400/10" },
              { label: "Active Cameras", value: stats?.active_cameras ?? 0, icon: Radio, color: "text-green-400", bg: "bg-green-400/10" },
            ].map((stat, idx) => (
              <div key={idx} className={cn(
                "premium-glass p-5 bg-white/[0.02] border-white/[0.04] flex flex-col gap-3 group hover:bg-white/[0.04] rounded-2xl",
                stat.glow && "red-glow-soft ring-1 ring-primary/20"
              )}>
                <div className="flex items-center justify-between">
                  <div className={cn("p-2 rounded-xl border border-white/5", stat.bg)}>
                    <stat.icon className={cn("w-4 h-4", stat.color)} />
                  </div>
                  <div className="text-[10px] text-white/20 uppercase tracking-[0.2em] font-black">24h</div>
                </div>
                <div>
                  <div className="text-3xl font-black tracking-tighter mb-1">{stat.value}</div>
                  <div className="text-[10px] text-white/40 uppercase font-black tracking-widest">{stat.label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="xl:col-span-1 space-y-6">
          <GeminiSidebar geminiData={geminiData} geminiLog={geminiLog} />

          <div className="space-y-4">
            <div className="flex items-center justify-between px-2">
              <div className="flex flex-col">
                <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-white/30">Safety Engine</h3>
                <span className="text-lg font-black tracking-tighter flex items-center gap-2">
                  LIVE ACTIVITY
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-primary" />
                  </span>
                </span>
              </div>
              <Button variant="ghost" size="icon" className="w-10 h-10 rounded-xl hover:bg-white/5">
                <MoreVertical size={24} className="text-gray-400" />
              </Button>
            </div>

            {alerts.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center premium-glass rounded-2xl bg-white/[0.01] border-white/[0.04]">
                <ShieldAlert className="w-10 h-10 text-white/10 mb-3" />
                <div className="text-[10px] text-white/20 uppercase tracking-widest font-black">No alerts yet</div>
                <div className="text-[10px] text-white/10 uppercase tracking-widest mt-1">System is monitoring</div>
              </div>
            )}

            <div className="space-y-4 max-h-[56vh] overflow-y-auto pr-1">
              <AnimatePresence initial={false}>
                {alerts.map((alert) => {
                  const status = getSeverityStatus(alert.severity_score);
                  return (
                    <motion.div
                      key={alert.id}
                      initial={{ opacity: 0, height: 0, y: -20 }}
                      animate={{ opacity: 1, height: "auto", y: 0 }}
                      exit={{ opacity: 0, scale: 0.9, height: 0 }}
                      className={cn(
                        "premium-glass p-4 bg-white/[0.02] border-white/[0.05] group cursor-pointer transition-all hover:bg-white/[0.06] border-l-4 rounded-2xl",
                        status === "high" ? "border-l-primary" : status === "medium" ? "border-l-orange-500" : "border-l-green-500"
                      )}
                    >
                      <div className="flex flex-col gap-3">
                        <div className="flex justify-between items-start">
                          <h4 className="text-xs font-black tracking-tight leading-tight uppercase group-hover:text-primary transition-colors flex items-center gap-2">
                            <ShieldAlert className="w-4 h-4" />{alert.incident_type}
                          </h4>
                          <div className={cn(
                            "text-[10px] font-black px-1.5 py-0.5 rounded-lg uppercase tracking-widest whitespace-nowrap",
                            status === "high" ? "bg-primary/20 text-primary" : status === "medium" ? "bg-orange-500/20 text-orange-400" : "bg-green-500/20 text-green-400"
                          )}>
                            {alert.severity_score}/10
                          </div>
                        </div>

                        {alert.screenshot && (
                          <div className="w-full h-28 rounded-xl overflow-hidden relative">
                            <img
                              src={`data:image/jpeg;base64,${alert.screenshot}`}
                              className="w-full h-full object-cover grayscale brightness-75 group-hover:grayscale-0 group-hover:brightness-100 transition-all duration-700"
                              alt="Incident"
                              onClick={() => window.open(`data:image/jpeg;base64,${alert.screenshot}`, "_blank")}
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />
                            <div className="absolute bottom-2 left-2 text-[9px] uppercase font-black tracking-widest bg-black/60 px-2 py-0.5 rounded border border-white/10">
                              {alert.feature_name}
                            </div>
                          </div>
                        )}

                        <div className="text-[10px] text-white/50 leading-relaxed">{alert.gemini_description}</div>

                        <NearbyAuthorities nearby={alert.nearby_authorities} />

                        <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-white/40">
                          <MapPin className="w-3 h-3 text-primary/60" />
                          <span className="truncate">{alert.location}</span>
                        </div>

                        <div className="flex items-center gap-2 mt-1 pt-2 border-t border-white/5">
                          {alert.alert_channels?.sms && <TooltipIcon icon={MessageCircle} status={alert.alert_channels.sms} label="SMS" />}
                          {alert.alert_channels?.telegram && <TooltipIcon icon={Smartphone} status={alert.alert_channels.telegram} label="Telegram" />}
                          {alert.alert_channels?.email && <TooltipIcon icon={Mail} status={alert.alert_channels.email} label="Email" />}
                          <div className="flex-1 flex justify-end">
                            <span className="text-[9px] text-white/30 font-black uppercase tracking-widest flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {alert.timestamp ? new Date(alert.timestamp).toLocaleTimeString("en-US") : "--:--"}
                            </span>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>

            {currentAlert && (
              <EmergencyAlertModal
                isOpen={alertModalOpen}
                onClose={() => setAlertModalOpen(false)}
                incidentType={currentAlert.gemini_description || currentAlert.feature_name || currentAlert.incident_type}
                location={currentAlert.location}
                time={new Date(currentAlert.timestamp).toLocaleString()}
                additionalMessage={currentAlert.gemini_description || currentAlert.description || currentAlert.incident_type}
                onPlayVoice={handlePlayVoiceAlert}
                isPlayingVoice={isVoicePlaying}
              />
            )}
          </div>
        </div>
      </section>

      <AdminSetupModal isOpen={isSetupModalOpen} onClose={() => setIsSetupModalOpen(false)} />
      <EmergencyCallOverlay isOpen={isCallOverlayOpen} onClose={() => setIsCallOverlayOpen(false)} incident={activeCallIncident} />
      
      {/* Hidden WebRTC Elements for Webcam capture */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
}

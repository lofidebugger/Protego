import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  CheckCircle2,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Save,
  Trash2,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { io, Socket } from "socket.io-client";

type CameraSourceType = "webcam" | "ipcam" | "youtube";
type AuthorityType = "hospital" | "police" | "fire" | "traffic" | "municipal";

type Camera = {
  id: string;
  name: string;
  source_type: CameraSourceType;
  ip_address: string;
  youtube_url: string;
  location_name: string;
  latitude: number;
  longitude: number;
  is_active: boolean;
};

type Contact = {
  id: string;
  name: string;
  authority_type: AuthorityType;
  email: string;
  whatsapp_number: string;
  latitude: number;
  longitude: number;
};

type PreferenceFeature = {
  feature_id: string;
  feature_name: string;
  is_enabled: boolean;
  severity_override: number | null;
};

type Preferences = {
  minimum_severity_threshold: number;
  duplicate_alert_cooldown_seconds: 30 | 60 | 120 | 300;
  channels: {
    telegram: boolean;
    sms: boolean;
    email: boolean;
  };
  features: PreferenceFeature[];
  demo_email: string;
  demo_phone: string;
  show_real_institution_details: boolean;
};

type CameraForm = Omit<Camera, "id">;
type ContactForm = Omit<Contact, "id">;

type LeafletMap = {
  setView: (coords: [number, number], zoom: number) => LeafletMap;
  remove: () => void;
  on: (event: string, handler: (event: { latlng: { lat: number; lng: number } }) => void) => void;
};

type LeafletMarker = {
  setLatLng: (coords: [number, number]) => void;
  remove: () => void;
};

type LeafletNamespace = {
  map: (el: HTMLElement) => LeafletMap;
  tileLayer: (url: string, options?: Record<string, unknown>) => { addTo: (map: LeafletMap) => void };
  marker: (coords: [number, number], options?: Record<string, unknown>) => { addTo: (map: LeafletMap) => LeafletMarker };
};

declare global {
  interface Window {
    L?: LeafletNamespace;
  }
}

const API_BASE = "http://127.0.0.1:5000";
const HYDERABAD: [number, number] = [17.385, 78.4867];
const COOLDOWN_OPTIONS = [
  { label: "30 seconds", value: 30 },
  { label: "1 minute", value: 60 },
  { label: "2 minutes", value: 120 },
  { label: "5 minutes", value: 300 },
] as const;
const AUTHORITY_LABELS: Record<AuthorityType, string> = {
  hospital: "Hospitals",
  police: "Police Stations",
  fire: "Fire Stations",
  traffic: "Traffic Police",
  municipal: "Municipal",
};

const defaultCameraForm: CameraForm = {
  name: "",
  source_type: "webcam",
  ip_address: "",
  youtube_url: "",
  location_name: "",
  latitude: HYDERABAD[0],
  longitude: HYDERABAD[1],
  is_active: true,
};

const defaultContactForm: ContactForm = {
  name: "",
  authority_type: "police",
  email: "",
  whatsapp_number: "",
  latitude: HYDERABAD[0],
  longitude: HYDERABAD[1],
};

const defaultPreferences: Preferences = {
  minimum_severity_threshold: 5,
  duplicate_alert_cooldown_seconds: 60,
  channels: {
    telegram: true,
    sms: true,
    email: true,
  },
  features: [
    { feature_id: "feat-1", feature_name: "Distress & Assault Detection", is_enabled: true, severity_override: null },
    { feature_id: "feat-2", feature_name: "Road Accident Detection", is_enabled: true, severity_override: null },
    { feature_id: "feat-3", feature_name: "Medical Emergency Detection", is_enabled: true, severity_override: null },
    { feature_id: "feat-4", feature_name: "Stampede Prediction", is_enabled: true, severity_override: null },
    { feature_id: "feat-5", feature_name: "Kidnapping & Loitering", is_enabled: true, severity_override: null },
    { feature_id: "feat-6", feature_name: "Illegal Dumping Detection", is_enabled: true, severity_override: null },
    { feature_id: "feat-7", feature_name: "Reckless Driving", is_enabled: true, severity_override: null },
    { feature_id: "feat-8", feature_name: "Early Fire Detection", is_enabled: true, severity_override: null },
  ],
  demo_email: "",
  demo_phone: "",
  show_real_institution_details: true,
};

type NearbyAuthority = {
  name: string;
  type: AuthorityType;
  distance_km: number;
  phone?: string;
  real_email?: string;
  is_city_referral?: boolean;
  referral_city?: string;
  is_top_hospital?: boolean;
  source?: string;
};

type TavilyAuthority = {
  name: string;
  phone?: string;
  email?: string;
  type?: string;
  address?: string;
  jurisdiction?: string;
  has_real_phone?: boolean;
  source?: string;
};

type TavilyAuthoritiesData = {
  hospital?: TavilyAuthority[];
  police?: TavilyAuthority[];
};

const isNearbyAuthorityArray = (value: unknown): value is NearbyAuthority[] => {
  return Array.isArray(value);
};

const toNumber = (value: string | number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return r * c;
};

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.error === "string" ? body.error : `Request failed (${response.status})`;
    throw new Error(message);
  }
  if (body && typeof body === "object" && "success" in body) {
    return (body.data as T) ?? ({} as T);
  }
  return body as T;
}

function useLeafletAssets() {
  const [ready, setReady] = useState<boolean>(Boolean(window.L));

  useEffect(() => {
    if (window.L) {
      setReady(true);
      return;
    }

    const cssId = "leaflet-css-cdn";
    if (!document.getElementById(cssId)) {
      const link = document.createElement("link");
      link.id = cssId;
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }

    const scriptId = "leaflet-js-cdn";
    const existing = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => setReady(true));
      return;
    }

    const script = document.createElement("script");
    script.id = scriptId;
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.async = true;
    script.onload = () => setReady(true);
    document.body.appendChild(script);
  }, []);

  return ready;
}

function MapPicker({
  latitude,
  longitude,
  onPick,
}: {
  latitude: number;
  longitude: number;
  onPick: (coords: { latitude: number; longitude: number }) => void;
}) {
  const isLeafletReady = useLeafletAssets();
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<LeafletMarker | null>(null);

  useEffect(() => {
    if (!isLeafletReady || !window.L || !mapRef.current || mapInstanceRef.current) {
      return;
    }

    const L = window.L;
    const map = L.map(mapRef.current).setView([latitude || HYDERABAD[0], longitude || HYDERABAD[1]], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "OpenStreetMap contributors",
    }).addTo(map);

    const marker = L.marker([latitude || HYDERABAD[0], longitude || HYDERABAD[1]], { draggable: false }).addTo(map);

    map.on("click", (event) => {
      marker.setLatLng([event.latlng.lat, event.latlng.lng]);
      onPick({ latitude: event.latlng.lat, longitude: event.latlng.lng });
    });

    mapInstanceRef.current = map;
    markerRef.current = marker;

    return () => {
      markerRef.current?.remove();
      mapInstanceRef.current?.remove();
      markerRef.current = null;
      mapInstanceRef.current = null;
    };
  }, [isLeafletReady, latitude, longitude, onPick]);

  useEffect(() => {
    if (!mapInstanceRef.current || !markerRef.current) {
      return;
    }
    markerRef.current.setLatLng([latitude, longitude]);
    mapInstanceRef.current.setView([latitude, longitude], 12);
  }, [latitude, longitude]);

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-black uppercase tracking-widest text-white/50">Map Picker</p>
      <div ref={mapRef} className="h-64 w-full rounded-xl border border-white/10" />
      {!isLeafletReady && (
        <div className="text-[10px] text-white/50 uppercase tracking-widest">Loading map...</div>
      )}
    </div>
  );
}

export default function Settings() {
  const [activeTab, setActiveTab] = useState("cameras");

  const [cameras, setCameras] = useState<Camera[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences);

  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);

  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [cameraModalMode, setCameraModalMode] = useState<"create" | "edit">("create");
  const [editingCameraId, setEditingCameraId] = useState<string | null>(null);
  const [cameraForm, setCameraForm] = useState<CameraForm>(defaultCameraForm);
  const [isTestingCamera, setIsTestingCamera] = useState(false);
  const [isSavingCamera, setIsSavingCamera] = useState(false);

  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [contactModalMode, setContactModalMode] = useState<"create" | "edit">("create");
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [contactForm, setContactForm] = useState<ContactForm>(defaultContactForm);
  const [isSavingContact, setIsSavingContact] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<{ kind: "camera" | "contact"; id: string } | null>(null);
  const [activeLocation, setActiveLocation] = useState<{ location_name: string; latitude: number; longitude: number } | null>(null);
  const [nearbyAuthorities, setNearbyAuthorities] = useState<Record<string, NearbyAuthority[]>>({});
  const [tavilyData, setTavilyData] = useState<TavilyAuthoritiesData | null>(null);
  const [tavilyLoading, setTavilyLoading] = useState(false);

  // Quick-activate camera section state
  const [quickIpAddress, setQuickIpAddress] = useState("");
  const [quickIpLocation, setQuickIpLocation] = useState("");
  const [quickIpLat, setQuickIpLat] = useState("");
  const [quickIpLon, setQuickIpLon] = useState("");
  const [quickYtUrl, setQuickYtUrl] = useState("");
  const [quickYtLocation, setQuickYtLocation] = useState("");
  const [quickYtLat, setQuickYtLat] = useState("");
  const [quickYtLon, setQuickYtLon] = useState("");
  const [quickActivating, setQuickActivating] = useState<string | null>(null);
  const [detectedLocation, setDetectedLocation] = useState<string | null>(null);
  const [detectingGps, setDetectingGps] = useState<"youtube" | "ipcam" | null>(null);

  // Health widget
  const [health, setHealth] = useState<Record<string, string> | null>(null);

  const detectGPS = async (section: "youtube" | "ipcam") => {
    setDetectingGps(section);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 })
      );
      const { latitude, longitude } = pos.coords;
      const latStr = latitude.toFixed(6);
      const lonStr = longitude.toFixed(6);
      let locationName = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
      try {
        const resp = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
          { headers: { "User-Agent": "Protego-Safety-System/1.0" } }
        );
        if (resp.ok) {
          const data = await resp.json();
          const addr = data.address || {};
          const name = [
            addr.suburb || addr.neighbourhood || addr.road,
            addr.city || addr.town || addr.village || addr.county,
            addr.state,
          ].filter(Boolean).join(", ");
          if (name) locationName = name;
        }
      } catch { /* use coordinate fallback */ }
      if (section === "youtube") {
        setQuickYtLat(latStr);
        setQuickYtLon(lonStr);
        setQuickYtLocation(locationName);
      } else {
        setQuickIpLat(latStr);
        setQuickIpLon(lonStr);
        setQuickIpLocation(locationName);
      }
      toast.success("Location detected successfully");
    } catch {
      toast.error("GPS access denied or unavailable");
    } finally {
      setDetectingGps(null);
    }
  };

  const quickActivate = async (sourceType: "webcam" | "ipcam" | "youtube") => {
    setQuickActivating(sourceType);
    try {
      let body: Record<string, unknown> = { source_type: sourceType };
      if (sourceType === "ipcam") {
        if (!quickIpAddress.trim() || !quickIpLocation.trim()) {
          toast.error("IP address and location name are required");
          return;
        }
        body = { source_type: "ipcam", ip_address: quickIpAddress, location_name: quickIpLocation, latitude: Number(quickIpLat) || 17.385, longitude: Number(quickIpLon) || 78.4867 };
      } else if (sourceType === "youtube") {
        if (!quickYtUrl.trim() || !quickYtLocation.trim()) {
          toast.error("YouTube URL and location name are required");
          return;
        }
        body = { source_type: "youtube", youtube_url: quickYtUrl, location_name: quickYtLocation, latitude: Number(quickYtLat) || 17.385, longitude: Number(quickYtLon) || 78.4867 };
      }
      const res = await fetch(`${API_BASE}/api/camera/source`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const envelope = await res.json();
      if (!res.ok) throw new Error(envelope?.error || "Failed to activate");
      const data = envelope?.data ?? envelope;
      const loc = data?.active_location?.location_name;
      if (loc) setDetectedLocation(loc);
      toast.success(`${sourceType === "webcam" ? "Webcam" : sourceType === "ipcam" ? "IP Camera" : "YouTube Stream"} activated`);
      await loadNearbyAuthorities();
    } catch (err) {
      toast.error("Activation failed", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setQuickActivating(null);
    }
  };

  const fetchHealth = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/health`);
      const body = await res.json();
      setHealth(body?.data ?? body);
    } catch { /* ignore */ }
  };

  const activeCamera = useMemo(() => cameras.find((camera) => camera.is_active) ?? null, [cameras]);

  const groupedContacts = useMemo(() => {
    return contacts.reduce<Record<AuthorityType, Contact[]>>(
      (acc, contact) => {
        acc[contact.authority_type].push(contact);
        return acc;
      },
      { hospital: [], police: [], fire: [], traffic: [], municipal: [] },
    );
  }, [contacts]);

  const loadCameras = async () => {
    const data = await fetchJson<Camera[]>("/api/settings/cameras");
    setCameras(data);
  };

  const loadContacts = async () => {
    const data = await fetchJson<Contact[]>("/api/settings/contacts");
    setContacts(data);
  };

  const loadPreferences = async () => {
    const data = await fetchJson<Preferences>("/api/settings/preferences");
    setPreferences({
      ...defaultPreferences,
      ...data,
      channels: { ...defaultPreferences.channels, ...(data.channels || {}) },
      features: Array.isArray(data.features) && data.features.length > 0 ? data.features : defaultPreferences.features,
    });
  };

  const loadNearbyAuthorities = async () => {
    const location = await fetchJson<{ location_name: string; latitude: number; longitude: number }>("/api/location/active");
    setActiveLocation(location);
    const nearby = await fetchJson<{ authorities: Record<string, NearbyAuthority[]> }>("/api/authorities/nearby");
    setNearbyAuthorities(nearby.authorities || {});
  };

  const loadMajorAuthorities = async () => {
    try {
      setTavilyLoading(true);
      const data = await fetchJson<TavilyAuthoritiesData & { searching?: boolean }>("/api/location/authorities");
      if (!data.searching) {
        setTavilyData((data.hospital || data.police) ? data : null);
        setTavilyLoading(false);
      }
      // If searching=true, keep spinner — socket tavily_authorities will fire when done
    } catch {
      setTavilyLoading(false);
    }
  };

  useEffect(() => {
    const bootstrap = async () => {
      setIsInitialLoading(true);
      try {
        await Promise.all([loadCameras(), loadContacts(), loadPreferences(), loadNearbyAuthorities(), loadMajorAuthorities()]);
        await fetchHealth();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load settings";
        toast.error("Settings load failed", { description: message });
      } finally {
        setIsInitialLoading(false);
      }
    };

    bootstrap();
  }, []);

  useEffect(() => {
    const socket: Socket = io("http://127.0.0.1:5000", {
      transports: ["polling"],
      upgrade: false,
      reconnection: true,
    });

    socket.on("tavily_authorities", (data: TavilyAuthoritiesData) => {
      setTavilyData(data || null);
      setTavilyLoading(false);
    });

    socket.on("location_updated", () => {
      void loadMajorAuthorities();
    });

    return () => {
      socket.off("tavily_authorities");
      socket.off("location_updated");
      socket.disconnect();
    };
  }, []);

  const validateCameraForm = (): string | null => {
    if (!cameraForm.name.trim()) return "Camera name is required";
    if (cameraForm.source_type !== "webcam") {
      if (!cameraForm.location_name.trim()) return "Location name is required";
      if (!Number.isFinite(cameraForm.latitude) || !Number.isFinite(cameraForm.longitude)) {
        return "Latitude and longitude must be valid numbers";
      }
    }
    if (cameraForm.source_type === "ipcam" && !cameraForm.ip_address.trim()) {
      return "IP address is required for IP Camera";
    }
    if (cameraForm.source_type === "youtube" && !cameraForm.youtube_url.trim()) {
      return "YouTube URL is required for YouTube source";
    }
    return null;
  };

  const validateContactForm = (): string | null => {
    if (!contactForm.name.trim()) return "Name is required";
    if (!contactForm.email.trim() || !/^\S+@\S+\.\S+$/.test(contactForm.email.trim())) {
      return "Valid email is required";
    }
    if (!/^\+[1-9]\d{7,14}$/.test(contactForm.whatsapp_number.trim())) {
      return "WhatsApp must be international format like +919876543210";
    }
    if (!Number.isFinite(contactForm.latitude) || !Number.isFinite(contactForm.longitude)) {
      return "Latitude and longitude must be valid numbers";
    }
    return null;
  };

  const openCreateCameraModal = () => {
    setCameraModalMode("create");
    setEditingCameraId(null);
    setCameraForm(defaultCameraForm);
    setIsCameraModalOpen(true);
  };

  const openEditCameraModal = (camera: Camera) => {
    setCameraModalMode("edit");
    setEditingCameraId(camera.id);
    setCameraForm({ ...camera });
    setIsCameraModalOpen(true);
  };

  const openCreateContactModal = () => {
    setContactModalMode("create");
    setEditingContactId(null);
    setContactForm(defaultContactForm);
    setIsContactModalOpen(true);
  };

  const openEditContactModal = (contact: Contact) => {
    setContactModalMode("edit");
    setEditingContactId(contact.id);
    setContactForm({ ...contact });
    setIsContactModalOpen(true);
  };

  const handleCameraTestConnection = async () => {
    const error = validateCameraForm();
    if (error) {
      toast.error("Cannot test connection", { description: error });
      return;
    }

    setIsTestingCamera(true);
    try {
      const response = await fetchJson<{ success: boolean; message?: string }>("/api/settings/cameras/test", {
        method: "POST",
        body: JSON.stringify(cameraForm),
      });
      toast.success("Connection successful", {
        description: response.message || "Camera source is reachable",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Connection test failed";
      toast.error("Connection failed", { description: message });
    } finally {
      setIsTestingCamera(false);
    }
  };

  const handleCameraSave = async () => {
    const error = validateCameraForm();
    if (error) {
      toast.error("Validation error", { description: error });
      return;
    }

    setIsSavingCamera(true);
    try {
      if (cameraModalMode === "create") {
        await fetchJson("/api/settings/cameras", {
          method: "POST",
          body: JSON.stringify(cameraForm),
        });
        toast.success("Camera created");
      } else if (editingCameraId) {
        await fetchJson(`/api/settings/cameras/${editingCameraId}`, {
          method: "PUT",
          body: JSON.stringify(cameraForm),
        });
        toast.success("Camera updated");
      }
      await loadCameras();
      await loadNearbyAuthorities();
      setIsCameraModalOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save camera";
      toast.error("Save failed", { description: message });
    } finally {
      setIsSavingCamera(false);
    }
  };

  const handleContactSave = async () => {
    const error = validateContactForm();
    if (error) {
      toast.error("Validation error", { description: error });
      return;
    }

    setIsSavingContact(true);
    try {
      if (contactModalMode === "create") {
        await fetchJson("/api/settings/contacts", {
          method: "POST",
          body: JSON.stringify(contactForm),
        });
        toast.success("Contact created");
      } else if (editingContactId) {
        await fetchJson(`/api/settings/contacts/${editingContactId}`, {
          method: "PUT",
          body: JSON.stringify(contactForm),
        });
        toast.success("Contact updated");
      }
      await loadContacts();
      setIsContactModalOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save contact";
      toast.error("Save failed", { description: message });
    } finally {
      setIsSavingContact(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;

    try {
      if (deleteTarget.kind === "camera") {
        await fetchJson(`/api/settings/cameras/${deleteTarget.id}`, { method: "DELETE" });
        await loadCameras();
        toast.success("Camera deleted");
      } else {
        await fetchJson(`/api/settings/contacts/${deleteTarget.id}`, { method: "DELETE" });
        await loadContacts();
        toast.success("Contact deleted");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Delete failed";
      toast.error("Delete failed", { description: message });
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleSavePreferences = async () => {
    setIsSavingPreferences(true);
    try {
      await fetchJson("/api/settings/preferences", {
        method: "PUT",
        body: JSON.stringify(preferences),
      });
      toast.success("Alert preferences saved", {
        description: "Changes are active immediately.",
      });
      await loadPreferences();
      await loadNearbyAuthorities();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save preferences";
      toast.error("Save failed", { description: message });
    } finally {
      setIsSavingPreferences(false);
    }
  };

  if (isInitialLoading) {
    return (
      <div className="h-[60vh] flex items-center justify-center text-white/70 gap-3">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-[11px] font-black uppercase tracking-widest">Loading Settings</span>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-8 pb-20">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tighter uppercase">System Settings</h1>
          <p className="text-xs text-white/40 font-medium uppercase tracking-widest">
            Configure camera sources, emergency contacts, and alert behavior
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-white/[0.03] border border-white/[0.05] p-1.5 h-14 w-full md:w-auto rounded-2xl">
          <TabsTrigger value="cameras" className="gap-2 px-6 h-full rounded-xl text-[10px] font-black uppercase tracking-[0.2em]">
            <Video className="w-4 h-4" /> Camera Sources
          </TabsTrigger>
          <TabsTrigger value="contacts" className="gap-2 px-6 h-full rounded-xl text-[10px] font-black uppercase tracking-[0.2em]">
            <MapPin className="w-4 h-4" /> Emergency Contacts
          </TabsTrigger>
          <TabsTrigger value="alerts" className="gap-2 px-6 h-full rounded-xl text-[10px] font-black uppercase tracking-[0.2em]">
            <Bell className="w-4 h-4" /> Alert Preferences
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cameras" className="mt-8 space-y-6">

          {/* Quick Activate Panel */}
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 space-y-5">
            <h4 className="text-[11px] text-primary font-black uppercase tracking-[0.25em]">Quick Activate Camera Source</h4>

            {/* Webcam */}
            <div className="rounded-xl border border-white/[0.05] p-4 space-y-3">
              <div className="text-[10px] font-black uppercase tracking-widest text-white/60">Webcam (Auto-detect location)</div>
              <div className="flex items-center gap-3">
                <Button
                  onClick={() => quickActivate("webcam")}
                  disabled={quickActivating === "webcam"}
                  className="bg-primary text-white hover:bg-primary/90 gap-2 h-10 px-6 rounded-xl text-[10px] font-black uppercase tracking-widest"
                >
                  {quickActivating === "webcam" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />}
                  Activate Webcam
                </Button>
                {detectedLocation && (
                  <span className="text-[10px] text-green-400 uppercase tracking-widest font-black">
                    <MapPin className="w-3 h-3 inline mr-1" />{detectedLocation}
                  </span>
                )}
              </div>
            </div>

            {/* IP Camera */}
            <div className="rounded-xl border border-white/[0.05] p-4 space-y-3">
              <div className="text-[10px] font-black uppercase tracking-widest text-white/60">IP Camera / DroidCam</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input placeholder="IP Address (e.g. 192.168.1.5)" value={quickIpAddress} onChange={e => setQuickIpAddress(e.target.value)}
                  className="bg-black/40 border-white/10 h-10 rounded-xl text-[11px]" />
                <Input placeholder="Location Name (e.g. Hyderabad)" value={quickIpLocation} onChange={e => setQuickIpLocation(e.target.value)}
                  className="bg-black/40 border-white/10 h-10 rounded-xl text-[11px]" />
                <Input placeholder="Latitude (e.g. 17.385)" value={quickIpLat} onChange={e => setQuickIpLat(e.target.value)}
                  className="bg-black/40 border-white/10 h-10 rounded-xl text-[11px]" />
                <Input placeholder="Longitude (e.g. 78.4867)" value={quickIpLon} onChange={e => setQuickIpLon(e.target.value)}
                  className="bg-black/40 border-white/10 h-10 rounded-xl text-[11px]" />
              </div>
              <Button onClick={() => quickActivate("ipcam")} disabled={quickActivating === "ipcam"}
                className="bg-white/10 hover:bg-white/20 gap-2 h-10 px-5 rounded-xl text-[10px] font-black uppercase tracking-widest">
                {quickActivating === "ipcam" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Save & Activate IP Camera
              </Button>
              <Button
                onClick={() => detectGPS("ipcam")}
                disabled={detectingGps === "ipcam"}
                variant="outline"
                className="gap-2 h-10 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
              >
                {detectingGps === "ipcam" ? <Loader2 className="w-3 h-3 animate-spin" /> : <MapPin className="w-3 h-3" />}
                Detect GPS
              </Button>
            </div>

            {/* YouTube Stream */}
            <div className="rounded-xl border border-white/[0.05] p-4 space-y-3">
              <div className="text-[10px] font-black uppercase tracking-widest text-white/60">YouTube Live Stream</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input placeholder="YouTube URL" value={quickYtUrl} onChange={e => setQuickYtUrl(e.target.value)}
                  className="bg-black/40 border-white/10 h-10 rounded-xl text-[11px] md:col-span-2" />
                <Input placeholder="Location Name" value={quickYtLocation} onChange={e => setQuickYtLocation(e.target.value)}
                  className="bg-black/40 border-white/10 h-10 rounded-xl text-[11px]" />
                <Input placeholder="Latitude" value={quickYtLat} onChange={e => setQuickYtLat(e.target.value)}
                  className="bg-black/40 border-white/10 h-10 rounded-xl text-[11px]" />
                <Input placeholder="Longitude" value={quickYtLon} onChange={e => setQuickYtLon(e.target.value)}
                  className="bg-black/40 border-white/10 h-10 rounded-xl text-[11px]" />
              </div>
              <Button onClick={() => quickActivate("youtube")} disabled={quickActivating === "youtube"}
                className="bg-white/10 hover:bg-white/20 gap-2 h-10 px-5 rounded-xl text-[10px] font-black uppercase tracking-widest">
                {quickActivating === "youtube" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Save & Activate YouTube Stream
              </Button>
              <Button
                onClick={() => detectGPS("youtube")}
                disabled={detectingGps === "youtube"}
                variant="outline"
                className="gap-2 h-10 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
              >
                {detectingGps === "youtube" ? <Loader2 className="w-3 h-3 animate-spin" /> : <MapPin className="w-3 h-3" />}
                Detect GPS
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-black uppercase tracking-tight">Camera Sources</h3>
              <p className="text-[10px] text-white/40 uppercase tracking-widest font-black">
                Active camera is highlighted and used as primary location context.
              </p>
            </div>
            <Button onClick={openCreateCameraModal} className="gap-2">
              <Plus className="w-4 h-4" /> Add New Camera
            </Button>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {cameras.map((camera) => (
              <div
                key={camera.id}
                className={cn(
                  "rounded-2xl border p-5 bg-white/[0.02]",
                  camera.is_active ? "border-primary/40 shadow-lg shadow-primary/10" : "border-white/[0.05]",
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <h4 className="text-sm font-black uppercase tracking-wide">{camera.name}</h4>
                    <div className="text-[10px] text-white/50 uppercase tracking-widest">{camera.location_name}</div>
                    <div className="text-[10px] text-white/40 uppercase tracking-widest">
                      {camera.latitude.toFixed(5)}, {camera.longitude.toFixed(5)}
                    </div>
                    <div className="text-[10px] text-white/70 uppercase tracking-widest">
                      Source: {camera.source_type}
                    </div>
                    {camera.source_type === "ipcam" && (
                      <div className="text-[10px] text-white/40 break-all">IP: {camera.ip_address || "-"}</div>
                    )}
                    {camera.source_type === "youtube" && (
                      <div className="text-[10px] text-white/40 break-all">URL: {camera.youtube_url || "-"}</div>
                    )}
                    {camera.is_active && (
                      <div className="inline-flex items-center gap-1 text-[10px] text-green-400 uppercase tracking-widest font-black mt-2">
                        <CheckCircle2 className="w-3 h-3" /> Active Camera
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="icon" onClick={() => openEditCameraModal(camera)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="text-red-400 border-red-500/20"
                      onClick={() => setDeleteTarget({ kind: "camera", id: camera.id })}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Health Status Widget */}
          {health && (
            <div className="rounded-2xl border border-white/[0.05] bg-white/[0.02] p-5 space-y-3">
              <h4 className="text-[11px] text-primary font-black uppercase tracking-[0.25em]">System Health</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "Database", val: health.database ?? "–" },
                  { label: "Models", val: health.models ?? "–" },
                  { label: "Camera", val: health.camera ?? "–" },
                  { label: "Location", val: health.location ?? "–" },
                ].map(item => (
                  <div key={item.label} className="rounded-xl bg-white/[0.03] border border-white/[0.05] p-3">
                    <div className="text-[9px] font-black uppercase tracking-widest text-white/40 mb-1">{item.label}</div>
                    <div className={`text-[11px] font-black uppercase tracking-wider ${item.val === "connected" || item.val === "ready" || item.val === "running" ? "text-green-400" :
                        item.val === "loading" || item.val === "disconnected" ? "text-orange-400" : "text-white/70"
                      }`}>{item.val}</div>
                  </div>
                ))}
              </div>
              {health.uptime_seconds && (
                <div className="text-[10px] text-white/30 uppercase tracking-widest">
                  Uptime: {Math.floor(Number(health.uptime_seconds) / 60)}m {Math.round(Number(health.uptime_seconds) % 60)}s
                </div>
              )}
            </div>
          )}

          <div className="rounded-2xl border border-white/[0.05] bg-white/[0.02] p-5 space-y-4">
            <h4 className="text-[11px] text-primary font-black uppercase tracking-[0.25em]">Nearest Authorities From Active Location</h4>
            {activeLocation && (
              <div className="text-[10px] text-white/50 uppercase tracking-widest">
                Active Location: {activeLocation.location_name} ({activeLocation.latitude.toFixed(4)}, {activeLocation.longitude.toFixed(4)})
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.entries(nearbyAuthorities)
                .filter(([, rows]) => isNearbyAuthorityArray(rows))
                .map(([authorityType, rows]) => (
                <div key={authorityType} className="rounded-xl border border-white/[0.05] p-3 space-y-2">
                  <div className="text-[10px] font-black uppercase tracking-widest text-white/70">{authorityType}</div>
                  {rows.slice(0, 5).map((row, idx) => (
                    <div key={`${authorityType}-${idx}`} className="text-[11px] text-white/60">
                      {row.name} - {Number(row.distance_km || 0).toFixed(1)}km away
                      {row.is_top_hospital ? " (Top Major Hospital Nearby)" : ""}
                      {!row.is_top_hospital && row.is_city_referral ? ` (Nearest City Top Hospital: ${row.referral_city || "City Hub"})` : ""}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* MAJOR AUTHORITIES - Tavily */}
          <div style={{
            marginTop: "12px",
            background: "#0a0a1a",
            border: "1px solid #7c3aed",
            borderRadius: "10px",
            padding: "14px",
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "10px",
            }}>
              <p style={{
                color: "#a78bfa",
                fontWeight: "bold",
                fontSize: "12px",
                margin: 0,
                textTransform: "uppercase",
                letterSpacing: "1px",
              }}>
                Major Authorities
              </p>
              <span style={{ color: "#666", fontSize: "10px" }}>
                AI Web Search
              </span>
            </div>

            {tavilyLoading && (
              <p style={{
                color: "#666",
                fontSize: "12px",
                margin: 0,
                textAlign: "center",
                padding: "10px",
              }}>
                Searching internet...
              </p>
            )}

            {!tavilyLoading && !tavilyData && (
              <p style={{
                color: "#444",
                fontSize: "11px",
                margin: 0,
                textAlign: "center",
                padding: "10px",
              }}>
                Set location to search major hospitals and police stations online
              </p>
            )}

            {tavilyData && (
              <>
                {(tavilyData.hospital?.length || 0) > 0 && (
                  <div style={{ marginBottom: "10px" }}>
                    <p style={{
                      color: "#a78bfa",
                      fontSize: "10px",
                      margin: "0 0 6px",
                      fontWeight: "bold",
                    }}>
                      Major Hospitals
                    </p>
                    {(tavilyData.hospital || []).map((h, i) => (
                      <div key={`tav-h-${i}`} style={{
                        background: "#111128",
                        borderRadius: "6px",
                        padding: "8px 10px",
                        marginBottom: "6px",
                      }}>
                        <p style={{
                          color: "#fff",
                          fontSize: "12px",
                          margin: "0 0 2px",
                          fontWeight: "bold",
                        }}>
                          {h.name}
                        </p>
                        {h.type && (
                          <p style={{ color: "#888", fontSize: "10px", margin: "0 0 2px" }}>
                            {h.type}
                            {h.address ? ` · ${h.address.slice(0, 40)}` : ""}
                          </p>
                        )}
                        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                          <span style={{
                            color: h.has_real_phone ? "#4ade80" : "#f97316",
                            fontSize: "11px",
                          }}>
                            {h.phone || "108"}{h.has_real_phone ? " (verified)" : " (emergency)"}
                          </span>
                          {h.email && (
                            <span style={{ color: "#60a5fa", fontSize: "11px" }}>
                              {h.email}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {(tavilyData.police?.length || 0) > 0 && (
                  <div>
                    <p style={{
                      color: "#a78bfa",
                      fontSize: "10px",
                      margin: "0 0 6px",
                      fontWeight: "bold",
                    }}>
                      Major Police Stations
                    </p>
                    {(tavilyData.police || []).map((p, i) => (
                      <div key={`tav-p-${i}`} style={{
                        background: "#111128",
                        borderRadius: "6px",
                        padding: "8px 10px",
                        marginBottom: "6px",
                      }}>
                        <p style={{
                          color: "#fff",
                          fontSize: "12px",
                          margin: "0 0 2px",
                          fontWeight: "bold",
                        }}>
                          {p.name}
                        </p>
                        {p.jurisdiction && (
                          <p style={{ color: "#888", fontSize: "10px", margin: "0 0 2px" }}>
                            {p.jurisdiction}
                          </p>
                        )}
                        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                          <span style={{
                            color: p.has_real_phone ? "#4ade80" : "#f97316",
                            fontSize: "11px",
                          }}>
                            {p.phone || "100"}{p.has_real_phone ? " (verified)" : " (emergency)"}
                          </span>
                          {p.email && (
                            <span style={{ color: "#60a5fa", fontSize: "11px" }}>
                              {p.email}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </TabsContent>

        <TabsContent value="contacts" className="mt-8 space-y-8">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-black uppercase tracking-tight">Emergency Contacts</h3>
              <p className="text-[10px] text-white/40 uppercase tracking-widest font-black">
                Grouped by authority type with distance from active camera.
              </p>
            </div>
            <Button onClick={openCreateContactModal} className="gap-2">
              <Plus className="w-4 h-4" /> Add New Contact
            </Button>
          </div>

          {(Object.keys(AUTHORITY_LABELS) as AuthorityType[]).map((authorityType) => (
            <section key={authorityType} className="space-y-3">
              <h4 className="text-[11px] text-primary font-black uppercase tracking-[0.2em]">
                {AUTHORITY_LABELS[authorityType]}
              </h4>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {groupedContacts[authorityType].length === 0 && (
                  <div className="text-[11px] text-white/35 uppercase tracking-widest border border-white/[0.05] rounded-xl p-4">
                    No contacts in this group
                  </div>
                )}
                {groupedContacts[authorityType].map((contact) => {
                  const distance =
                    activeCamera == null
                      ? null
                      : haversineKm(
                        activeCamera.latitude,
                        activeCamera.longitude,
                        contact.latitude,
                        contact.longitude,
                      );
                  return (
                    <div key={contact.id} className="rounded-2xl border border-white/[0.05] bg-white/[0.02] p-5 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="text-sm font-black uppercase tracking-wide">{contact.name}</div>
                          <div className="text-[10px] text-white/60">{contact.email}</div>
                          <div className="text-[10px] text-white/60">WhatsApp: {contact.whatsapp_number}</div>
                          <div className="text-[10px] text-white/40">
                            {contact.latitude.toFixed(5)}, {contact.longitude.toFixed(5)}
                          </div>
                          <div className="text-[10px] text-primary uppercase tracking-widest font-black">
                            {distance == null ? "No active camera" : `${distance.toFixed(2)} km from active camera`}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="outline" size="icon" onClick={() => openEditContactModal(contact)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            className="text-red-400 border-red-500/20"
                            onClick={() => setDeleteTarget({ kind: "contact", id: contact.id })}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </TabsContent>

        <TabsContent value="alerts" className="mt-8 space-y-6">
          <div className="rounded-2xl border border-white/[0.05] bg-white/[0.02] p-6 space-y-8">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-black uppercase tracking-wide">Minimum Severity Threshold</h3>
                <span className="text-sm font-black text-primary">{preferences.minimum_severity_threshold}</span>
              </div>
              <Slider
                value={[preferences.minimum_severity_threshold]}
                min={1}
                max={10}
                step={1}
                onValueChange={(value) =>
                  setPreferences((prev) => ({ ...prev, minimum_severity_threshold: value[0] ?? prev.minimum_severity_threshold }))
                }
              />
            </div>

            <div className="space-y-3">
              <h3 className="text-base font-black uppercase tracking-wide">Duplicate Alert Cooldown</h3>
              <Select
                value={String(preferences.duplicate_alert_cooldown_seconds)}
                onValueChange={(value) =>
                  setPreferences((prev) => ({
                    ...prev,
                    duplicate_alert_cooldown_seconds: toNumber(value) as Preferences["duplicate_alert_cooldown_seconds"],
                  }))
                }
              >
                <SelectTrigger className="w-full md:w-[280px]">
                  <SelectValue placeholder="Cooldown" />
                </SelectTrigger>
                <SelectContent>
                  {COOLDOWN_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={String(option.value)}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              <h3 className="text-base font-black uppercase tracking-wide">Alert Channels</h3>
              <div className="grid md:grid-cols-3 gap-3">
                {(["telegram", "sms", "email"] as const).map((channel) => (
                  <div key={channel} className="rounded-xl border border-white/[0.05] p-4 flex justify-between items-center">
                    <span className="text-[11px] font-black uppercase tracking-widest">{channel}</span>
                    <Switch
                      checked={preferences.channels[channel]}
                      onCheckedChange={(checked) =>
                        setPreferences((prev) => ({
                          ...prev,
                          channels: { ...prev.channels, [channel]: checked },
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4 rounded-xl border border-white/[0.05] p-4">
              <h3 className="text-base font-black uppercase tracking-wide">Demo Configuration</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input
                  placeholder="Demo Phone (+919876543210)"
                  value={preferences.demo_phone}
                  onChange={(event) => setPreferences((prev) => ({ ...prev, demo_phone: event.target.value }))}
                />
                <Input
                  placeholder="Demo Email"
                  value={preferences.demo_email}
                  onChange={(event) => setPreferences((prev) => ({ ...prev, demo_email: event.target.value }))}
                />
              </div>
              <div className="rounded-xl border border-white/[0.05] p-3 flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-widest">Show Real Institution Details</span>
                <Switch
                  checked={preferences.show_real_institution_details}
                  onCheckedChange={(checked) => setPreferences((prev) => ({ ...prev, show_real_institution_details: checked }))}
                />
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-base font-black uppercase tracking-wide">Per Feature Controls</h3>
              <div className="space-y-3">
                {preferences.features.map((feature) => (
                  <div key={feature.feature_id} className="rounded-xl border border-white/[0.05] p-4">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div className="text-[11px] font-black uppercase tracking-widest">{feature.feature_name}</div>
                      <Switch
                        checked={feature.is_enabled}
                        onCheckedChange={(checked) =>
                          setPreferences((prev) => ({
                            ...prev,
                            features: prev.features.map((item) =>
                              item.feature_id === feature.feature_id ? { ...item, is_enabled: checked } : item,
                            ),
                          }))
                        }
                      />
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-white/50 uppercase tracking-widest whitespace-nowrap">
                        Severity Override
                      </span>
                      <Input
                        type="number"
                        min={1}
                        max={10}
                        value={feature.severity_override ?? ""}
                        placeholder="Optional 1-10"
                        onChange={(event) => {
                          const raw = event.target.value.trim();
                          const parsed = raw === "" ? null : Math.max(1, Math.min(10, Number(raw)));
                          setPreferences((prev) => ({
                            ...prev,
                            features: prev.features.map((item) =>
                              item.feature_id === feature.feature_id ? { ...item, severity_override: parsed } : item,
                            ),
                          }));
                        }}
                        className="w-[160px]"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-2">
              <Button onClick={handleSavePreferences} disabled={isSavingPreferences} className="gap-2">
                {isSavingPreferences ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Preferences
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={isCameraModalOpen} onOpenChange={setIsCameraModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{cameraModalMode === "create" ? "Add New Camera" : "Edit Camera"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              placeholder="Camera Name"
              value={cameraForm.name}
              onChange={(event) => setCameraForm((prev) => ({ ...prev, name: event.target.value }))}
            />
            <Select
              value={cameraForm.source_type}
              onValueChange={(value) =>
                setCameraForm((prev) => ({
                  ...prev,
                  source_type: value as CameraSourceType,
                  ip_address: value === "ipcam" ? prev.ip_address : "",
                  youtube_url: value === "youtube" ? prev.youtube_url : "",
                }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Source Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="webcam">Webcam</SelectItem>
                <SelectItem value="ipcam">IP Camera</SelectItem>
                <SelectItem value="youtube">YouTube Stream</SelectItem>
              </SelectContent>
            </Select>

            {cameraForm.source_type === "ipcam" && (
              <Input
                placeholder="IP Address"
                value={cameraForm.ip_address}
                onChange={(event) => setCameraForm((prev) => ({ ...prev, ip_address: event.target.value }))}
              />
            )}
            {cameraForm.source_type === "youtube" && (
              <Input
                placeholder="YouTube URL"
                value={cameraForm.youtube_url}
                onChange={(event) => setCameraForm((prev) => ({ ...prev, youtube_url: event.target.value }))}
              />
            )}

            {cameraForm.source_type !== "webcam" ? (
              <Input
                placeholder="Location Name"
                value={cameraForm.location_name}
                onChange={(event) => setCameraForm((prev) => ({ ...prev, location_name: event.target.value }))}
              />
            ) : (
              <div className="text-[10px] text-white/50 uppercase tracking-widest rounded-xl border border-white/10 px-3 py-3">
                Webcam location is auto-detected from IP API.
              </div>
            )}
            <div className="flex items-center justify-between rounded-xl border border-white/10 px-3">
              <span className="text-[10px] font-black uppercase tracking-widest text-white/50">Active camera</span>
              <Switch
                checked={cameraForm.is_active}
                onCheckedChange={(checked) => setCameraForm((prev) => ({ ...prev, is_active: checked }))}
              />
            </div>

            {cameraForm.source_type !== "webcam" && (
              <>
                <Input
                  type="number"
                  placeholder="Latitude"
                  value={cameraForm.latitude}
                  onChange={(event) => setCameraForm((prev) => ({ ...prev, latitude: toNumber(event.target.value) }))}
                />
                <Input
                  type="number"
                  placeholder="Longitude"
                  value={cameraForm.longitude}
                  onChange={(event) => setCameraForm((prev) => ({ ...prev, longitude: toNumber(event.target.value) }))}
                />
              </>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="outline" onClick={handleCameraTestConnection} disabled={isTestingCamera || isSavingCamera}>
              {isTestingCamera ? <Loader2 className="w-4 h-4 animate-spin" /> : "Test Connection"}
            </Button>
            <Button onClick={handleCameraSave} disabled={isSavingCamera}>
              {isSavingCamera ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isContactModalOpen} onOpenChange={setIsContactModalOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{contactModalMode === "create" ? "Add New Contact" : "Edit Contact"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              placeholder="Name"
              value={contactForm.name}
              onChange={(event) => setContactForm((prev) => ({ ...prev, name: event.target.value }))}
            />
            <Select
              value={contactForm.authority_type}
              onValueChange={(value) => setContactForm((prev) => ({ ...prev, authority_type: value as AuthorityType }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Authority Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hospital">Hospital</SelectItem>
                <SelectItem value="police">Police</SelectItem>
                <SelectItem value="fire">Fire</SelectItem>
                <SelectItem value="traffic">Traffic</SelectItem>
                <SelectItem value="municipal">Municipal</SelectItem>
              </SelectContent>
            </Select>

            <Input
              type="email"
              placeholder="Email"
              value={contactForm.email}
              onChange={(event) => setContactForm((prev) => ({ ...prev, email: event.target.value }))}
            />
            <Input
              placeholder="WhatsApp (+919876543210)"
              value={contactForm.whatsapp_number}
              onChange={(event) => setContactForm((prev) => ({ ...prev, whatsapp_number: event.target.value }))}
            />
            <Input
              type="number"
              placeholder="Latitude"
              value={contactForm.latitude}
              onChange={(event) => setContactForm((prev) => ({ ...prev, latitude: toNumber(event.target.value) }))}
            />
            <Input
              type="number"
              placeholder="Longitude"
              value={contactForm.longitude}
              onChange={(event) => setContactForm((prev) => ({ ...prev, longitude: toNumber(event.target.value) }))}
            />
          </div>

          <MapPicker
            latitude={contactForm.latitude}
            longitude={contactForm.longitude}
            onPick={(coords) =>
              setContactForm((prev) => ({
                ...prev,
                latitude: Number(coords.latitude.toFixed(6)),
                longitude: Number(coords.longitude.toFixed(6)),
              }))
            }
          />

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button onClick={handleContactSave} disabled={isSavingContact}>
              {isSavingContact ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Delete</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The selected {deleteTarget?.kind} will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

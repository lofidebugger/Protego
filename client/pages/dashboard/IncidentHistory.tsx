import { useState, useEffect, useCallback } from "react";
import {
  Search,
  Filter,
  Download,
  Eye,
  ChevronRight,
  ShieldAlert,
  MapPin,
  Clock,
  Car,
  MessageSquare,
  CheckCircle2,
  Calendar,
  Layers,
  FileText,
  Target,
  ChevronLeft
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";
import { io } from "socket.io-client";
import { useToast } from "@/components/ui/use-toast";

interface Incident {
  id: string;
  incident_type: string;
  feature_name: string;
  location: string;
  camera_name: string;
  timestamp: string;
  severity_score: number;
  groq_description: string;
  vehicle_plates: string[];
  authority_alerted: string[];
  screenshot: string;
  alert_channels: {
    telegram: string;
    whatsapp: string;
    email: string;
  };
  crowd_density?: number;
  escape_direction?: string;
  _isNew?: boolean; // For UI animation
}

interface IncidentResponse {
  incidents: Incident[];
  total_count: number;
  page: number;
  total_pages: number;
}

export default function IncidentHistory() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);

  // Pagination & Filters
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [incidentType, setIncidentType] = useState("all");
  const [severityRange, setSeverityRange] = useState("all");

  const [isLoading, setIsLoading] = useState(true);
  const [hasNewAlerts, setHasNewAlerts] = useState(false);
  const { toast } = useToast();

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1); // Reset page on new search
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchIncidents = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: "15",
      });

      if (debouncedSearch) params.append("search", debouncedSearch);
      if (incidentType !== "all") params.append("incident_type", incidentType);

      if (severityRange !== "all") {
        const [min, max] = severityRange.split("-");
        params.append("severity_min", min);
        params.append("severity_max", max);
      }

      const res = await fetch(`http://127.0.0.1:5000/api/incidents?${params.toString()}`);
      const envelope = await res.json();
      // Backend wraps responses in {success, data: {...}}
      const data: IncidentResponse = envelope?.data ?? envelope;

      setIncidents(Array.isArray(data?.incidents) ? data.incidents : []);
      setTotalPages(data?.total_pages ?? 1);
      setTotalCount(data?.total_count ?? 0);
      setHasNewAlerts(false);
    } catch (err) {
      console.error("Failed to fetch incidents:", err);
      setIncidents([]);
      toast({ title: "Failed to load history", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [page, debouncedSearch, incidentType, severityRange, toast]);

  useEffect(() => {
    fetchIncidents();
  }, [fetchIncidents]);

  // Socket Live Updates
  useEffect(() => {
    const socket = io("http://127.0.0.1:5000", {
      transports: ["polling"],
      upgrade: false,
      reconnection: true,
    });

    socket.on("alert", (newAlert: Incident) => {
      // If user is on page 1 with no filters, prepend it live
      if (page === 1 && !debouncedSearch && incidentType === "all" && severityRange === "all") {
        newAlert._isNew = true;
        setIncidents(prev => [newAlert, ...prev.slice(0, 14)]);
        setTotalCount(prev => prev + 1);

        // Remove highlight after 3 seconds
        setTimeout(() => {
          setIncidents(current =>
            current.map(inc => inc.id === newAlert.id ? { ...inc, _isNew: false } : inc)
          );
        }, 3000);
      } else {
        // Show banner if deep in pagination or filtering
        setHasNewAlerts(true);
      }
    });

    return () => { socket.disconnect(); };
  }, [page, debouncedSearch, incidentType, severityRange]);

  const handleExport = () => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.append("search", debouncedSearch);
    if (incidentType !== "all") params.append("incident_type", incidentType);
    if (severityRange !== "all") {
      const [min, max] = severityRange.split("-");
      params.append("severity_min", min);
      params.append("severity_max", max);
    }

    window.open(`http://127.0.0.1:5000/api/incidents/export?${params.toString()}`, "_blank");
  };

  const getRelativeTime = (isoTime: string | null | undefined) => {
    if (!isoTime) return "Unknown time";
    try {
      const then = new Date(isoTime);
      if (isNaN(then.getTime())) return "Unknown time";
      return then.toLocaleString('en-US', {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    } catch {
      return "Unknown time";
    }
  };

  return (
    <div className="flex flex-col gap-10 pb-20">
      <div className="flex flex-col md:row items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-black tracking-tighter uppercase mb-2">Past Incidents</h1>
          <div className="flex items-center gap-3">
            <div className="px-2.5 py-1 bg-white/5 border border-white/5 rounded-lg flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <span className="text-[10px] font-black text-white/40 uppercase tracking-[0.3em]">SECURE LOGS</span>
            </div>
            <p className="text-xs text-white/40 font-medium uppercase tracking-widest leading-none">Logged Events • {totalCount.toLocaleString()} RECORDS</p>
          </div>
        </div>
        <div className="flex gap-3">
          <Button
            onClick={handleExport}
            variant="outline"
            className="bg-white/[0.03] border-white/10 hover:bg-white/[0.08] gap-3 h-11 px-6 rounded-2xl text-[10px] font-black uppercase tracking-widest"
          >
            <Download className="w-4 h-4 text-white/40" /> EXPORT CSV
          </Button>
          <Button className="bg-white text-black hover:bg-white/90 gap-3 h-11 px-8 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-white/5">
            <FileText className="w-4 h-4" /> COMPLIANCE REPORT
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {hasNewAlerts && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full p-4 bg-primary/20 border border-primary/30 rounded-2xl flex justify-between items-center cursor-pointer hover:bg-primary/30 transition-colors"
            onClick={() => {
              setPage(1);
              setSearch("");
              setIncidentType("all");
              setSeverityRange("all");
            }}
          >
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-primary animate-ping" />
              <span className="text-xs font-black uppercase tracking-widest text-primary">New Incidents Detected</span>
            </div>
            <span className="text-[10px] uppercase font-bold text-white/60">Click to Clear Filters & Refresh</span>
          </motion.div>
        )}

        <div className="flex flex-col lg:flex-row items-center gap-4 bg-white/[0.02] p-4 rounded-3xl border border-white/[0.05] shadow-inner-glow relative group overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent -z-10" />
          <div className="relative flex-1 w-full">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20 group-hover:text-primary transition-colors" />
            <Input
              placeholder="SEARCH LOCATION, ID OR VEHICLE PLATE..."
              className="pl-12 bg-black/40 border-white/10 h-12 rounded-2xl text-[11px] font-black uppercase tracking-widest focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-white/20"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap md:flex-nowrap gap-3 w-full lg:w-auto">
            <Select value={incidentType} onValueChange={setIncidentType}>
              <SelectTrigger className="w-full md:w-[200px] bg-black/40 border-white/10 h-12 rounded-2xl text-[10px] font-black uppercase tracking-widest">
                <SelectValue placeholder="EVENT TYPE" />
              </SelectTrigger>
              <SelectContent className="bg-[#050508] border-white/10 uppercase tracking-widest text-[10px] font-black">
                <SelectItem value="all">ANY INCIDENT TYPE</SelectItem>
                <SelectItem value="Road Accident Detection">Road Accident</SelectItem>
                <SelectItem value="Medical Emergency Detection">Medical Emergency</SelectItem>
                <SelectItem value="Distress & Assault Detection">Distress / Assault</SelectItem>
                <SelectItem value="Stampede Prediction">Stampede Risk</SelectItem>
                <SelectItem value="Kidnapping & Loitering">Kidnapping / Loitering</SelectItem>
                <SelectItem value="Illegal Dumping Detection">Illegal Dumping</SelectItem>
                <SelectItem value="Reckless Driving">Reckless Driving</SelectItem>
                <SelectItem value="Early Fire Detection">Early Fire</SelectItem>
              </SelectContent>
            </Select>

            <Select value={severityRange} onValueChange={setSeverityRange}>
              <SelectTrigger className="w-full md:w-[160px] bg-black/40 border-white/10 h-12 rounded-2xl text-[10px] font-black uppercase tracking-widest">
                <SelectValue placeholder="SEVERITY" />
              </SelectTrigger>
              <SelectContent className="bg-[#050508] border-white/10 uppercase tracking-widest text-[10px] font-black">
                <SelectItem value="all">ALL SEVERITY</SelectItem>
                <SelectItem value="0-4">ROUTINE (0-4)</SelectItem>
                <SelectItem value="4-7">ELEVATED (4-7)</SelectItem>
                <SelectItem value="7-10">CRITICAL (7-10)</SelectItem>
              </SelectContent>
            </Select>

            <Button variant="outline" className="bg-black/40 border-white/10 h-12 px-6 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-white/5 lg:w-auto w-full">
              <Filter className="w-4 h-4 mr-2 text-white/20" /> MORE FILTERS
            </Button>
          </div>
        </div>
      </div>

      <div className="premium-glass bg-white/[0.02] border-white/[0.05] shadow-2xl overflow-hidden rounded-[2rem]">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-white/[0.03]">
              <TableRow className="border-white/[0.05] hover:bg-transparent">
                <TableHead className="text-white/30 font-black uppercase tracking-[0.2em] text-[10px] py-6 px-6">INCIDENT REF / TIME</TableHead>
                <TableHead className="text-white/30 font-black uppercase tracking-[0.2em] text-[10px]">EVENT CLASSIFICATION</TableHead>
                <TableHead className="text-white/30 font-black uppercase tracking-[0.2em] text-[10px]">LOCATION / NODE</TableHead>
                <TableHead className="text-white/30 font-black uppercase tracking-[0.2em] text-[10px]">SEVERITY</TableHead>
                <TableHead className="text-white/30 font-black uppercase tracking-[0.2em] text-[10px]">AUTHORITIES DISPATCHED</TableHead>
                <TableHead className="text-right text-white/30 font-black uppercase tracking-[0.2em] text-[10px] px-6">ACTIONS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence mode="popLayout">
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-48 text-center">
                      <div className="flex flex-col items-center justify-center text-white/30 gap-4">
                        <Layers className="w-8 h-8 animate-pulse" />
                        <span className="text-[10px] font-black uppercase tracking-widest">QUERYING INFRASTRUCTURE...</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : incidents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-48 text-center">
                      <div className="text-[10px] font-black text-white/30 uppercase tracking-widest">NO INCIDENTS FOUND MATCHING CRITERIA</div>
                    </TableCell>
                  </TableRow>
                ) : (
                  incidents.map((incident) => (
                    <motion.tr
                      layout
                      initial={incident._isNew ? { opacity: 0, backgroundColor: 'rgba(230, 57, 70, 0.2)' } : false}
                      animate={{ opacity: 1, backgroundColor: 'transparent' }}
                      transition={{ duration: 1 }}
                      key={incident.id}
                      className="border-white/[0.03] hover:bg-white/[0.04] transition-all cursor-pointer group"
                      onClick={() => setSelectedIncident(incident)}
                    >
                      <TableCell className="px-6 py-4">
                        <div className="flex flex-col gap-1.5">
                          <span className="font-mono text-[11px] text-white/60 font-black">{incident.id}</span>
                          <span className="text-[9px] font-bold text-white/30 uppercase tracking-widest">{getRelativeTime(incident.timestamp)}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-2.5 h-2.5 rounded-full shadow-lg",
                            incident.severity_score > 7 ? "bg-primary red-glow-soft" : incident.severity_score > 4 ? "bg-orange-500" : "bg-green-500"
                          )} />
                          <span className="font-black text-[11px] uppercase tracking-tight group-hover:text-white transition-colors">{incident.incident_type}</span>
                        </div>
                        {incident.vehicle_plates?.length > 0 && (
                          <div className="flex gap-2 mt-2">
                            {incident.vehicle_plates.map(p => (
                              <span key={p} className="px-2 py-0.5 bg-white/5 rounded border border-white/10 text-[9px] font-mono font-bold text-white/50">{p}</span>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className="text-[11px] font-bold text-white/80 uppercase tracking-tight">{incident.location}</span>
                          <span className="text-[9px] font-black text-white/30 uppercase tracking-widest">{incident.camera_name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn(
                          "font-black text-[10px] border-none px-3 py-1.5 rounded-lg uppercase tracking-widest shadow-xl",
                          incident.severity_score > 7 ? "bg-primary/20 text-primary" : incident.severity_score > 4 ? "bg-orange-500/20 text-orange-400" : "bg-green-500/20 text-green-400"
                        )}>
                          S: {incident.severity_score}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          {incident.authority_alerted?.length > 0 ? incident.authority_alerted.map((auth, i) => (
                            <span key={i} className="text-[9px] px-2 py-1 bg-white/5 rounded text-white/60 font-black uppercase tracking-wider border border-white/5 truncate max-w-[120px]">{auth}</span>
                          )) : (
                            <span className="text-[9px] px-2 py-1 bg-white/5 rounded text-white/20 font-black uppercase tracking-wider border border-white/5">NONE REQUIRED</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right px-6">
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="ghost" size="icon" className="w-10 h-10 rounded-xl opacity-0 group-hover:opacity-100 transition-all hover:bg-white/5">
                            <ChevronRight className="w-5 h-5 text-white/40 group-hover:text-white" />
                          </Button>
                        </div>
                      </TableCell>
                    </motion.tr>
                  ))
                )}
              </AnimatePresence>
            </TableBody>
          </Table>
        </div>

        {/* Pagination Details */}
        <div className="p-4 px-6 border-t border-white/[0.05] flex justify-between items-center bg-white/[0.01]">
          <span className="text-[10px] font-black text-white/30 uppercase tracking-widest">
            VIEWING {(page - 1) * 15 + 1} - {Math.min(page * 15, totalCount)} OF {totalCount}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              className="bg-transparent border-white/10 hover:bg-white/5 rounded-xl w-9 h-9 disabled:opacity-30"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="w-4 h-4 text-white/60" />
            </Button>
            <div className="w-9 h-9 flex items-center justify-center text-[11px] font-black rounded-xl bg-white/5 border border-white/10">{page}</div>
            <Button
              variant="outline"
              size="icon"
              className="bg-transparent border-white/10 hover:bg-white/5 rounded-xl w-9 h-9 disabled:opacity-30"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              <ChevronRight className="w-4 h-4 text-white/60" />
            </Button>
          </div>
        </div>
      </div>

      {/* Incident Detail Side Drawer */}
      <Sheet open={!!selectedIncident} onOpenChange={(open) => !open && setSelectedIncident(null)}>
        <SheetContent className="bg-[#020205] border-white/10 text-white w-full sm:max-w-2xl overflow-auto scrollbar-hide p-0">
          {selectedIncident && (
            <div className="flex flex-col">
              {/* High-Fidelity Capture Visual Top Header */}
              <div className="relative h-72 w-full group overflow-hidden">
                <img src={selectedIncident.screenshot} className="w-full h-full object-cover grayscale brightness-50 group-hover:grayscale-0 group-hover:brightness-100 transition-all duration-700" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#020205] via-black/40 to-black/80" />
                <div className="absolute top-6 left-6 inline-flex px-3 py-1 rounded-lg bg-primary/20 border border-primary/20 backdrop-blur-xl">
                  <span className="text-[9px] font-black text-primary uppercase tracking-[0.4em]">SECURE RECORD • {selectedIncident.id}</span>
                </div>
                <div className="absolute bottom-6 left-8 right-8 flex justify-between items-end">
                  <div className="space-y-2">
                    <h2 className="text-3xl font-black text-white leading-none tracking-tighter uppercase drop-shadow-2xl">{selectedIncident.incident_type}</h2>
                    <div className="flex items-center gap-3 text-white/50 text-[10px] font-black uppercase tracking-[0.2em] pt-2">
                      <span>{getRelativeTime(selectedIncident.timestamp)}</span>
                      <div className="w-1.5 h-1.5 rounded-full bg-white/20" />
                      <span>{selectedIncident.camera_name}</span>
                    </div>
                  </div>
                  <div className={cn(
                    "text-4xl font-black px-6 py-4 rounded-3xl shadow-2xl backdrop-blur-xl border",
                    selectedIncident.severity_score > 7 ? "bg-primary/20 border-primary/30 text-white red-glow-soft" : "bg-white/5 border-white/10 text-white"
                  )}>
                    S{selectedIncident.severity_score}
                  </div>
                </div>
              </div>

              <div className="p-8 space-y-12">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {[
                    { label: "Location", value: selectedIncident.location, icon: MapPin, color: "text-white" },
                    { label: "Feature", value: selectedIncident.feature_name, icon: Target, color: "text-blue-400" },
                    { label: "Dispatch Status", value: selectedIncident.authority_alerted?.length > 0 ? "Resolved" : "Logged", icon: CheckCircle2, color: "text-green-500" },
                  ].map((stat, i) => (
                    <div key={i} className="bg-white/[0.03] p-5 rounded-2xl border border-white/[0.05]">
                      <div className="text-[9px] text-white/30 uppercase tracking-[0.2em] font-black mb-2">{stat.label}</div>
                      <div className="flex items-center gap-3">
                        <stat.icon className={cn("w-4 h-4", stat.color)} />
                        <span className="font-bold text-xs uppercase tracking-tight line-clamp-2 leading-tight">{stat.value}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Specialized Metadata Views */}
                {(selectedIncident.vehicle_plates?.length > 0 || selectedIncident.crowd_density || selectedIncident.escape_direction) && (
                  <div className="space-y-4">
                    <h4 className="text-[9px] font-black text-white/30 uppercase tracking-[0.4em]">Extended Metadata</h4>
                    <div className="grid gap-4">
                      {selectedIncident.vehicle_plates?.map(p => (
                        <div key={p} className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/10">
                          <span className="font-mono text-xl font-bold tracking-widest">{p}</span>
                          <span className="text-[10px] uppercase font-black tracking-widest text-green-400 bg-green-500/10 px-2 py-1 rounded">MATCH: 0.98</span>
                        </div>
                      ))}
                      {selectedIncident.crowd_density && (
                        <div className="p-6 rounded-2xl bg-orange-500/10 border border-orange-500/20 flex flex-col gap-3">
                          <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-orange-400">
                            <span>Analyzed Density Volume</span>
                            <span>{(selectedIncident.crowd_density * 100).toFixed(0)}%</span>
                          </div>
                          <div className="h-2 w-full bg-black/40 rounded-full overflow-hidden">
                            <div className="h-full bg-orange-500 rounded-full w-[85%]" />
                          </div>
                        </div>
                      )}
                      {selectedIncident.escape_direction && (
                        <div className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/10">
                          <div className="flex flex-col">
                            <span className="text-[9px] uppercase font-black tracking-widest text-white/40">Vector Trajectory</span>
                            <span className="font-black text-sm uppercase tracking-widest text-primary">{selectedIncident.escape_direction}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  <h4 className="text-[9px] font-black text-white/30 uppercase tracking-[0.4em]">Groq Vision Synopsis</h4>
                  <p className="text-white/70 text-sm leading-loose font-medium bg-white/[0.02] p-6 rounded-3xl border border-white/[0.04]">
                    "{selectedIncident.groq_description}"
                  </p>
                </div>

                <div className="space-y-6">
                  <h4 className="text-[9px] font-black text-white/30 uppercase tracking-[0.4em]">API Notification Deliveries</h4>
                  <div className="space-y-4">
                    {[
                      { name: "Authorities", value: selectedIncident.authority_alerted?.join(", ") || "None Required" },
                      { name: "Telegram Bot", value: selectedIncident.alert_channels?.telegram },
                      { name: "WhatsApp Net", value: selectedIncident.alert_channels?.whatsapp },
                    ].map((log, i) => (
                      <div key={i} className="flex justify-between items-center p-3 rounded-xl hover:bg-white/[0.02]">
                        <span className="text-[11px] font-black text-white/50 uppercase tracking-widest">{log.name}</span>
                        <span className={cn(
                          "text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded",
                          log.value === "sent" ? "bg-green-500/20 text-green-400" : log.value === "failed" ? "bg-red-500/20 text-red-400" : "bg-white/5 text-white/40"
                        )}>
                          {log.value || "UNKNOWN"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

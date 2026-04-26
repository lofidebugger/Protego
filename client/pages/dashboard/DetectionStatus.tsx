import { useState, useEffect } from "react";
import {
   Activity,
   Shield,
   Layers,
   Zap,
   Power,
   AlertTriangle,
   Clock,
   MapPin,
   Car,
   ChevronRight,
   ShieldAlert,
   Users,
   Target,
   ExternalLink,
   Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { io } from "socket.io-client";
import { useToast } from "@/components/ui/use-toast";
import {
   Dialog,
   DialogContent,
   DialogHeader,
   DialogTitle,
   DialogDescription,
} from "@/components/ui/dialog";

interface FeatureStatus {
   feature_id: string;
   feature_name: string;
   description: string;
   is_active: boolean;
   last_triggered: string | null;
   alerts_today: number;
   current_confidence: number;
   model_name: string;
   authority_type: string;
}

interface FeatureUpdate {
   feature_id: string;
   current_confidence: number;
   is_detecting: boolean;
   frame_count: number;
}

interface LoiteringSuspect {
   suspect_id: string;
   location: string;
   appearances: number;
   first_seen: string;
   last_seen: string;
   vehicle_plate: string | null;
   thumbnail: string;
}

interface SystemStats {
   active_features: number;
   total_features: number;
   total_detections_today: number;
   most_active_feature: string;
   current_fps: number;
}

interface AlertPreview {
   id: string;
   incident_type: string;
   severity_score: number;
   location: string;
   timestamp: string;
   screenshot: string;
   gemini_description: string;
}

export default function Analytics() {
   const [features, setFeatures] = useState<Record<string, FeatureStatus>>({});
   const [liveUpdates, setLiveUpdates] = useState<Record<string, FeatureUpdate>>({});
   const [recentAlerts, setRecentAlerts] = useState<Record<string, AlertPreview | null>>({});
   const [loiteringSuspects, setLoiteringSuspects] = useState<LoiteringSuspect[]>([]);
   const [systemStats, setSystemStats] = useState<SystemStats>({
      active_features: 0,
      total_features: 8,
      total_detections_today: 0,
      most_active_feature: "-",
      current_fps: 0,
   });
   const [toggling, setToggling] = useState<Record<string, boolean>>({});
   const [selectedAlert, setSelectedAlert] = useState<AlertPreview | null>(null);

   const { toast } = useToast();

   const fetchInitialData = async () => {
      try {
         const unwrap = async (url: string) => {
            try {
               const res = await fetch(url);
               if (!res.ok) return null;
               const body = await res.json();
               return body?.data ?? body;
            } catch { return null; }
         };

         const [statusData, alertsData, suspectsData, statsData] = await Promise.all([
            unwrap("http://127.0.0.1:5000/api/features/status"),
            unwrap("http://127.0.0.1:5000/api/features/recent"),
            unwrap("http://127.0.0.1:5000/api/features/loitering"),
            unwrap("http://127.0.0.1:5000/api/system/stats"),
         ]);

         if (Array.isArray(statusData)) {
            const featMap: Record<string, FeatureStatus> = {};
            statusData.forEach((f: FeatureStatus) => featMap[f.feature_id] = f);
            setFeatures(featMap);
         }

         if (alertsData && typeof alertsData === 'object') setRecentAlerts(alertsData);
         if (Array.isArray(suspectsData)) setLoiteringSuspects(suspectsData);
         if (statsData && typeof statsData === 'object' && 'current_fps' in statsData) setSystemStats(statsData);

      } catch (err) {
         console.error("Failed to fetch initial detection data:", err);
         toast({ title: "Backend Connection Error", description: "Is the Flask server running?", variant: "destructive" });
      }
   };

   useEffect(() => {
      fetchInitialData();
      const statsInterval = setInterval(() => {
         fetch("http://127.0.0.1:5000/api/system/stats")
            .then(res => res.json())
            .then(data => { if (data.current_fps) setSystemStats(data) })
            .catch(() => { });
      }, 10000);

      return () => clearInterval(statsInterval);
   }, []);

   useEffect(() => {
      const socket = io("http://127.0.0.1:5000", {
         reconnection: true,
         transports: ["polling"],
         upgrade: false,
      });

      socket.on("feature_update", (updates: FeatureUpdate[]) => {
         const arr = Array.isArray(updates) ? updates : [];
         setLiveUpdates(prev => {
            const newUpdates = { ...prev };
            arr.forEach(u => newUpdates[u.feature_id] = u);
            return newUpdates;
         });
      });

      const suspectInterval = setInterval(() => {
         fetch("http://127.0.0.1:5000/api/features/loitering")
            .then(res => res.json())
            .then(body => {
               const data = body?.data ?? body;
               if (Array.isArray(data)) setLoiteringSuspects(data);
            })
            .catch(() => { });
      }, 5000);

      return () => {
         socket.disconnect();
         clearInterval(suspectInterval);
      };
   }, []);

   const toggleFeature = async (featureId: string, currentState: boolean) => {
      setToggling(prev => ({ ...prev, [featureId]: true }));
      try {
         const response = await fetch("http://127.0.0.1:5000/api/features/toggle", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ feature_id: featureId, is_active: !currentState })
         });
         const data = await response.json();
         if (data.success) {
            setFeatures(prev => ({
               ...prev,
               [featureId]: { ...prev[featureId], is_active: !currentState }
            }));
            toast({ title: `${!currentState ? 'Enabled' : 'Disabled'} ${features[featureId]?.feature_name}` });
            fetchInitialData(); // Refresh global stats immediately
         }
      } catch (err) {
         toast({ title: "Failed to toggle feature", variant: "destructive" });
      } finally {
         setToggling(prev => ({ ...prev, [featureId]: false }));
      }
   };

   const getRelativeTime = (isoTime: string | null) => {
      if (!isoTime) return "No triggers today";
      const then = new Date(isoTime);
      const diffInMinutes = Math.floor((Date.now() - then.getTime()) / 60000);

      if (diffInMinutes < 1) return "Just now";
      if (diffInMinutes < 60) return `${diffInMinutes} min ago`;
      const diffInHours = Math.floor(diffInMinutes / 60);
      if (diffInHours < 24) return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;
      return "Yesterday";
   };

   const renderStampedeCard = (feat: FeatureStatus, latestUpdate: FeatureUpdate | undefined) => {
      const conf = latestUpdate?.current_confidence ?? feat.current_confidence;
      const densityPercent = Math.round(conf * 100);
      const densityColor = densityPercent > 70 ? "text-red-500" : densityPercent > 40 ? "text-orange-500" : "text-green-500";
      const densityBg = densityPercent > 70 ? "bg-red-500" : densityPercent > 40 ? "bg-orange-500" : "bg-green-500";

      return (
         <div className="mt-4 p-4 rounded-xl bg-black/40 border border-white/5 space-y-4">
            <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-white/50">
               <span>LIVE CROWD DENSITY</span>
               <span className={densityColor}>{densityPercent}%</span>
            </div>
            <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
               <motion.div
                  animate={{ width: `${densityPercent}%` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                  className={cn("h-full", densityBg)}
                  style={{
                     boxShadow: densityPercent > 70 ? '0 0 20px rgba(239, 68, 68, 0.5)' : 'none'
                  }}
               />
            </div>
            {densityPercent > 70 && (
               <div className="flex items-start gap-3 p-3 mt-4 rounded-xl bg-red-500/10 border border-red-500/20 red-glow-soft">
                  <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <div className="flex flex-col">
                     <span className="text-[10px] font-black text-red-500 uppercase tracking-widest leading-tight">CRITICAL DENSITY THRESHOLD</span>
                     <span className="text-[9px] text-red-400/80 uppercase font-bold mt-1 tracking-wider leading-relaxed">Stampede prediction alert will fire in ~60s if density continues rising.</span>
                  </div>
               </div>
            )}
         </div>
      );
   };

   const renderLoiteringCard = () => {
      return (
         <div className="mt-4 p-4 rounded-xl bg-black/40 border border-white/5 space-y-3">
            <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-white/50 mb-2">
               <span>ACTIVE SURVEILLANCE TARGETS</span>
               <span>{loiteringSuspects.length} SUBJECTS</span>
            </div>
            <div className="space-y-2">
               {loiteringSuspects.slice(0, 3).map((suspect, i) => (
                  <div key={i} className={cn(
                     "flex items-center gap-3 p-2 rounded-xl bg-white/[0.02]",
                     suspect.appearances > 3 && "bg-red-500/10 border border-red-500/20"
                  )}>
                     <img src={suspect.thumbnail} className="w-8 h-8 rounded-lg object-cover border border-white/10" />
                     <div className="flex-1 flex flex-col justify-center">
                        <div className="flex justify-between items-center">
                           <span className="text-[10px] font-black uppercase tracking-tight w-24 truncate">{suspect.suspect_id}</span>
                           <span className={cn(
                              "text-[9px] font-black px-1.5 py-0.5 rounded tracking-widest",
                              suspect.appearances > 3 ? "bg-red-500 text-white" : "bg-white/10 text-white/50"
                           )}>
                              {suspect.appearances} SEEN
                           </span>
                        </div>
                        <span className="text-[9px] font-bold text-white/40 uppercase truncate mt-0.5">{suspect.location} | {getRelativeTime(suspect.last_seen)}</span>
                     </div>
                  </div>
               ))}
               {loiteringSuspects.length === 0 && (
                  <div className="text-center p-4 text-[10px] font-black text-white/30 uppercase tracking-widest">
                     NO EXCEEDANCES TRACKED
                  </div>
               )}
            </div>
         </div>
      );
   };

   return (
      <div className="flex flex-col gap-10 pb-20">
         {/* Top Controls & System Stats */}
         <div className="flex flex-col md:row items-center justify-between gap-6">
            <div>
               <h1 className="text-3xl font-black tracking-tighter uppercase mb-2">Detection Status</h1>
               <div className="flex items-center gap-3">
                  <div className="px-2.5 py-1 bg-white/5 border border-white/5 rounded-lg flex items-center gap-2">
                     <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                     <span className="text-[10px] font-black text-white/60 uppercase tracking-[0.3em]">SYSTEM ONLINE</span>
                  </div>
                  <p className="text-xs text-white/40 font-medium uppercase tracking-widest leading-none">ALL NEURAL ENGINES ACTIVE</p>
               </div>
            </div>
         </div>

         <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {[
               { label: "Active Engines", value: `${systemStats.active_features} / ${systemStats.total_features}`, icon: Layers, color: "text-green-400", bg: "bg-green-400/10" },
               { label: "Total Interventions", value: systemStats.total_detections_today.toLocaleString(), icon: Target, color: "text-primary", bg: "bg-primary/20", glow: true },
               { label: "High Volume", value: systemStats.most_active_feature, icon: Activity, color: "text-orange-400", bg: "bg-orange-400/10", truncate: true },
               { label: "Neural Throughput", value: `${systemStats.current_fps} FPS`, icon: Zap, color: "text-blue-400", bg: "bg-blue-400/10" },
            ].map((stat, i) => (
               <div key={i} className={cn(
                  "premium-glass p-5 bg-white/[0.02] border-white/[0.04] flex flex-col gap-3 group transition-all hover:bg-white/[0.05]",
                  stat.glow && "red-glow-soft ring-1 ring-primary/20"
               )}>
                  <div className="flex items-center justify-between mb-2">
                     <div className={cn("p-2 rounded-xl border border-white/5", stat.bg)}>
                        <stat.icon className={cn("w-4 h-4", stat.color)} />
                     </div>
                  </div>
                  <div>
                     <div className={cn(
                        "text-3xl font-black tracking-tighter leading-none mb-2",
                        stat.truncate && "text-xl leading-tight h-8 line-clamp-2 pb-1"
                     )}>{stat.value}</div>
                     <div className="text-[10px] text-white/40 uppercase font-black tracking-widest mt-1">{stat.label}</div>
                  </div>
               </div>
            ))}
         </div>

         {/* Feature Grid */}
         <div className="grid md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
            {Object.values(features).map(feat => {
               const latestUpdate = liveUpdates[feat.feature_id];
               const isDetecting = feat.is_active && latestUpdate?.is_detecting;
               const conf = feat.is_active ? (latestUpdate?.current_confidence ?? feat.current_confidence) : 0;
               const recentAlert = recentAlerts[feat.feature_id];

               return (
                  <div
                     key={feat.feature_id}
                     className={cn(
                        "premium-glass border flex flex-col transition-all duration-300 relative overflow-hidden",
                        isDetecting
                           ? "border-primary/50 shadow-[0_0_30px_rgba(230,57,70,0.15)] ring-1 ring-primary/30"
                           : "bg-white/[0.02] border-white/[0.05] hover:bg-white/[0.04]"
                     )}
                  >
                     {/* Pulsing indicator when detecting */}
                     {isDetecting && (
                        <motion.div
                           animate={{ opacity: [0.1, 0.3, 0.1] }}
                           transition={{ duration: 1.5, repeat: Infinity }}
                           className="absolute inset-0 bg-primary/10 pointer-events-none"
                        />
                     )}

                     <div className="p-6 pb-4 border-b border-white/[0.05] flex justify-between items-start z-10">
                        <div className="flex flex-col flex-1 pr-4">
                           <span className="text-[10px] font-black text-primary uppercase tracking-[0.3em] mb-1.5">{feat.model_name}</span>
                           <h3 className="text-xl font-black tracking-tight leading-none mb-3">{feat.feature_name}</h3>
                           <p className="text-[11px] font-bold text-white/40 leading-relaxed min-h-[46px]">{feat.description}</p>
                        </div>
                        <div className="flex flex-col items-end gap-2 shrink-0">
                           <Switch
                              checked={feat.is_active}
                              disabled={toggling[feat.feature_id]}
                              onCheckedChange={() => toggleFeature(feat.feature_id, feat.is_active)}
                           />
                           <span className={cn(
                              "text-[9px] font-black tracking-widest uppercase mt-1",
                              feat.is_active ? "text-green-500" : "text-white/20"
                           )}>
                              {feat.is_active ? "Online" : "Offline"}
                           </span>
                        </div>
                     </div>

                     <div className="p-6 flex-1 flex flex-col z-10 relative">
                        <div className="flex justify-between items-center mb-6">
                           <div className="flex flex-col">
                              <span className="text-[28px] font-black leading-none">{feat.alerts_today}</span>
                              <span className="text-[9px] font-black text-white/30 uppercase tracking-[0.2em] mt-1">Daily Log</span>
                           </div>
                           <div className="flex flex-col text-right">
                              <span className="text-[11px] font-black text-white/60 tracking-wider">
                                 ROUTE: {feat.authority_type}
                              </span>
                           </div>
                        </div>

                        <div className="space-y-2 mb-6">
                           <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-white/50">
                              <span>CONFIDENCE VECTOR</span>
                              <span className={isDetecting ? "text-primary transition-colors" : ""}>{(conf * 100).toFixed(1)}%</span>
                           </div>
                           <div className={cn(
                              "h-2 w-full rounded-full overflow-hidden transition-colors",
                              feat.is_active ? "bg-white/10" : "bg-white/5"
                           )}>
                              <motion.div
                                 animate={{ width: `${conf * 100}%` }}
                                 transition={{ duration: 0.3, ease: "easeOut" }}
                                 className={cn(
                                    "h-full",
                                    isDetecting ? "bg-primary shadow-[0_0_10px_rgba(230,57,70,0.8)]" : feat.is_active ? "bg-white/50" : "bg-white/10"
                                 )}
                              />
                           </div>
                        </div>

                        {feat.feature_id === "feat-4" && renderStampedeCard(feat, latestUpdate)}
                        {feat.feature_id === "feat-5" && renderLoiteringCard()}

                        <div className="mt-auto pt-6 border-t border-white/5">
                           <h4 className="text-[9px] font-black text-white/20 uppercase tracking-[0.3em] mb-4">Latest Encounter</h4>
                           {recentAlert ? (
                              <div
                                 className="flex items-center gap-4 bg-white/[0.02] p-3 rounded-2xl border border-white/5 cursor-pointer hover:bg-white/[0.05] transition-all group"
                                 onClick={() => setSelectedAlert(recentAlert)}
                              >
                                 <img src={recentAlert.screenshot} className="w-12 h-12 rounded-xl object-cover grayscale brightness-75 group-hover:grayscale-0 group-hover:brightness-100 transition-all border border-white/10" />
                                 <div className="flex-1 flex flex-col justify-center gap-1 min-w-0">
                                    <div className="flex justify-between items-center">
                                       <span className="text-[10px] font-black tracking-tight uppercase truncate">{recentAlert.location}</span>
                                       <span className="text-[9px] font-black text-primary bg-primary/10 px-1.5 rounded flex-shrink-0">S:{recentAlert.severity_score}</span>
                                    </div>
                                    <div className="text-[9px] font-black text-white/40 uppercase tracking-widest flex items-center gap-1.5">
                                       <Clock className="w-3 h-3 text-white/20" />
                                       {getRelativeTime(recentAlert.timestamp)}
                                    </div>
                                 </div>
                              </div>
                           ) : (
                              <div className="text-[10px] font-black text-white/20 uppercase tracking-widest bg-white/[0.02] p-4 rounded-xl border border-white/5 text-center">
                                 Awaiting Detections
                              </div>
                           )}
                        </div>
                     </div>
                  </div>
               )
            })}
         </div>

         {/* Alert Detail Modal */}
         <Dialog open={!!selectedAlert} onOpenChange={(open) => !open && setSelectedAlert(null)}>
            <DialogContent className="bg-[#020205] border-white/10 text-white sm:max-w-2xl p-0 overflow-hidden">
               {selectedAlert && (
                  <div className="flex flex-col">
                     <div className="relative h-64 w-full group">
                        <img src={selectedAlert.screenshot} className="w-full h-full object-cover grayscale brightness-50 group-hover:grayscale-0 group-hover:brightness-100 transition-all duration-700" />
                        <div className="absolute inset-0 bg-gradient-to-t from-[#020205] via-transparent to-transparent flex items-end">
                           <div className="p-8 pb-4 w-full flex justify-between items-end">
                              <div className="flex flex-col gap-2">
                                 <span className="px-3 py-1 bg-primary/20 red-glow-soft border border-primary/20 text-primary text-[10px] uppercase font-black tracking-[0.3em] inline-flex w-fit rounded-lg">
                                    INC {selectedAlert.id}
                                 </span>
                                 <DialogTitle className="text-3xl font-black uppercase tracking-tighter shadow-black drop-shadow-lg">
                                    {selectedAlert.incident_type}
                                 </DialogTitle>
                              </div>
                              <div className="text-[40px] font-black leading-none tracking-tighter text-white drop-shadow-lg">
                                 {selectedAlert.severity_score}
                              </div>
                           </div>
                        </div>
                     </div>

                     <div className="p-8 space-y-6">
                        <div className="grid grid-cols-2 gap-4">
                           <div className="flex items-center gap-3 bg-white/5 p-4 rounded-2xl">
                              <MapPin className="w-4 h-4 text-white/40" />
                              <div className="flex flex-col">
                                 <span className="text-[9px] font-black uppercase tracking-widest text-white/30">Sector</span>
                                 <span className="text-[11px] font-bold tracking-tight uppercase">{selectedAlert.location}</span>
                              </div>
                           </div>
                           <div className="flex items-center gap-3 bg-white/5 p-4 rounded-2xl">
                              <Clock className="w-4 h-4 text-white/40" />
                              <div className="flex flex-col">
                                 <span className="text-[9px] font-black uppercase tracking-widest text-white/30">Time of Incident</span>
                                 <span className="text-[11px] font-bold tracking-tight uppercase">{new Date(selectedAlert.timestamp).toLocaleString()}</span>
                              </div>
                           </div>
                        </div>

                        <div className="space-y-3">
                           <h4 className="text-[9px] font-black uppercase tracking-[0.4em] text-white/30">AI Triage Context</h4>
                           <p className="text-sm font-medium text-white/70 leading-relaxed p-4 bg-white/5 border border-white/5 rounded-2xl rounded-tr-none">
                              {selectedAlert.gemini_description}
                           </p>
                        </div>
                     </div>
                  </div>
               )}
            </DialogContent>
         </Dialog>
      </div>
   );
}

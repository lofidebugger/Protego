import { ShieldAlert, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmergencyAlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  incidentType: string;
  location: string;
  time: string;
  additionalMessage: string;
  onPlayVoice?: () => void;
  isPlayingVoice?: boolean;
}

export function EmergencyAlertModal({
  isOpen,
  onClose,
  incidentType,
  location,
  time,
  additionalMessage,
  onPlayVoice,
  isPlayingVoice = false,
}: EmergencyAlertModalProps) {
  if (!isOpen) return null;

  return (
    <div className="rounded-3xl border border-red-500/30 bg-[#0a0a0f] p-5 shadow-2xl space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-red-500/15 border border-red-500/30 shrink-0">
            <ShieldAlert className="w-5 h-5 text-red-500" />
          </div>
          <div>
            <div className="text-xl font-black uppercase tracking-widest text-white">Emergency Alert</div>
            <div className="text-[11px] uppercase tracking-[0.25em] text-red-400 font-black mt-1 flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
              </span>
              Live alert active
            </div>
          </div>
        </div>
        <Button onClick={onClose} variant="outline" className="border-white/10 bg-white/5 hover:bg-white/10 text-white">
          Close
        </Button>
      </div>

      <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4">
        <div className="text-[11px] uppercase tracking-[0.25em] text-red-300 font-black mb-2 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          Voice summary
        </div>
        <p className="text-sm text-red-100/90 leading-relaxed">
          Due to trial limitations of Twilio, real-time phone calls to unverified numbers are restricted. However, we have implemented a real-time voice alert system that replicates emergency calls instantly.
        </p>
      </div>

      <div className="grid gap-3 text-sm">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-[10px] uppercase tracking-[0.25em] text-white/40 font-black mb-1">Incident</div>
          <div className="text-white font-bold leading-relaxed">
            {additionalMessage || incidentType || "Incident detected"}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-[10px] uppercase tracking-[0.25em] text-white/40 font-black mb-1">Location</div>
            <div className="text-white font-bold leading-relaxed">{location}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-[10px] uppercase tracking-[0.25em] text-white/40 font-black mb-1">Time</div>
            <div className="text-white font-bold leading-relaxed">{time}</div>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        {onPlayVoice && (
          <Button
            onClick={onPlayVoice}
            disabled={isPlayingVoice}
            className="bg-blue-500 hover:bg-blue-600 text-white font-black uppercase tracking-widest"
          >
            {isPlayingVoice ? "Playing..." : "Replay Voice"}
          </Button>
        )}
      </div>
    </div>
  );
}

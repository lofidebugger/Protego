import React, { useEffect, useState, useRef } from 'react';
import { ShieldAlert, X, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface EmergencyCallOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  incident: any;
}

const EmergencyCallOverlay: React.FC<EmergencyCallOverlayProps> = ({ isOpen, onClose, incident }) => {
  const speechRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentTime, setCurrentTime] = useState('');

  useEffect(() => {
    if (isOpen) {
      setCurrentTime(new Date().toLocaleTimeString());
      
      const timer = setTimeout(() => {
        const text = `Due to trial limitations of Twilio, real-time phone calls to unverified numbers are restricted. However, we have implemented a real-time voice alert system that replicates emergency calls instantly. Emergency Alert. Incident detected. Location: ${incident?.location || 'Unknown'}. Time: ${new Date().toLocaleTimeString()}. Immediate attention is required.`;
        
        const utterance = new SpeechSynthesisUtterance(text);
        
        // Find a natural voice
        const voices = window.speechSynthesis.getVoices();
        const googleVoice = voices.find(v => v.name.includes('Google') && v.lang.includes('en'));
        if (googleVoice) {
          utterance.voice = googleVoice;
        }
        
        utterance.rate = 0.95;
        utterance.pitch = 1.0;
        
        utterance.onstart = () => setIsSpeaking(true);
        utterance.onend = () => setIsSpeaking(false);
        
        speechRef.current = utterance;
        window.speechSynthesis.speak(utterance);
      }, 400);

      return () => {
        clearTimeout(timer);
        window.speechSynthesis.cancel();
      };
    }
  }, [isOpen, incident]);

  // Handle voices being loaded asynchronously
  useEffect(() => {
    const loadVoices = () => { window.speechSynthesis.getVoices(); };
    window.speechSynthesis.onvoiceschanged = loadVoices;
    loadVoices();
  }, []);

  const handleClose = () => {
    window.speechSynthesis.cancel();
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />

          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-lg bg-[#0a0a0f] border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex flex-col"
          >
            {/* Header */}
            <div className="relative p-6 border-b border-white/10 bg-gradient-to-b from-red-500/10 to-transparent flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-2xl bg-red-500/20 border border-red-500/30">
                  <ShieldAlert className="w-6 h-6 text-red-500" />
                </div>
                <div>
                  <h2 className="text-xl font-black uppercase tracking-widest text-white">Emergency Alert</h2>
                  <p className="text-xs text-red-400 uppercase tracking-widest font-semibold flex items-center gap-1 mt-1">
                    <span className="relative flex h-2 w-2 mr-1">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                    </span>
                    Real-time voice alert active
                  </p>
                </div>
              </div>
              <button 
                onClick={handleClose}
                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 transition-colors text-white/50 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-4 flex gap-3">
                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-red-300/80 uppercase tracking-wider leading-relaxed">
                  Due to trial limitations of Twilio, real-time phone calls to unverified numbers are restricted. We have implemented a real-time voice alert system to replicate emergency calls instantly.
                </p>
              </div>

              <div className="grid gap-4">
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                  <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em] mb-1">Incident Type</p>
                  <p className="text-base font-bold text-white">{incident?.incident_type || 'Unknown Incident'}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                    <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em] mb-1">Location</p>
                    <p className="text-sm font-bold text-white truncate" title={incident?.location}>{incident?.location || 'Unknown'}</p>
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                    <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em] mb-1">Time</p>
                    <p className="text-sm font-bold text-white">{currentTime}</p>
                  </div>
                </div>
              </div>

              {/* TTS Visualization */}
              <div className="pt-2">
                <div className="flex items-center gap-3 justify-center">
                  <div className={`h-1.5 w-1.5 rounded-full ${isSpeaking ? 'bg-blue-400 animate-bounce' : 'bg-white/20'}`} style={{ animationDelay: '0ms' }} />
                  <div className={`h-1.5 w-1.5 rounded-full ${isSpeaking ? 'bg-blue-400 animate-bounce' : 'bg-white/20'}`} style={{ animationDelay: '150ms' }} />
                  <div className={`h-1.5 w-1.5 rounded-full ${isSpeaking ? 'bg-blue-400 animate-bounce' : 'bg-white/20'}`} style={{ animationDelay: '300ms' }} />
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40 ml-2">
                    {isSpeaking ? 'Speaking...' : 'Message Completed'}
                  </span>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 pt-0">
              <button 
                onClick={handleClose}
                className="w-full py-4 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-white font-black uppercase tracking-widest text-xs transition-colors"
              >
                Acknowledge & Close
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default EmergencyCallOverlay;

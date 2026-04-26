import React, { useState, useEffect } from 'react';
import { Mail, Phone, Send, CheckCircle2, MessageSquare, ShieldCheck, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface AdminSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSetupComplete?: () => void;
}

const AdminSetupModal: React.FC<AdminSetupModalProps> = ({ isOpen, onClose, onSetupComplete }) => {
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [telegramStatus, setTelegramStatus] = useState<{ is_connected: boolean, registration_code?: string, bot_username?: string }>({ is_connected: false });
  const [isLoadingTelegram, setIsLoadingTelegram] = useState(false);

  useEffect(() => {
    if (isOpen) {
      checkTelegramStatus();
    }
  }, [isOpen]);

  const API = "http://127.0.0.1:5000";

  const checkTelegramStatus = async () => {
    try {
      const resp = await fetch(`${API}/api/telegram/status`);
      const json = await resp.json();
      if (json.success) {
        setTelegramStatus(prev => {
          if (!prev.is_connected && json.data.is_connected) {
            if (onSetupComplete) onSetupComplete();
          }
          return json.data;
        });
      }
    } catch (e) {
      console.error(e);
    }
  };

  const requestTelegramCode = async () => {
    setIsLoadingTelegram(true);
    try {
      const resp = await fetch(`${API}/api/telegram/request-code`, { method: 'POST' });
      const json = await resp.json();
      if (json.success) {
        const code = json.data.code;
        const botUsername = json.data.bot_username || 'ProtegoSafetyBot';
        setTelegramStatus(prev => ({ ...prev, registration_code: code, bot_username: botUsername }));
        // Auto-open Telegram bot for the user
        window.open(`https://t.me/${botUsername}?start=${code}`, '_blank');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingTelegram(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const resp = await fetch(`${API}/api/alerts/register-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, phone })
      });
      const json = await resp.json();
      if (json.success || json.status === "registered") {
        setSaved(true);
        if (onSetupComplete) onSetupComplete();
        setTimeout(() => {
          setSaved(false);
          onClose();
        }, 2000);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[50] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      
      <motion.div 
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        className="relative w-full max-w-lg bg-[#0f172a] border border-white/10 rounded-3xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="p-6 border-b border-white/5 bg-gradient-to-r from-blue-600/10 to-purple-600/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/20 rounded-xl">
                <ShieldCheck className="text-blue-400" size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Judge Setup Panel</h2>
                <p className="text-xs text-white/40 uppercase tracking-widest font-semibold">Demo Control Unit</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <X size={20} className="text-white/40" />
            </button>
          </div>
        </div>

        <div className="p-8 space-y-8">
          {/* Email/Phone Section */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-white/60 flex items-center gap-2">
              <Mail size={16} /> Contact Configuration
            </h3>
            
            <div className="grid grid-cols-1 gap-4">
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-white/20 group-focus-within:text-blue-500 transition-colors">
                  <Mail size={18} />
                </div>
                <input 
                  type="email" 
                  placeholder="Your Email for Alerts"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all placeholder:text-white/20"
                />
              </div>

              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-white/20 group-focus-within:text-blue-500 transition-colors">
                  <Phone size={18} />
                </div>
                <input 
                  type="tel" 
                  placeholder="Your WhatsApp/Phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all placeholder:text-white/20"
                />
              </div>
            </div>

            <button 
              onClick={handleSave}
              disabled={isSaving}
              className={`w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all ${
                saved ? 'bg-green-600 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20 active:scale-[0.98]'
              }`}
            >
              {isSaving ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : saved ? (
                <><CheckCircle2 size={20} /> Saved Successfully</>
              ) : (
                <>Save Contact Info</>
              )}
            </button>
          </div>

          <div className="h-px bg-white/5" />

          {/* Telegram Section */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-white/60 flex items-center gap-2">
              <MessageSquare size={16} /> Telegram Alert Bot
            </h3>

            {telegramStatus.is_connected ? (
              <div className="bg-green-500/10 border border-green-500/20 rounded-2xl p-6 flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                  <CheckCircle2 className="text-green-500" size={24} />
                </div>
                <div>
                  <p className="font-bold text-white">Bot Connected</p>
                  <p className="text-sm text-white/40">You will receive rich alerts on Telegram.</p>
                </div>
              </div>
            ) : telegramStatus.registration_code ? (
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-white/40 uppercase tracking-widest font-bold">Step 2: Connect Bot</p>
                    <p className="text-lg font-bold text-white">Verification Code</p>
                  </div>
                  <div className="text-2xl font-mono font-black text-blue-400 bg-blue-500/20 px-4 py-2 rounded-xl">
                    {telegramStatus.registration_code}
                  </div>
                </div>
                <p className="text-sm text-white/60">
                  Send <strong>/start {telegramStatus.registration_code}</strong> to <a href={`https://t.me/${telegramStatus.bot_username || 'ProtegoSafetyBot'}`} target="_blank" className="text-blue-400 hover:underline">@{telegramStatus.bot_username || 'ProtegoSafetyBot'}</a>
                </p>
                <div className="flex items-center gap-2 text-xs text-white/40 italic animate-pulse">
                  <div className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
                  Waiting for bot message...
                </div>
              </div>
            ) : (
              <button 
                onClick={requestTelegramCode}
                disabled={isLoadingTelegram}
                className="w-full py-6 rounded-2xl bg-[#22c55e]/10 border border-[#22c55e]/20 hover:bg-[#22c55e]/20 transition-all group flex flex-col items-center gap-2"
              >
                {isLoadingTelegram ? (
                  <div className="w-6 h-6 border-2 border-green-500/30 border-t-green-500 rounded-full animate-spin" />
                ) : (
                  <>
                    <div className="p-3 bg-green-500/20 rounded-full group-hover:scale-110 transition-transform">
                      <Send className="text-green-500" size={24} />
                    </div>
                    <span className="font-bold text-green-500">Connect Telegram Bot</span>
                    <span className="text-xs text-white/40 italic">Receive AI snapshots & voice notes</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 bg-white/[0.02] text-center border-t border-white/5">
          <p className="text-[10px] text-white/20 uppercase tracking-[0.2em]">Protego Safety Framework | Hackathon Deployment Build</p>
        </div>
      </motion.div>
    </div>
  );
};

export default AdminSetupModal;

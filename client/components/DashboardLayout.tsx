import { Link, useLocation } from "react-router-dom";
import {
  Shield,
  LayoutDashboard,
  History,
  BarChart3,
  Settings,
  Circle,
  AlertTriangle,
  Menu,
  Bell,
  Search,
  User,
  Power,
  Film
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const navItems = [
  { icon: LayoutDashboard, label: "Live Monitor", path: "/dashboard/live" },
  { icon: AlertTriangle, label: "Detection Status", path: "/dashboard/status" },
  { icon: History, label: "Incident History", path: "/dashboard/history" },
  { icon: BarChart3, label: "Analytics", path: "/dashboard/analytics" },
  { icon: Film, label: "Video Analyzer", path: "/video-analyzer" },
  { icon: Settings, label: "Settings", path: "/dashboard/settings" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  return (
    <div className="flex h-screen bg-[#020205] text-white overflow-hidden selection:bg-primary/30">
      {/* Sidebar Grain Overlay */}
      <div className="fixed inset-0 pointer-events-none z-50 opacity-[0.02] bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />

      {/* Modern OS-like Sidebar */}
      <aside
        className={cn(
          "w-72 bg-black/40 backdrop-blur-3xl border-r border-white/[0.04] flex flex-col transition-all duration-500 relative z-40",
          !isSidebarOpen && "-ml-72 lg:ml-0 lg:w-24"
        )}
      >
        {/* Logo Section */}
        <div className="p-8 pb-4 flex items-center gap-4">
          <div className="p-2.5 bg-primary/20 rounded-xl red-glow-soft border border-primary/20 transition-all hover:scale-110 cursor-pointer">
            <Shield className="w-6 h-6 text-primary fill-primary/10" />
          </div>
          <AnimatePresence>
            {isSidebarOpen && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="flex flex-col"
              >
                <span className="text-xl font-black tracking-tighter leading-none">PROTEGO</span>
                <span className="text-[7px] font-bold text-primary tracking-[0.4em] mt-0.5 uppercase">Security Node</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 space-y-1.5 mt-10">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all group relative",
                  isActive
                    ? "bg-white/[0.05] text-white shadow-xl border border-white/[0.05] ring-1 ring-white/[0.05]"
                    : "text-white/30 hover:bg-white/[0.02] hover:text-white"
                )}
              >
                <item.icon className={cn("w-5 h-5 transition-colors", isActive ? "text-primary scale-110" : "group-hover:text-primary")} />
                {isSidebarOpen && (
                  <span className="text-[11px] font-black uppercase tracking-[0.15em] transition-all">
                    {item.label}
                  </span>
                )}
                {isActive && (
                  <motion.div
                    layoutId="active-pill"
                    className="absolute left-0 w-1 h-5 bg-primary rounded-full"
                  />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Bottom Infrastructure Section */}
        <div className="p-6 mt-auto">
          <div className="premium-glass p-5 bg-white/[0.02] border-white/[0.04] relative group">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Circle className="w-2.5 h-2.5 text-green-500 fill-green-500" />
                  <div className="absolute inset-0 bg-green-500 rounded-full animate-ping opacity-20" />
                </div>
                {isSidebarOpen && (
                  <span className="text-[9px] font-black text-green-500 uppercase tracking-widest">INFRA ONLINE</span>
                )}
              </div>
              <div className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center opacity-40 group-hover:opacity-100 transition-opacity">
                <Power className="w-3 h-3 text-white" />
              </div>
            </div>

            {isSidebarOpen && (
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-[8px] text-white/30 uppercase tracking-[0.2em] font-black">Node Health</span>
                    <span className="text-[8px] text-white/60 font-black tracking-widest">98.4%</span>
                  </div>
                  <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: "98.4%" }}
                      className="h-full bg-gradient-to-r from-primary to-secondary"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-white/[0.04]">
                  <div className="flex flex-col">
                    <span className="text-[12px] font-black tracking-tight leading-none mb-0.5">1,240</span>
                    <span className="text-[7px] text-white/20 uppercase tracking-[0.1em] font-black">Active Sensors</span>
                  </div>
                  <AlertTriangle className="w-4 h-4 text-primary/40" />
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-auto flex flex-col relative bg-[#020205]">
        {/* Top Desktop Navigation Bar */}
        <header className="hidden lg:flex items-center justify-between px-10 py-6 border-b border-white/[0.04] bg-black/20 backdrop-blur-md sticky top-0 z-30">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-3 text-white/30">
              <Search className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-[0.2em]">Global Incident Search</span>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-4 pr-6 border-r border-white/5">
              <div className="relative">
                <Bell className="w-4 h-4 text-white/40 hover:text-white transition-colors cursor-pointer" />
                <div className="absolute -top-1 -right-1 w-2 h-2 bg-primary rounded-full border-2 border-[#020205]" />
              </div>
              <Settings className="w-4 h-4 text-white/40 hover:text-white transition-colors cursor-pointer" />
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-[11px] font-black uppercase tracking-tight leading-none">Command Center</div>
                <div className="text-[8px] text-white/30 uppercase tracking-[0.2em] mt-1 font-black">Super Admin</div>
              </div>
              <div className="w-10 h-10 rounded-2xl bg-primary/20 border border-primary/20 flex items-center justify-center p-0.5">
                <img src="https://images.unsplash.com/photo-1599566150163-29194dcaad36?q=80&w=100&auto=format&fit=crop" className="w-full h-full object-cover rounded-xl grayscale" />
              </div>
            </div>
          </div>
        </header>

        {/* Mobile Header */}
        <header className="lg:hidden flex items-center justify-between p-6 bg-black/40 border-b border-white/5 sticky top-0 z-30 backdrop-blur-xl">
          <Button variant="ghost" size="icon" onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="hover:bg-white/5">
            <Menu className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            <span className="font-black text-sm tracking-tighter">PROTEGO</span>
          </div>
          <div className="w-10 h-10 rounded-xl overflow-hidden bg-primary/20 border border-primary/20">
            <img src="https://images.unsplash.com/photo-1599566150163-29194dcaad36?q=80&w=100&auto=format&fit=crop" className="w-full h-full object-cover grayscale" />
          </div>
        </header>

        {/* Global Page Background Gradient */}
        <div className="absolute top-0 left-0 w-full h-[500px] bg-gradient-to-b from-primary/[0.03] to-transparent pointer-events-none -z-10" />

        <div className="p-8 md:p-12 max-w-[1600px] mx-auto w-full">
          {children}
        </div>
      </main>
    </div>
  );
}

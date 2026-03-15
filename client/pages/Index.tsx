import { motion, useScroll, useTransform } from "framer-motion";
import { 
  Shield, 
  ChevronRight, 
  Activity, 
  MapPin, 
  Bell, 
  ArrowRight, 
  Check, 
  Plus, 
  Minus,
  MessageSquare,
  Zap,
  Phone,
  LayoutDashboard,
  Cpu,
  Eye,
  Radar,
  Video,
  AlertTriangle,
  Siren,
  Hospital,
  Smartphone,
  CheckCircle2,
  Instagram,
  Twitter,
  Facebook,
  Globe,
  History,
  BarChart3,
  Settings
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell
} from "recharts";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useRef } from "react";
import { cn } from "@/lib/utils";

const incidentData = [
  { name: "Accident", count: 45 },
  { name: "Medical", count: 32 },
  { name: "Distress", count: 68 },
  { name: "Stampede", count: 12 },
  { name: "Loitering", count: 25 },
  { name: "Dumping", count: 18 },
  { name: "Reckless", count: 22 },
  { name: "Fire", count: 15 },
];

export default function Index() {
  return (
    <div className="min-h-screen bg-[#020205] text-white selection:bg-primary/30 overflow-x-hidden">
      {/* Refined Noise/Grain Overlay */}
      <div className="fixed inset-0 pointer-events-none z-50 opacity-[0.03] bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />
      
      {/* Background Radial Glows */}
      <div className="fixed top-[-20%] left-[-10%] w-[60%] h-[60%] bg-primary/10 rounded-full blur-[160px] -z-10 animate-pulse" />
      <div className="fixed bottom-[-10%] right-[-5%] w-[50%] h-[50%] bg-orange-500/5 rounded-full blur-[140px] -z-10" />

      {/* Section 1: Hero */}
      <Navbar />
      <Hero />

      {/* Section 2: Simple Steps (Visual First) */}
      <DashboardPagesShowcase />

      {/* Section 3: Simple Steps (Visual First) */}
      <SimpleVisualProcess />

      {/* Section 4: Feature Highlight (How it works) */}
      <FeatureSteps />

      {/* Section 5: Control Feature with Chart */}
      <ControlFeature />

      {/* Section 6: Multi-City Feature */}
      <MultiCityFeature />

      {/* Section 7: Pricing Plans */}
      <PricingPlans />

      {/* Section 8: Testimonial */}
      <Testimonial />

      {/* Section 9: FAQ */}
      <FAQ />

      {/* Section 10: Final CTA */}
      <FinalCTA />

      {/* Section 11: Footer */}
      <Footer />
    </div>
  );
}

function DashboardPagesShowcase() {
  const pageCards = [
    {
      title: "Live Monitor",
      description: "Track active streams, overlays, and live incident detections in real time.",
      path: "/dashboard/live",
      icon: Eye,
      tag: "Realtime",
      accent: "text-green-400",
    },
    {
      title: "Detection Status",
      description: "Inspect health and activation state of every detection model across nodes.",
      path: "/dashboard/status",
      icon: AlertTriangle,
      tag: "Models",
      accent: "text-orange-400",
    },
    {
      title: "Incident History",
      description: "Search, filter, and review archived incidents with timestamps and context.",
      path: "/dashboard/history",
      icon: History,
      tag: "Archive",
      accent: "text-blue-400",
    },
    {
      title: "Analytics",
      description: "Explore trend lines, severity distribution, and dispatch performance insights.",
      path: "/dashboard/analytics",
      icon: BarChart3,
      tag: "Insights",
      accent: "text-primary",
    },
    {
      title: "Settings",
      description: "Configure camera sources, emergency contacts, and alert preferences instantly.",
      path: "/dashboard/settings",
      icon: Settings,
      tag: "Control",
      accent: "text-violet-400",
    },
  ];

  return (
    <section id="features" className="py-24 px-8">
      <div className="max-w-[1300px] mx-auto">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-12">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.03] border border-white/[0.06] mb-4">
              <LayoutDashboard className="w-3.5 h-3.5 text-primary" />
              <span className="text-[9px] font-black uppercase tracking-[0.3em] text-white/60">Dashboard Pages</span>
            </div>
            <h2 className="text-3xl md:text-5xl font-black tracking-tighter uppercase">Choose Where You Want To Go</h2>
            <p className="text-white/40 mt-3 max-w-2xl text-sm md:text-base">
              Every operational module is available as a direct entry point, designed with the same Protego interface language.
            </p>
          </div>
          <Link to="/dashboard/live">
            <Button className="bg-white text-black hover:bg-white/90 h-12 px-7 text-[10px] font-black uppercase tracking-[0.2em] rounded-xl">
              Open Command Dashboard
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {pageCards.map((card, idx) => (
            <Link key={card.path} to={card.path} className="group">
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.45, delay: idx * 0.05 }}
                className="premium-glass bg-white/[0.02] border-white/[0.06] p-6 min-h-[220px] flex flex-col justify-between transition-all duration-300 group-hover:bg-white/[0.05] group-hover:-translate-y-1"
              >
                <div className="flex items-start justify-between">
                  <div className={cn("w-11 h-11 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center", card.accent)}>
                    <card.icon className="w-5 h-5" />
                  </div>
                  <span className="text-[9px] font-black uppercase tracking-[0.25em] text-white/35">{card.tag}</span>
                </div>

                <div>
                  <h3 className="text-xl font-black uppercase tracking-tight mb-2">{card.title}</h3>
                  <p className="text-white/45 text-sm leading-relaxed">{card.description}</p>
                </div>

                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/50 group-hover:text-primary transition-colors mt-5">
                  Open Page
                  <ArrowRight className="w-3.5 h-3.5" />
                </div>
              </motion.div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function Navbar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-[60] flex items-center justify-between px-8 py-5 backdrop-blur-2xl bg-black/10 border-b border-white/[0.04]">
      <div className="flex items-center gap-3 group cursor-pointer">
        <div className="p-2 bg-primary/20 rounded-xl red-glow-soft border border-primary/20 transition-all group-hover:scale-110">
          <Shield className="w-6 h-6 text-primary fill-primary/10" />
        </div>
        <div className="flex flex-col">
          <span className="text-xl font-black tracking-tighter leading-none">PROTEGO</span>
          <span className="text-[8px] font-bold text-primary tracking-[0.3em] mt-0.5 uppercase">SAFETY SYSTEMS</span>
        </div>
      </div>
      
      <div className="hidden lg:flex items-center gap-10 text-[11px] font-bold uppercase tracking-[0.15em] text-white/40">
        <a href="#features" className="hover:text-white transition-colors">Features</a>
        <a href="#how-it-works" className="hover:text-white transition-colors">How it works</a>
        <a href="#impact" className="hover:text-white transition-colors">Cities</a>
        <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
      </div>

      <div className="flex items-center gap-5">
        <Button variant="ghost" className="text-xs font-bold uppercase tracking-widest text-white/50 hover:text-white hover:bg-white/5 px-6">Login</Button>
        <Button className="bg-white text-black hover:bg-white/90 px-8 h-11 font-bold rounded-full text-xs uppercase tracking-widest shadow-xl shadow-white/5">
          Get Started
        </Button>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <section className="relative pt-48 pb-32 px-8">
      <div className="max-w-[1400px] mx-auto flex flex-col items-center">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/[0.03] border border-white/[0.08] mb-8 animate-fade-in">
          <div className="w-1.5 h-1.5 rounded-full bg-primary red-glow-soft animate-pulse" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/60">Live across 12 Indian Cities</span>
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="text-center"
        >
          <h1 className="text-5xl md:text-8xl font-black leading-[0.9] tracking-tighter mb-10 max-w-[1200px] mx-auto">
            INDIA'S CAMERAS <br />
            <span className="text-brand-gradient">CAN FINALLY CALL FOR HELP.</span>
          </h1>
          
          <p className="text-lg md:text-2xl text-white/40 max-w-2xl mx-auto mb-14 font-medium leading-relaxed">
            There are 10 million cameras in India. None of them can call for help. 
            Until now. Protego watches your existing cameras and alerts help automatically.
          </p>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.8 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-6 mb-24"
        >
          <Link to="/dashboard/live">
            <Button size="lg" className="bg-primary hover:bg-primary/90 text-white px-10 h-16 text-xs uppercase tracking-[0.2em] font-black rounded-2xl shadow-2xl shadow-primary/20">
              See It in Action
            </Button>
          </Link>
          <Button size="lg" variant="outline" className="border-white/10 bg-white/[0.03] hover:bg-white/[0.08] px-10 h-16 text-xs uppercase tracking-[0.2em] font-black rounded-2xl backdrop-blur-md">
            Learn How It Works
          </Button>
        </motion.div>

        {/* High-Fidelity Mockups */}
        <div className="relative w-full max-w-[1300px] mx-auto">
          <motion.div 
            initial={{ opacity: 0, y: 60 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 1, ease: [0.16, 1, 0.3, 1] }}
            className="premium-glass p-1.5 md:p-3 aspect-[16/9] relative z-10 group"
          >
            <div className="w-full h-full bg-[#050508] rounded-xl overflow-hidden relative shadow-inner-glow">
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent z-10" />
              
              {/* Simulated UI Overlay */}
              <div className="absolute inset-0 z-20 p-6 flex flex-col justify-between">
                <div className="flex justify-between items-start">
                  <div className="flex gap-4">
                    <div className="p-3 bg-black/60 backdrop-blur-xl rounded-xl border border-white/5">
                      <div className="text-[10px] text-white/40 uppercase tracking-widest font-bold mb-1">FPS</div>
                      <div className="text-lg font-black text-green-400">59.8</div>
                    </div>
                    <div className="p-3 bg-black/60 backdrop-blur-xl rounded-xl border border-white/5">
                      <div className="text-[10px] text-white/40 uppercase tracking-widest font-bold mb-1">Latency</div>
                      <div className="text-lg font-black text-white">42ms</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 px-4 py-2 bg-primary/20 backdrop-blur-xl rounded-full border border-primary/20">
                     <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                     <span className="text-[10px] font-black uppercase tracking-widest">AI Detection Active</span>
                  </div>
                </div>

                <div className="flex justify-between items-end">
                  <div className="max-w-xs space-y-4">
                    <div className="p-4 bg-black/60 backdrop-blur-2xl rounded-2xl border border-white/5 border-l-4 border-l-primary flex items-center gap-4">
                      <div className="p-2 bg-primary/20 rounded-lg">
                        <AlertTriangle className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <div className="text-[10px] text-primary uppercase tracking-[0.2em] font-black mb-1">Emergency Detected</div>
                        <div className="text-sm font-bold">Accident • Gachibowli Jct</div>
                      </div>
                    </div>
                  </div>
                  <div className="text-[10px] font-mono text-white/20 uppercase tracking-[0.3em]">HYD_NODE_004</div>
                </div>
              </div>

              {/* Bounding Boxes Simulation */}
              <div className="absolute inset-0 z-15 pointer-events-none overflow-hidden">
                {/* Person Fallen */}
                <motion.div 
                   animate={{ scale: [1, 1.05, 1], opacity: [0.6, 0.9, 0.6] }}
                   transition={{ duration: 3, repeat: Infinity }}
                   className="absolute top-[35%] left-[30%] w-[12%] h-[18%] border-2 border-primary red-glow-soft rounded-[4px] bg-primary/5"
                >
                  <div className="absolute -top-7 left-0 bg-primary px-2 py-0.5 text-[8px] font-black text-white rounded">PERSON FALLEN • 98%</div>
                </motion.div>
                
                {/* Vehicle Collision */}
                <div className="absolute bottom-[25%] right-[25%] w-[18%] h-[28%] border-2 border-orange-500 orange-glow-soft rounded-[4px] bg-orange-500/5">
                  <div className="absolute -top-7 left-0 bg-orange-500 px-2 py-0.5 text-[8px] font-black text-white rounded">VEHICLE IMPACT • 92%</div>
                </div>

                {/* Scanning Animation */}
                <motion.div 
                  animate={{ top: ["0%", "100%", "0%"] }}
                  transition={{ duration: 5, repeat: Infinity, ease: "linear" }}
                  className="absolute left-0 right-0 h-px bg-primary/30 shadow-[0_0_20px_rgba(230,57,70,0.5)]"
                />
              </div>

              <img 
                src="https://images.unsplash.com/photo-1545147986-a9d6f210df77?q=80&w=2000&auto=format&fit=crop" 
                alt="Live Camera Feed" 
                className="w-full h-full object-cover opacity-30 grayscale" 
              />
            </div>
          </motion.div>

          {/* Floating Phone Visual */}
          <motion.div 
            initial={{ opacity: 0, x: 50, rotate: 5 }}
            animate={{ opacity: 1, x: 0, rotate: 0 }}
            transition={{ delay: 0.7, duration: 1.2 }}
            className="absolute -right-8 -bottom-16 w-56 md:w-72 premium-glass p-2.5 z-30 hidden sm:block shadow-2xl"
          >
            <div className="aspect-[9/19.5] bg-black rounded-[2.5rem] overflow-hidden relative border-[6px] border-[#1a1a1f] inner-glow">
              <div className="absolute top-0 inset-x-0 h-8 bg-black z-40 flex items-center justify-center">
                 <div className="w-16 h-4 bg-[#1a1a1f] rounded-full" />
              </div>
              <div className="p-5 pt-14 space-y-4">
                 <div className="bg-white/[0.08] backdrop-blur-2xl p-4 rounded-3xl border border-white/10 space-y-3">
                   <div className="flex items-center justify-between">
                     <div className="flex items-center gap-2">
                       <div className="w-6 h-6 bg-blue-500 rounded-lg flex items-center justify-center text-[10px] font-bold">T</div>
                       <span className="text-[10px] font-bold text-white/60">Telegram</span>
                     </div>
                     <span className="text-[8px] text-white/30 uppercase tracking-widest font-bold">Now</span>
                   </div>
                   <div className="space-y-1">
                     <div className="text-[10px] font-black text-primary uppercase tracking-widest">Urgent Alert</div>
                     <div className="text-[11px] font-bold leading-tight">Accident detected at Gachibowli Jct. Help is being sent.</div>
                   </div>
                   <div className="aspect-video bg-black/40 rounded-xl overflow-hidden border border-white/5">
                      <img src="https://images.unsplash.com/photo-1545147986-a9d6f210df77?q=80&w=400&auto=format&fit=crop" className="w-full h-full object-cover grayscale opacity-60" />
                   </div>
                   <div className="flex gap-2">
                     <div className="flex-1 h-6 bg-primary/20 rounded-md border border-primary/20 flex items-center justify-center text-[8px] font-bold uppercase tracking-widest">Dispatching</div>
                     <div className="flex-1 h-6 bg-white/5 rounded-md border border-white/5 flex items-center justify-center text-[8px] font-bold uppercase tracking-widest">View Feed</div>
                   </div>
                 </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function SimpleVisualProcess() {
  const items = [
    {
      title: "1. Connect any camera",
      desc: "Webcams, IP cams, or even YouTube streams. No new hardware needed.",
      icon: Video,
      color: "bg-blue-500/20 text-blue-400"
    },
    {
      title: "2. AI watches live",
      desc: "Our AI identifies accidents, fire, and medical emergencies instantly.",
      icon: Cpu,
      color: "bg-primary/20 text-primary"
    },
    {
      title: "3. Help is sent",
      desc: "Police and hospitals are alerted automatically with live location data.",
      icon: Siren,
      color: "bg-orange-500/20 text-orange-400"
    }
  ];

  return (
    <section className="py-32 px-8">
      <div className="max-w-[1200px] mx-auto text-center mb-24">
         <h2 className="text-4xl md:text-6xl font-black tracking-tighter mb-6 uppercase">How it works</h2>
         <p className="text-white/40 text-lg font-medium">Simple, fast, and incredibly effective.</p>
      </div>
      
      <div className="max-w-[1200px] mx-auto grid md:grid-cols-3 gap-12">
        {items.map((item, idx) => (
          <div key={idx} className="flex flex-col items-center text-center group">
            <div className={cn("w-24 h-24 rounded-[2rem] flex items-center justify-center border border-white/5 mb-8 transition-all group-hover:scale-110 group-hover:rotate-3", item.color)}>
              <item.icon className="w-10 h-10" />
            </div>
            <h3 className="text-2xl font-black uppercase tracking-tight mb-4">{item.title}</h3>
            <p className="text-white/40 font-medium leading-relaxed">{item.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function FeatureSteps() {
  const steps = [
    {
      title: "Smart Detection",
      desc: "AI identifies accidents, medical emergencies, and more with high precision.",
      visual: (
        <div className="relative h-full w-full bg-black/40 rounded-2xl overflow-hidden border border-white/5 p-4 flex items-center justify-center">
          <div className="absolute inset-0 bg-primary/5 blur-3xl" />
          <div className="relative z-10 flex flex-col items-center gap-4">
             <div className="p-4 bg-primary/20 rounded-2xl border border-primary/20">
                <Radar className="w-12 h-12 text-primary animate-pulse" />
             </div>
             <div className="text-[10px] font-black uppercase tracking-[0.4em] text-primary">Neural Analysis Active</div>
          </div>
        </div>
      )
    },
    {
      title: "Auto-Dispatch",
      desc: "Integrated with 112 emergency services and local hospital networks.",
      visual: (
        <div className="relative h-full w-full bg-black/40 rounded-2xl overflow-hidden border border-white/5 p-6 space-y-4">
           {[
             { label: "Dispatching 112 Police", icon: Shield, color: "text-blue-400" },
             { label: "Alerting KIMS Hospital", icon: Hospital, color: "text-red-400" },
             { label: "WhatsApp Status Sent", icon: MessageSquare, color: "text-green-400" }
           ].map((alert, i) => (
             <div key={i} className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                <div className="flex items-center gap-3">
                   <alert.icon className={cn("w-4 h-4", alert.color)} />
                   <span className="text-[11px] font-bold uppercase tracking-tight">{alert.label}</span>
                </div>
                <CheckCircle2 className="w-4 h-4 text-green-500" />
             </div>
           ))}
        </div>
      )
    }
  ];

  return (
    <section id="how-it-works" className="py-40 px-8">
      <div className="max-w-[1400px] mx-auto grid lg:grid-cols-2 gap-12">
        {steps.map((step, idx) => (
          <div key={idx} className="premium-glass p-12 flex flex-col min-h-[500px]">
            <div className="flex-1 mb-12">
               {step.visual}
            </div>
            <div>
              <h3 className="text-3xl font-black mb-4 uppercase tracking-tight">{step.title}</h3>
              <p className="text-white/40 text-lg leading-relaxed font-medium">{step.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ControlFeature() {
  return (
    <section className="py-40 px-8 relative overflow-hidden">
      <div className="max-w-[1400px] mx-auto grid lg:grid-cols-2 gap-32 items-center">
        <div className="relative z-10">
          <h2 className="text-5xl md:text-7xl font-black tracking-tighter mb-10 leading-[0.9] uppercase">
            Reacting in seconds, <br />
            <span className="text-brand-gradient">Not minutes.</span>
          </h2>
          <p className="text-xl text-white/40 mb-14 leading-relaxed font-medium">
            While human eyes can miss things, AI never blinks. Protego identifies threats 
            and alerts help before humans can even pick up the phone.
          </p>
          
          <div className="grid grid-cols-3 gap-12 mb-16">
            <div>
              <div className="text-4xl font-black mb-2">99.2%</div>
              <div className="text-[10px] text-white/30 uppercase tracking-[0.2em] font-bold">Accuracy</div>
            </div>
            <div>
              <div className="text-4xl font-black mb-2">200ms</div>
              <div className="text-[10px] text-white/30 uppercase tracking-[0.2em] font-bold">Detection</div>
            </div>
            <div>
              <div className="text-4xl font-black mb-2">8</div>
              <div className="text-[10px] text-white/30 uppercase tracking-[0.2em] font-bold">AI Models</div>
            </div>
          </div>

          <Button size="lg" className="bg-primary hover:bg-primary/90 text-white px-10 h-16 rounded-2xl font-black uppercase tracking-widest text-xs group">
            Get Command Access
            <ArrowRight className="ml-3 w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </Button>
        </div>

        <div className="premium-glass p-8 h-[500px] relative">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent -z-10" />
          <div className="flex justify-between items-center mb-10">
            <div>
               <h4 className="text-sm font-black uppercase tracking-[0.3em]">Detection Matrix</h4>
               <p className="text-[10px] text-white/30 mt-1 font-bold uppercase tracking-widest">Real-time stats</p>
            </div>
          </div>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={incidentData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                <XAxis 
                  dataKey="name" 
                  stroke="#ffffff10" 
                  fontSize={10} 
                  tickLine={false} 
                  axisLine={false} 
                  fontFamily="Plus Jakarta Sans"
                  fontWeight={700}
                />
                <YAxis 
                  stroke="#ffffff10" 
                  fontSize={10} 
                  tickLine={false} 
                  axisLine={false} 
                  fontFamily="Plus Jakarta Sans"
                  fontWeight={700}
                />
                <Tooltip 
                  cursor={{ fill: 'rgba(255,255,255,0.02)' }}
                  contentStyle={{ 
                    backgroundColor: '#050508', 
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '16px',
                    fontSize: '11px',
                    fontFamily: 'Plus Jakarta Sans',
                    fontWeight: 700,
                  }}
                />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {incidentData.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={entry.name === "Distress" ? "#e63946" : "#ffffff10"} 
                      className="transition-all hover:opacity-100 opacity-60"
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </section>
  );
}

function MultiCityFeature() {
  const cities = [
    { name: "Hyderabad", cameras: 1240, incidents: 8, status: "Active", active: true },
    { name: "Mumbai", cameras: 3820, incidents: 14, status: "Active" },
    { name: "Delhi", cameras: 4100, incidents: 22, status: "Active" },
    { name: "Bengaluru", cameras: 2150, incidents: 5, status: "Active" },
  ];

  return (
    <section id="impact" className="py-40 px-8 max-w-[1400px] mx-auto">
      <div className="grid lg:grid-cols-2 gap-32 items-center">
        <div className="relative order-2 lg:order-1">
          <div className="flex flex-col gap-6">
            {cities.map((city, idx) => (
              <motion.div 
                key={city.name}
                initial={{ opacity: 0, x: -30 }}
                whileInView={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.1, duration: 0.8 }}
                className={cn(
                  "premium-glass p-6 flex items-center justify-between group transition-all duration-500",
                  city.active ? "ring-2 ring-primary/40 red-glow-soft bg-primary/[0.04]" : "hover:bg-white/[0.04]"
                )}
              >
                <div className="flex items-center gap-6">
                  <div className={cn(
                    "w-14 h-14 rounded-2xl flex items-center justify-center border transition-all",
                    city.active ? "bg-primary/20 border-primary/20 scale-110" : "bg-white/5 border-white/5"
                  )}>
                    <MapPin className={cn("w-6 h-6", city.active ? "text-primary" : "text-white/20")} />
                  </div>
                  <div>
                    <h4 className="text-xl font-black uppercase tracking-tight">{city.name}</h4>
                    <p className="text-[10px] text-white/30 uppercase tracking-[0.3em] font-black mt-1">{city.cameras} SENSORS</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className={cn("text-lg font-black tracking-tight", city.active ? "text-primary" : "text-white/40")}>
                    {city.incidents} ALERTS
                  </div>
                  <div className="text-[9px] text-white/20 uppercase tracking-[0.2em] font-black mt-1">OPERATIONAL</div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="order-1 lg:order-2">
          <h2 className="text-5xl md:text-7xl font-black tracking-tighter mb-10 leading-[0.9] uppercase">
            Active in every <br />
            <span className="text-white/20">Indian Street.</span>
          </h2>
          <div className="space-y-10 mb-14">
            {[
              { title: "No Hardware Needed", desc: "Use your existing cameras. We plug in via software." },
              { title: "Built for India", desc: "Our AI understands Indian road signs, traffic, and emergency patterns." },
              { title: "Completely Secure", desc: "Your video data is processed locally and securely. Privacy is our priority." }
            ].map((point, i) => (
              <div key={i} className="flex gap-6 group">
                <div className="mt-1.5 w-2 h-2 rounded-full bg-primary flex-shrink-0 transition-transform group-hover:scale-150" />
                <div className="space-y-2">
                  <h4 className="text-lg font-black uppercase tracking-tight">{point.title}</h4>
                  <p className="text-white/40 font-medium leading-relaxed">{point.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <Button size="lg" className="bg-white text-black hover:bg-white/90 px-10 h-16 rounded-2xl font-black uppercase tracking-widest text-xs">
            Deploy in Your Ward
          </Button>
        </div>
      </div>
    </section>
  );
}

function PricingPlans() {
  return (
    <section id="pricing" className="py-40 px-8 bg-[#030308]">
      <div className="max-w-[1400px] mx-auto text-center mb-24">
         <h2 className="text-4xl md:text-7xl font-black tracking-tighter leading-[0.9] uppercase">Plans for every scale</h2>
      </div>

      <div className="max-w-[1200px] mx-auto grid md:grid-cols-2 gap-12">
        {/* City Starter */}
        <div className="premium-glass p-12 flex flex-col group relative">
          <div className="mb-10">
            <h3 className="text-2xl font-black uppercase tracking-tight mb-2">Ward Level</h3>
            <p className="text-white/40 font-medium text-lg italic">For local area safety.</p>
          </div>
          <div className="flex items-baseline gap-2 mb-12">
            <span className="text-5xl font-black tracking-tighter">₹24,999</span>
            <span className="text-white/20 text-xs font-black uppercase tracking-widest">/ Month</span>
          </div>
          <ul className="space-y-6 mb-16 flex-1">
            {[
              "Up to 10 cameras",
              "All 8 AI detection models",
              "Instant Telegram alerts",
              "Email & SMS support",
              "Monthly reports"
            ].map((feat, i) => (
              <li key={i} className="flex items-center gap-4 text-white/50 font-bold">
                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                <span className="text-sm uppercase tracking-wide">{feat}</span>
              </li>
            ))}
          </ul>
          <Button variant="outline" className="w-full h-16 border-white/10 bg-white/[0.03] hover:bg-white/[0.08] text-xs font-black uppercase tracking-[0.2em] rounded-2xl">
            Choose Plan
          </Button>
        </div>

        {/* Smart City Pro */}
        <div className="premium-glass p-12 flex flex-col relative ring-2 ring-primary/40 red-glow-soft bg-primary/[0.02]">
          <div className="absolute top-0 right-12 -translate-y-1/2 bg-primary px-6 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.3em]">Smart City Grade</div>
          <div className="mb-10">
            <h3 className="text-2xl font-black uppercase tracking-tight mb-2 text-primary">City Level</h3>
            <p className="text-white/40 font-medium text-lg italic">The ultimate safety net.</p>
          </div>
          <div className="flex items-baseline gap-2 mb-12">
            <span className="text-5xl font-black tracking-tighter">₹99,999</span>
            <span className="text-white/20 text-xs font-black uppercase tracking-widest">/ Month</span>
          </div>
          <ul className="space-y-6 mb-16 flex-1">
            {[
              "Unlimited cameras",
              "Full AI intelligence suite",
              "Direct 112 ERSS integration",
              "Hospital network priority",
              "24/7 dedicated support",
              "Custom authority contacts"
            ].map((feat, i) => (
              <li key={i} className="flex items-center gap-4 text-white/90 font-bold">
                <Check className="w-4 h-4 text-primary" strokeWidth={4} />
                <span className="text-sm uppercase tracking-wide">{feat}</span>
              </li>
            ))}
          </ul>
          <Button className="w-full h-16 bg-white text-black hover:bg-white/90 text-xs font-black uppercase tracking-[0.2em] rounded-2xl">
            Launch City Node
          </Button>
        </div>
      </div>
    </section>
  );
}

function Testimonial() {
  return (
    <section className="py-40 px-8 relative overflow-hidden">
      <div className="max-w-[1400px] mx-auto grid lg:grid-cols-2 gap-32 items-center">
        <div className="relative group">
          <div className="premium-glass p-2">
            <img 
              src="https://images.unsplash.com/photo-1599566150163-29194dcaad36?q=80&w=1000&auto=format&fit=crop" 
              alt="Security Director" 
              className="w-full h-[600px] object-cover rounded-xl grayscale brightness-[0.7] group-hover:brightness-100 transition-all duration-1000"
            />
          </div>
        </div>

        <div className="relative">
          <blockquote className="text-3xl md:text-5xl font-black leading-[1.1] tracking-tighter mb-12 italic uppercase">
            "Protego saved lives during a crowd surge. It alerted us 90 seconds before things got dangerous. It's a game changer."
          </blockquote>
          <div className="flex items-center gap-6">
             <div className="w-16 h-16 rounded-2xl overflow-hidden border-2 border-primary/20 p-1">
                <img src="https://images.unsplash.com/photo-1599566150163-29194dcaad36?q=80&w=100&auto=format&fit=crop" className="w-full h-full object-cover rounded-xl" />
             </div>
             <div>
               <div className="text-xl font-black uppercase tracking-tight leading-none mb-1">Rajan Mehta</div>
               <div className="text-[10px] text-white/30 uppercase tracking-[0.3em] font-black">Smart City Safety Director, HYD</div>
             </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FAQ() {
  const faqs = [
    { q: "What is Protego?", a: "Protego is software that uses your existing CCTV cameras to detect emergencies like accidents, fires, and medical crises automatically." },
    { q: "Do I need new cameras?", a: "No. Protego works with any IP camera, webcam, or stream you already have." },
    { q: "How is help alerted?", a: "Our AI immediately notifies the 112 emergency services and local hospitals with the exact location and a screenshot of the incident." },
    { q: "Is my privacy protected?", a: "Yes. Data is processed securely and locally. We prioritize security and data privacy above all else." },
  ];

  return (
    <section className="py-40 px-8 max-w-4xl mx-auto">
      <div className="text-center mb-24">
        <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase">Questions?</h2>
      </div>

      <Accordion type="single" collapsible className="w-full space-y-4">
        {faqs.map((faq, i) => (
          <AccordionItem key={i} value={`item-${i}`} className="border-none premium-glass px-8 py-2">
            <AccordionTrigger className="text-left font-black uppercase tracking-tight text-lg hover:no-underline hover:text-primary transition-colors py-6">
              {faq.q}
            </AccordionTrigger>
            <AccordionContent className="text-white/40 leading-relaxed font-medium text-lg pb-6 pt-2">
              {faq.a}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="py-60 px-8 relative overflow-hidden">
      <div className="max-w-6xl mx-auto text-center relative z-10">
        <h2 className="text-6xl md:text-[9rem] font-black tracking-tighter leading-[0.8] mb-16 uppercase">
          GIVE YOUR CAMERAS <br />
          <span className="text-brand-gradient">A VOICE.</span>
        </h2>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-8">
          <Button size="lg" className="bg-primary hover:bg-primary/90 text-white px-12 h-20 text-xs font-black uppercase tracking-[0.3em] rounded-[2rem] shadow-2xl shadow-primary/20">
            Get Access Now
          </Button>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="relative py-24 px-8 border-t border-white/[0.04] bg-black/40 overflow-hidden">
      {/* Massive Background Text Watermark (Matching reference) */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none -z-10 select-none overflow-hidden">
        <span className="text-[25vw] font-black text-white/[0.03] tracking-tighter translate-y-[20%] uppercase">
          PROTEGO
        </span>
      </div>

      <div className="max-w-[1400px] mx-auto relative z-10">
        <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-16 mb-24">
          {/* Logo and Description Column */}
          <div className="lg:col-span-2 space-y-8">
            <div className="flex items-center gap-3 group cursor-pointer">
              <div className="p-2 bg-primary/20 rounded-xl border border-primary/20 transition-all group-hover:bg-primary/30">
                <Shield className="w-6 h-6 text-primary fill-primary/10" />
              </div>
              <div className="flex flex-col">
                <span className="text-xl font-black tracking-tighter leading-none">PROTEGO</span>
                <span className="text-[8px] font-bold text-primary tracking-[0.3em] mt-0.5 uppercase">SAFETY SYSTEMS</span>
              </div>
            </div>
            <p className="text-sm text-white/40 leading-relaxed font-medium max-w-xs">
              Giving India's cameras a conscience. Next-generation intelligence for public safety surveillance.
            </p>
            {/* Social Icons (Matching reference layout) */}
            <div className="flex gap-6 items-center pt-4">
              <Facebook className="w-4 h-4 text-white/30 hover:text-white transition-colors cursor-pointer" />
              <Instagram className="w-4 h-4 text-white/30 hover:text-white transition-colors cursor-pointer" />
              <Globe className="w-4 h-4 text-white/30 hover:text-white transition-colors cursor-pointer" />
              <Twitter className="w-4 h-4 text-white/30 hover:text-white transition-colors cursor-pointer" />
            </div>
          </div>
          
          {/* Links Columns (Matching reference layout) */}
          <div className="space-y-8">
            <h4 className="text-[10px] font-black uppercase tracking-[0.4em] text-white/60">Platform</h4>
            <ul className="space-y-4 text-sm font-bold text-white/30 uppercase tracking-widest">
              <li><a href="#" className="hover:text-primary transition-colors">About Us</a></li>
              <li><a href="#" className="hover:text-primary transition-colors">Contact</a></li>
              <li><a href="#" className="hover:text-primary transition-colors">How It Works</a></li>
              <li><a href="#" className="hover:text-primary transition-colors">Blog</a></li>
            </ul>
          </div>

          <div className="space-y-8">
            <h4 className="text-[10px] font-black uppercase tracking-[0.4em] text-white/60">Resources</h4>
            <ul className="space-y-4 text-sm font-bold text-white/30 uppercase tracking-widest">
              <li><a href="#" className="hover:text-primary transition-colors">Help Center</a></li>
              <li><a href="#" className="hover:text-primary transition-colors">Documentation</a></li>
              <li><a href="#" className="hover:text-primary transition-colors">API Access</a></li>
              <li><a href="#" className="hover:text-primary transition-colors">Community</a></li>
            </ul>
          </div>

          <div className="space-y-8">
            <h4 className="text-[10px] font-black uppercase tracking-[0.4em] text-white/60">Company</h4>
            <ul className="space-y-4 text-sm font-bold text-white/30 uppercase tracking-widest">
              <li><a href="#" className="hover:text-primary transition-colors">Terms</a></li>
              <li><a href="#" className="hover:text-primary transition-colors">Privacy Policy</a></li>
              <li><a href="#" className="hover:text-primary transition-colors">Trust Center</a></li>
            </ul>
          </div>
        </div>
        
        {/* Bottom Bar */}
        <div className="pt-12 border-t border-white/[0.04] text-center">
          <span className="text-[9px] font-black text-white/10 uppercase tracking-[0.4em]">
            © {new Date().getFullYear()} PROTEGO SYSTEMS. ALL RIGHTS RESERVED.
          </span>
        </div>
      </div>
    </footer>
  );
}

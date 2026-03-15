import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { ShieldAlert, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname,
    );
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0f] text-white p-6">
      <div className="max-w-md w-full text-center space-y-8 relative">
        <div className="absolute inset-0 bg-primary/10 blur-[100px] -z-10 rounded-full" />
        
        <div className="inline-flex p-4 bg-primary/20 rounded-2xl border border-primary/40 red-glow mb-4">
           <ShieldAlert className="w-12 h-12 text-primary" />
        </div>
        
        <div className="space-y-4">
          <h1 className="text-6xl font-black tracking-tighter">404</h1>
          <h2 className="text-2xl font-bold">Unauthorized Access Detected</h2>
          <p className="text-white/40 leading-relaxed">
            The route <code className="text-primary font-mono">{location.pathname}</code> does not exist on the Protego security layer. 
            Redirecting to secure protocols is recommended.
          </p>
        </div>

        <div className="pt-8">
           <Link to="/">
             <Button size="lg" className="bg-primary hover:bg-primary/90 text-white gap-2 px-8 h-12 font-bold group">
                <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
                Return to Command Center
             </Button>
           </Link>
        </div>

        <div className="pt-12 text-[10px] uppercase tracking-[0.2em] text-white/20 font-bold">
           Protego Public Safety Systems • Secure Node
        </div>
      </div>
    </div>
  );
};

export default NotFound;

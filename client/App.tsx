import "./global.css";

import { Toaster } from "@/components/ui/toaster";
import { createRoot } from "react-dom/client";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import DashboardLayout from "./components/DashboardLayout";
import LiveMonitor from "./pages/dashboard/LiveMonitor";
import IncidentHistory from "./pages/dashboard/IncidentHistory";
import Analytics from "./pages/dashboard/Analytics";
import DetectionStatus from "./pages/dashboard/DetectionStatus";
import Settings from "./pages/dashboard/Settings";
import VideoAnalyzer from "./pages/VideoAnalyzer";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/" element={<Index />} />

          {/* Dashboard Routes wrapped in Layout */}
          <Route path="/dashboard" element={<Navigate to="/dashboard/live" replace />} />
          <Route path="/dashboard/live" element={<DashboardLayout children={<LiveMonitor />} />} />
          <Route path="/dashboard/status" element={<DashboardLayout children={<DetectionStatus />} />} />
          <Route path="/dashboard/history" element={<DashboardLayout children={<IncidentHistory />} />} />
          <Route path="/dashboard/analytics" element={<DashboardLayout children={<Analytics />} />} />
          <Route path="/dashboard/settings" element={<DashboardLayout children={<Settings />} />} />

          {/* Video Analyzer Route */}
          <Route path="/video-analyzer" element={<DashboardLayout children={<VideoAnalyzer />} />} />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

createRoot(document.getElementById("root")!).render(<App />);

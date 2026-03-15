import { useState, useEffect } from "react";
import { subDays, format } from "date-fns";
import {
    BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart, Legend
} from "recharts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingUp, TrendingDown, Activity, AlertTriangle, MapPin, ShieldAlert, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const COLORS = ['#e63946', '#f4a261', '#2a9d8f', '#457b9d', '#1d3557', '#e9c46a', '#8338ec', '#ff006e'];
const SEVERITY_COLORS = ['#e63946', '#f4a261', '#2a9d8f']; // High, Medium, Low
const DAYS_OF_WEEK = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export default function Analytics() {
    const [dateRange, setDateRange] = useState("30");
    const [isLoading, setIsLoading] = useState(true);

    const [data, setData] = useState<any>({
        summary: null,
        byType: [],
        overTime: [],
        severity: null,
        peakHours: [],
        byLocation: [],
        delivery: null,
        authorities: []
    });

    const fetchAnalytics = async () => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams();
            if (dateRange !== "all") {
                const fromDate = subDays(new Date(), parseInt(dateRange));
                params.append("date_from", fromDate.toISOString());
            }

            const qs = params.toString() ? `?${params.toString()}` : "";

            const unwrap = async (url: string) => {
                try {
                    const res = await fetch(url);
                    if (!res.ok) return null;
                    const body = await res.json();
                    // Backend wraps in {success, data: {...}}
                    return body?.data ?? body ?? null;
                } catch { return null; }
            };

            const [summary, byType, overTime, severity, peakHours, byLocation, delivery, authorities] = await Promise.all([
                unwrap(`http://127.0.0.1:5000/api/analytics/summary${qs}`),
                unwrap(`http://127.0.0.1:5000/api/analytics/by-type${qs}`),
                unwrap(`http://127.0.0.1:5000/api/analytics/over-time${qs}`),
                unwrap(`http://127.0.0.1:5000/api/analytics/severity${qs}`),
                unwrap(`http://127.0.0.1:5000/api/analytics/peak-hours${qs}`),
                unwrap(`http://127.0.0.1:5000/api/analytics/by-location${qs}`),
                unwrap(`http://127.0.0.1:5000/api/analytics/delivery${qs}`),
                unwrap(`http://127.0.0.1:5000/api/analytics/authorities${qs}`),
            ]);

            setData({
                summary: summary ?? null,
                byType: Array.isArray(byType) ? byType : [],
                overTime: Array.isArray(overTime) ? overTime : [],
                severity: severity ?? null,
                peakHours: Array.isArray(peakHours) ? peakHours : [],
                byLocation: Array.isArray(byLocation) ? byLocation : [],
                delivery: delivery ?? null,
                authorities: Array.isArray(authorities) ? authorities : [],
            });
        } catch (err) {
            console.error("Failed to fetch analytics", err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchAnalytics();
    }, [dateRange]);

    const StatCard = ({ title, value, change, icon: Icon, isNegativeGood = false }: any) => {
        const isPositive = change >= 0;
        const isGood = isNegativeGood ? !isPositive : isPositive;
        return (
            <div className="bg-white/[0.02] border border-white/[0.05] p-6 rounded-3xl relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
                    <Icon className="w-16 h-16" />
                </div>
                <div className="flex flex-col gap-4 relative z-10">
                    <span className="text-[10px] font-black uppercase tracking-widest text-white/40">{title}</span>
                    <span className="text-4xl font-black tracking-tighter">{value}</span>
                    <div className="flex items-center gap-2">
                        <span className={cn(
                            "text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-widest flex items-center gap-1",
                            isGood ? "text-green-400 bg-green-500/10" : "text-red-400 bg-red-500/10"
                        )}>
                            {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                            {Math.abs(change)}%
                        </span>
                        <span className="text-[9px] text-white/20 uppercase font-black tracking-widest">vs previous period</span>
                    </div>
                </div>
            </div>
        );
    };

    const CircularProgress = ({ value, label, total, colorClass }: any) => {
        const radius = 36;
        const circumference = 2 * Math.PI * radius;
        const strokeDashoffset = circumference - (value / 100) * circumference;

        return (
            <div className="flex flex-col items-center gap-4">
                <div className="relative w-24 h-24 flex items-center justify-center drop-shadow-2xl">
                    <svg className="w-full h-full transform -rotate-90">
                        <circle cx="48" cy="48" r={radius} stroke="currentColor" strokeWidth="8" fill="transparent" className="text-white/5" />
                        <circle cx="48" cy="48" r={radius} stroke="currentColor" strokeWidth="8" fill="transparent"
                            strokeDasharray={circumference} strokeDashoffset={strokeDashoffset}
                            className={cn("transition-all duration-1000 ease-out", colorClass)} />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center flex-col">
                        <span className="text-xl font-black tracking-tighter">{value}%</span>
                    </div>
                </div>
                <div className="text-center">
                    <div className="text-[11px] font-black uppercase tracking-[0.2em] text-white/60 mb-1">{label}</div>
                    <div className="text-[9px] font-bold text-white/30 uppercase tracking-[0.2em]">{total} DISPATCHES</div>
                </div>
            </div>
        )
    };

    // Find max value in heatmap for scale calculation
    const getHeatmapMax = () => {
        let max = 0;
        data.peakHours.forEach((row: number[]) => {
            row.forEach((val: number) => {
                if (val > max) max = val;
            });
        });
        return max || 1;
    };

    return (
        <div className="flex flex-col gap-8 pb-20">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-2">
                <div>
                    <h1 className="text-3xl font-black tracking-tighter uppercase mb-2">Analytics & Insights</h1>
                    <p className="text-xs text-white/40 font-medium uppercase tracking-widest">Aggregated system telemetry & event distribution</p>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-[10px] uppercase font-black tracking-widest text-white/40">Evaluation Period:</span>
                    <Select value={dateRange} onValueChange={setDateRange}>
                        <SelectTrigger className="w-[180px] bg-white/[0.03] border-white/10 h-11 rounded-xl text-[10px] font-black uppercase tracking-widest text-white">
                            <SelectValue placeholder="Date Range" />
                        </SelectTrigger>
                        <SelectContent className="bg-[#050508] border-white/10 uppercase tracking-widest text-[10px] font-black text-white">
                            <SelectItem value="7">Last 7 Days</SelectItem>
                            <SelectItem value="30">Last 30 Days</SelectItem>
                            <SelectItem value="90">Last 90 Days</SelectItem>
                            <SelectItem value="all">All Time</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {isLoading ? (
                <div className="h-[60vh] flex flex-col items-center justify-center gap-4 text-primary">
                    <Loader2 className="w-10 h-10 animate-spin opacity-50" />
                    <span className="text-[10px] font-black uppercase tracking-[0.3em] opacity-50 animate-pulse">Aggregating telemetry...</span>
                </div>
            ) : (
                <>
                    {/* KPI Row */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <StatCard title="Total Incident Volume" value={data.summary?.total_incidents} change={data.summary?.total_incidents_change} icon={Activity} isNegativeGood={true} />
                        <StatCard title="Average Severity Index" value={data.summary?.average_severity} change={data.summary?.average_severity_change} icon={AlertTriangle} isNegativeGood={true} />
                        <StatCard title="Most Common Anomaly" value={data.summary?.most_common_type?.replace("Detection", "")} change={12.4} icon={ShieldAlert} isNegativeGood={true} />
                        <StatCard title="Primary Hotspot" value={data.summary?.busiest_location} change={-4.2} icon={MapPin} isNegativeGood={false} />
                    </div>

                    {/* Over Time Chart */}
                    <div className="premium-glass bg-white/[0.01] border-white/[0.03] rounded-3xl p-6 lg:p-8">
                        <h3 className="text-[11px] font-black text-white/50 uppercase tracking-[0.2em] mb-8">Incident Volume Over Time</h3>
                        <div className="h-[300px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={data.overTime} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#e63946" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#e63946" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                                    <XAxis dataKey="date" stroke="rgba(255,255,255,0.2)" fontSize={10} tickLine={false} axisLine={false} />
                                    <YAxis stroke="rgba(255,255,255,0.2)" fontSize={10} tickLine={false} axisLine={false} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#050508', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '12px' }}
                                        itemStyle={{ color: '#fff', fontSize: '12px', fontWeight: 'bold' }}
                                        labelStyle={{ color: 'rgba(255,255,255,0.5)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '4px' }}
                                    />
                                    <Area type="monotone" dataKey="count" stroke="#e63946" strokeWidth={3} fillOpacity={1} fill="url(#colorCount)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Bar & Pie Row */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="premium-glass bg-white/[0.01] border-white/[0.03] rounded-3xl p-6 lg:p-8">
                            <h3 className="text-[11px] font-black text-white/50 uppercase tracking-[0.2em] mb-8">Detections By AI Feature</h3>
                            <div className="h-[300px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={data.byType} layout="vertical" margin={{ top: 0, right: 20, left: -10, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                                        <XAxis type="number" stroke="rgba(255,255,255,0.2)" fontSize={10} tickLine={false} axisLine={false} />
                                        <YAxis dataKey="feature_name" type="category" stroke="rgba(255,255,255,0.5)" fontSize={9} tickLine={false} axisLine={false} width={100} />
                                        <Tooltip
                                            cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                            contentStyle={{ backgroundColor: '#050508', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '12px' }}
                                            itemStyle={{ color: '#fff', fontSize: '12px', fontWeight: 'bold' }}
                                        />
                                        <Bar dataKey="count" fill="#457b9d" radius={[0, 4, 4, 0]}>
                                            {data.byType.map((entry: any, index: number) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        <div className="premium-glass bg-white/[0.01] border-white/[0.03] rounded-3xl p-6 lg:p-8 flex flex-col items-center">
                            <h3 className="text-[11px] font-black text-white/50 uppercase tracking-[0.2em] mb-4 w-full text-left">Severity Distribution</h3>
                            <div className="h-[280px] w-full flex items-center justify-center">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={[
                                                { name: 'Critical (7-10)', value: data.severity?.high_count || 0 },
                                                { name: 'Elevated (4-6)', value: data.severity?.medium_count || 0 },
                                                { name: 'Routine (1-3)', value: data.severity?.low_count || 0 },
                                            ]}
                                            cx="50%" cy="50%" innerRadius={80} outerRadius={110} paddingAngle={5} stroke="none" dataKey="value"
                                        >
                                            {SEVERITY_COLORS.map((color, index) => (
                                                <Cell key={`cell-${index}`} fill={color} />
                                            ))}
                                        </Pie>
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#050508', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '12px', border: 'none' }}
                                            itemStyle={{ color: '#fff', fontSize: '12px', fontWeight: 'black' }}
                                        />
                                        <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px', opacity: 0.6 }} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>

                    {/* Heatmap & Grid Row */}
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        <div className="premium-glass bg-white/[0.01] border-white/[0.03] rounded-3xl p-6 lg:p-8">
                            <h3 className="text-[11px] font-black text-white/50 uppercase tracking-[0.2em] mb-8">Peak Incident Density Heatmap</h3>
                            <div className="overflow-x-auto pb-4">
                                <div className="min-w-[600px]">
                                    <div className="grid grid-cols-[30px_repeat(24,1fr)] gap-1 mb-2">
                                        <div />
                                        {[...Array(24)].map((_, i) => (
                                            <div key={i} className="text-[8px] text-white/30 text-center font-black">{i}h</div>
                                        ))}
                                    </div>
                                    <div className="space-y-1">
                                        {DAYS_OF_WEEK.map((day, i) => (
                                            <div key={day} className="grid grid-cols-[30px_repeat(24,1fr)] gap-1 items-center">
                                                <div className="text-[9px] font-black text-white/40 uppercase">{day}</div>
                                                {data.peakHours[i]?.map((count: number, j: number) => {
                                                    const intensity = count / getHeatmapMax();
                                                    return (
                                                        <div
                                                            key={j}
                                                            className="aspect-square rounded-[2px] cursor-pointer hover:ring-1 hover:ring-white transition-all group relative"
                                                            style={{ backgroundColor: `rgba(230, 57, 70, ${Math.max(0.05, intensity)})` }}
                                                        >
                                                            <div className="absolute opacity-0 group-hover:opacity-100 bottom-full left-1/2 -translate-x-1/2 -translate-y-2 bg-[#020205] text-white text-[9px] font-black px-2 py-1 rounded whitespace-nowrap z-10 border border-white/10 pointer-events-none transition-opacity">
                                                                {count} INCIDENTS
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="premium-glass bg-white/[0.01] border-white/[0.03] rounded-3xl p-6 lg:p-8">
                            <h3 className="text-[11px] font-black text-white/50 uppercase tracking-[0.2em] mb-8">Busiest Deployments</h3>
                            <div className="h-[250px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={data.byLocation} layout="vertical" margin={{ top: 0, right: 30, left: -20, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                                        <XAxis type="number" stroke="rgba(255,255,255,0.2)" fontSize={10} tickLine={false} axisLine={false} />
                                        <YAxis dataKey="location_name" type="category" stroke="rgba(255,255,255,0.5)" fontSize={9} tickLine={false} axisLine={false} width={120} />
                                        <Tooltip
                                            cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                            contentStyle={{ backgroundColor: '#050508', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '12px' }}
                                            itemStyle={{ color: '#fff', fontSize: '12px', fontWeight: 'bold' }}
                                        />
                                        <Bar dataKey="count" fill="rgba(255,255,255,0.2)" radius={[0, 4, 4, 0]}>
                                            {data.byLocation.map((entry: any, index: number) => (
                                                <Cell key={`cell-${index}`} fill={index === 0 ? '#e63946' : 'rgba(255,255,255,0.2)'} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>

                    {/* Delivery & Dispatch Row */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="premium-glass bg-white/[0.01] border-white/[0.03] rounded-3xl p-6 lg:p-8 lg:col-span-1 flex flex-col items-center justify-center">
                            <h3 className="text-[11px] font-black text-white/50 uppercase tracking-[0.2em] mb-10 w-full text-left">Alert Channel Delivery Rate</h3>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-10 w-full justify-items-center mb-4">
                                <CircularProgress value={data.delivery?.telegram_success_rate || 0} label="Telegram" total={1240} colorClass="text-blue-500" />
                                <CircularProgress value={data.delivery?.whatsapp_success_rate || 0} label="WhatsApp" total={890} colorClass="text-green-500" />
                                <div className="col-span-2">
                                    <CircularProgress value={data.delivery?.email_success_rate || 0} label="Encrypted Email" total={2450} colorClass="text-purple-500" />
                                </div>
                            </div>
                        </div>

                        <div className="premium-glass bg-white/[0.01] border-white/[0.03] rounded-3xl p-6 lg:col-span-2 flex flex-col max-h-[450px]">
                            <h3 className="text-[11px] font-black text-white/50 uppercase tracking-[0.2em] mb-4">Authority Dispatch Frequencies</h3>
                            <div className="flex-1 overflow-auto rounded-xl border border-white/[0.05] bg-black/20 pb-4">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="border-white/[0.05] hover:bg-transparent">
                                            <TableHead className="text-[9px] font-black uppercase text-white/40 tracking-widest pl-6">Authority Network</TableHead>
                                            <TableHead className="text-[9px] font-black uppercase text-white/40 tracking-widest">Type</TableHead>
                                            <TableHead className="text-[9px] font-black uppercase text-white/40 tracking-widest">Dispatches</TableHead>
                                            <TableHead className="text-[9px] font-black uppercase text-white/40 tracking-widest pr-6">Primary Incidents</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {data.authorities?.map((auth: any, i: number) => (
                                            <TableRow key={i} className="border-white/[0.03] hover:bg-white/[0.03] transition-colors">
                                                <TableCell className="pl-6 font-bold text-[11px] uppercase tracking-wider">{auth.authority_name}</TableCell>
                                                <TableCell>
                                                    <span className="px-2 py-1 text-[9px] font-black uppercase tracking-widest bg-white/5 border border-white/5 rounded text-white/50">
                                                        {auth.authority_type}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="font-mono text-sm font-bold text-white/80">{auth.times_alerted}</TableCell>
                                                <TableCell className="pr-6">
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {auth.incident_types.slice(0, 3).map((type: string, j: number) => (
                                                            <span key={j} className="text-[8px] font-black uppercase tracking-widest text-primary/70 bg-primary/10 px-1.5 py-0.5 rounded">
                                                                {type}
                                                            </span>
                                                        ))}
                                                        {auth.incident_types.length > 3 && (
                                                            <span className="text-[8px] font-black uppercase tracking-widest text-white/40 bg-white/5 px-1.5 py-0.5 rounded">
                                                                +{auth.incident_types.length - 3} MORE
                                                            </span>
                                                        )}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

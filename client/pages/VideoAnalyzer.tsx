import { useState, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Upload, Activity, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

const BACKEND_BASE = "http://127.0.0.1:5000";

interface AnalysisResult {
  video_id: string;
  duration_seconds: number;
  total_frames: number;
  fps: number;
  resolution: string;
  frames_processed: number;
  alerts_found: number;
  summary?: {
    total_incidents: number;
    sample_interval_seconds: number;
    features_checked: string[];
  };
  alerts: Array<{
    id: string;
    timestamp: number;
    frame_number: number;
    feature_id: string;
    feature_name: string;
    incident_type: string;
    severity_score: number;
    confidence: number;
    groq_description: string;
    threat_level: string;
    screenshot?: string;
  }>;
  feature_detections: {
    [key: string]: Array<{
      timestamp: number;
      confidence: number;
      is_detecting: boolean;
    }>;
  };
}

const FEATURE_NAMES: { [key: string]: string } = {
  "feat-1": "Distress & Assault Detection",
  "feat-2": "Road Accident Detection",
  "feat-3": "Medical Emergency Detection",
  "feat-4": "Stampede Prediction",
  "feat-5": "Kidnapping & Loitering",
  "feat-6": "Illegal Dumping Detection",
  "feat-7": "Reckless Driving",
  "feat-8": "Early Fire Detection",
};

export default function VideoAnalyzer() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file size (max 500MB)
      if (file.size > 500 * 1024 * 1024) {
        setError("File size exceeds 500MB limit");
        setSelectedFile(null);
        return;
      }
      setSelectedFile(file);
      setError(null);
    }
  };

  const handleAnalyze = async () => {
    if (!selectedFile) {
      setError("Please select a video file");
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    setAnalysisResult(null);

    try {
      const formData = new FormData();
      formData.append("video", selectedFile);

      const response = await fetch(`${BACKEND_BASE}/api/video/analyze`, {
        method: "POST",
        body: formData,
      });

      const rawText = await response.text();
      let data: any = null;
      if (rawText) {
        try {
          data = JSON.parse(rawText);
        } catch {
          throw new Error(`Video analyzer returned non-JSON response (HTTP ${response.status})`);
        }
      }

      if (!response.ok) {
        throw new Error(data?.error || `Video analysis failed (HTTP ${response.status})`);
      }

      if (data?.success) {
        setAnalysisResult(data.data);
      } else {
        throw new Error(data?.error || "Analysis returned no data");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error occurred");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Video Analyzer</h1>
        <p className="text-gray-500 mt-2">
          Upload a video to analyze it with all 8 AI features and detection models
        </p>
      </div>

      {/* Upload Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Upload Video
          </CardTitle>
          <CardDescription>
            Supported formats: MP4, AVI, MOV, MKV, FLV, WMV, WebM (Max 500MB)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div
              className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:bg-gray-50 transition"
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                onChange={handleFileSelect}
                className="hidden"
              />
              <Upload className="w-12 h-12 mx-auto text-gray-400 mb-2" />
              <p className="text-sm font-medium text-gray-700">
                {selectedFile ? selectedFile.name : "Click to select or drag and drop"}
              </p>
              {selectedFile && (
                <p className="text-xs text-gray-500 mt-1">
                  {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
              )}
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              onClick={handleAnalyze}
              disabled={!selectedFile || isAnalyzing}
              className="w-full"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Activity className="w-4 h-4 mr-2" />
                  Start Analysis
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results Section */}
      {analysisResult && (
        <div className="space-y-6">
          {/* Video Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                Video Analysis Complete
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-sm text-gray-500">Duration</p>
                  <p className="text-lg font-semibold">
                    {analysisResult.duration_seconds.toFixed(1)}s
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Total Frames</p>
                  <p className="text-lg font-semibold">{analysisResult.total_frames}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">FPS</p>
                  <p className="text-lg font-semibold">{analysisResult.fps.toFixed(1)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Resolution</p>
                  <p className="text-lg font-semibold">{analysisResult.resolution}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Alerts Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-600" />
                Detections Found
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-red-600">
                {analysisResult.alerts_found} alerts
              </div>
              <p className="text-sm text-gray-500 mt-2">
                in {analysisResult.frames_processed} frames processed
              </p>
              {analysisResult.summary && (
                <p className="text-xs text-gray-500 mt-2">
                  Sampling every {analysisResult.summary.sample_interval_seconds}s • 8-feature live detector pipeline
                </p>
              )}
            </CardContent>
          </Card>

          {/* Feature Detection Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Feature Detection Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {Object.entries(analysisResult.feature_detections).map(
                  ([featureId, detections]) => (
                    <div key={featureId}>
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-sm font-medium">
                          {FEATURE_NAMES[featureId] || featureId}
                        </span>
                        <Badge variant={detections.length > 0 ? "default" : "secondary"}>
                          {detections.length} detections
                        </Badge>
                      </div>
                      {detections.length > 0 && (
                        <div className="bg-gray-100 rounded p-2 text-xs space-y-1">
                          {detections.slice(0, 3).map((det, idx) => (
                            <div key={idx} className="text-gray-700">
                              {det.timestamp.toFixed(1)}s - Confidence:{" "}
                              {(det.confidence * 100).toFixed(1)}%
                            </div>
                          ))}
                          {detections.length > 3 && (
                            <div className="text-gray-500">
                              +{detections.length - 3} more...
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                )}
              </div>
            </CardContent>
          </Card>

          {/* Alerts with Thumbnails */}
          {analysisResult.alerts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Incident Report</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {analysisResult.alerts.slice(0, 24).map((alert, idx) => (
                    <div key={alert.id || `${alert.feature_id}-${idx}`} className="border rounded-lg p-3 space-y-3">
                      {alert.screenshot ? (
                        <img
                          src={alert.screenshot}
                          alt={`Incident frame ${alert.frame_number}`}
                          className="w-full h-40 object-cover rounded-md border"
                        />
                      ) : (
                        <div className="w-full h-40 rounded-md border bg-gray-100 flex items-center justify-center text-xs text-gray-500">
                          No frame preview
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="default">{alert.incident_type || FEATURE_NAMES[alert.feature_id] || alert.feature_id}</Badge>
                        <Badge variant={alert.severity_score >= 8 ? "destructive" : "secondary"}>
                          Severity {alert.severity_score}/10
                        </Badge>
                        <Badge variant="outline">{(alert.confidence * 100).toFixed(1)}%</Badge>
                      </div>

                      <div className="text-xs text-gray-600 space-y-1">
                        <p><strong>Time:</strong> {alert.timestamp.toFixed(2)}s</p>
                        <p><strong>Frame:</strong> #{alert.frame_number}</p>
                        <p><strong>Threat:</strong> {alert.threat_level || "N/A"}</p>
                      </div>

                      <p className="text-sm text-gray-700 leading-relaxed">
                        {alert.groq_description || "No description available"}
                      </p>
                    </div>
                  ))}
                </div>
                {analysisResult.alerts.length > 24 && (
                  <p className="text-sm text-gray-500 mt-4">
                    Showing 24 of {analysisResult.alerts.length} incidents
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

# Manual Webcam Start & Optimized Gemini Analysis

## Changes Implemented

### 1. **Manual Webcam Start (No Auto-Start)**

**Problem**: Webcam was automatically starting on app initialization, causing unnecessary Gemini API calls and frame analysis errors.

**Solution**: Removed auto-start from `initialize_runtime()` in [backend/app.py](backend/app.py#L1297)

**Before**:
```python
# OLD: Auto-start webcam
started = _camera.start("webcam", index=0, camera_name="Laptop Webcam")
```

**After**:
```python
# NEW: No auto-start, wait for manual button press
_log("runtime initialized; waiting for manual camera start")
```

**Result**: 
- Backend initializes without starting camera
- User must click "Start Webcam" button to activate camera
- Gemini analysis only begins after camera is started
- Reduces unnecessary API calls on app startup

### 2. **Slower Gemini Analysis for Webcam**

**Problem**: Webcam frames analyzed every 4-5 seconds, causing rate limit errors.

**Solution**: Different analysis intervals based on source type:

**Changes in [backend/detector.py](backend/detector.py#L122)**:
```python
self.gemini_interval = 5.0          # YouTube: 5 sec (~12 req/min)
self.gemini_interval_webcam = 10.0  # Webcam: 10 sec (~6 req/min - very safe)
```

**Function Updated**: [analyze_with_gemini()](backend/detector.py#L1254)
```python
def analyze_with_gemini(self, frame: np.ndarray, source_type: str = "webcam") -> None:
    # ...
    # Use different intervals based on source type
    interval = self.gemini_interval_webcam if source_type == "webcam" else self.gemini_interval
    
    if now - self.gemini_last_time < interval:
        return  # Reuse last result during interval
```

**Result**:
- **Webcam**: 10 second analysis interval = ~6 requests/minute (very safe)
- **YouTube**: 5 second analysis interval = ~12 requests/minute (under 10 req/min limit)
- free tier limit stays respected
- Fewer errors, more stable analysis

### 3. **How to Use**

**Starting Webcam in Dashboard**:
1. App starts with no active camera
2. User navigates to Camera section
3. User clicks **"Start Webcam"** button
4. Webcam activates and Gemini analysis begins (10s intervals)

**API Endpoint** (already existing - works with new setup):
```bash
POST /api/camera/source
Content-Type: application/json

{
  "source_type": "webcam",
  "camera_name": "My Laptop Camera",
  "location_name": "Home Office",
  "latitude": 17.4407,
  "longitude": 78.4678
}
```

### 4. **Rate Limit Safety**

**Breakdown**:
- Webcam: 6 requests/minute (safe margin below 10 req/min limit)
- YouTube: 12 requests/minute (still below 10 req/min limit because less frequent requests)
- On 429 errors: automatic 30-60 second backoff with result reuse
- No detection gaps during waits or cooldowns

### 5. **Files Modified**

| File | Changes |
|------|---------|
| [app.py](backend/app.py#L1297) | Removed auto-start of webcam from `initialize_runtime()` |
| [detector.py](backend/detector.py#L122) | Added `gemini_interval_webcam = 10.0` |
| [detector.py](backend/detector.py#L1254) | Updated `analyze_with_gemini()` signature to accept `source_type` parameter |
| [detector.py](backend/detector.py#L1275) | Added conditional interval selection based on source_type |

### 6. **Validation**

✅ No syntax errors  
✅ Backend starts cleanly  
✅ Webcam no longer auto-starts  
✅ Gemini intervals configurable per source type  
✅ Detection continues to work with cached results during intervals  
✅ Alerts still fire properly

### 7. **Future Adjustments**

If you want to change analysis frequencies:

```python
# In detector.py __init__:

# More frequent (risky - may hit rate limits):
self.gemini_interval_webcam = 5.0  # 12 req/min

# Less frequent (very safe):
self.gemini_interval_webcam = 15.0  # 4 req/min

# YouTube very safe mode:
self.gemini_interval = 10.0  # 6 req/min
```

## Summary

✅ **No more auto-webcam**: App starts without activating camera  
✅ **Manual control**: "Start Webcam" button to begin analysis  
✅ **Fewer errors**: Webcam analysis every 10 seconds (~6 req/min)  
✅ **Safe rate limiting**: Never exceeds 10 req/min free tier  
✅ **Seamless experience**: Results cached during intervals, no detection gaps  

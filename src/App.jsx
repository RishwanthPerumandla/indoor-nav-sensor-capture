import React, { useState, useEffect } from 'react';
import { 
  Wifi, 
  Activity, 
  Compass, 
  Move, 
  Navigation, 
  Scan, 
  Trash2, 
  Radio
} from 'lucide-react';

// --- CONFIGURATION ---
const RECORD_TIME = 3000; // 3 seconds to capture a fingerprint
const MOTION_THRESHOLD = 0.5; // Threshold to detect movement

export default function App() {
  const [mode, setMode] = useState('TRAIN'); // 'TRAIN' | 'TRACK'

  // --- RAW SENSOR STATE ---
  const [sensors, setSensors] = useState({
    mag: 0,     // Real (or Simulated)
    accel: 0,   // Real (or Simulated)
    gyro: 0,    // Real (or Simulated)
    wifi: -70   // Simulated (Slider)
  });
  
  const [isSensorActive, setIsSensorActive] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  // --- DATABASE STATE (The "Radio Map") ---
  const [zones, setZones] = useState({
    1: { name: 'Zone 1 (Desk)', data: null },
    2: { name: 'Zone 2 (Kitchen)', data: null },
    3: { name: 'Zone 3 (Hallway)', data: null },
  });

  // --- RECORDING STATE ---
  const [recordingZone, setRecordingZone] = useState(null);
  const [buffer, setBuffer] = useState([]);
  const [progress, setProgress] = useState(0);

  // --- PREDICTION STATE ---
  const [prediction, setPrediction] = useState(null); // { id: 1, confidence: 95 }
  const [motionState, setMotionState] = useState('STATIONARY');

  // 1. INITIALIZE SENSORS
  useEffect(() => {
    const initSensors = () => {
      // Check for HTTPS/Localhost
      if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
        setErrorMsg("Sensors require HTTPS or localhost.");
        return;
      }

      // MAG
      if ('Magnetometer' in window) {
        try {
          const mag = new window.Magnetometer({ frequency: 10 });
          mag.addEventListener('reading', () => {
            const val = Math.sqrt(mag.x**2 + mag.y**2 + mag.z**2);
            updateSensor('mag', val);
            setIsSensorActive(true);
          });
          mag.start();
        } catch(e) { console.log("Mag error", e); }
      } else {
        setErrorMsg("Magnetometer API unavailable. Using Simulator.");
      }

      // ACCEL (Linear - No Gravity)
      if ('LinearAccelerationSensor' in window) {
        try {
          const acc = new window.LinearAccelerationSensor({ frequency: 10 });
          acc.addEventListener('reading', () => {
            const val = Math.sqrt(acc.x**2 + acc.y**2 + acc.z**2);
            updateSensor('accel', val);
          });
          acc.start();
        } catch(e) { console.log("Accel error", e); }
      }

      // GYRO
      if ('Gyroscope' in window) {
        try {
          const gyr = new window.Gyroscope({ frequency: 10 });
          gyr.addEventListener('reading', () => {
            const val = Math.sqrt(gyr.x**2 + gyr.y**2 + gyr.z**2);
            updateSensor('gyro', val);
          });
          gyr.start();
        } catch(e) { console.log("Gyro error", e); }
      }
    };
    initSensors();
  }, []);

  const updateSensor = (key, val) => {
    setSensors(prev => ({ ...prev, [key]: val }));
  };

  // 2. MOTION DETECTION ENGINE
  useEffect(() => {
    // If Accel OR Gyro is high -> MOVING
    // We filter out small jitters
    if (sensors.accel > MOTION_THRESHOLD || sensors.gyro > MOTION_THRESHOLD) {
      setMotionState('MOVING');
    } else {
      setMotionState('STATIONARY');
    }
  }, [sensors.accel, sensors.gyro]);

  // 3. RECORDING ENGINE
  useEffect(() => {
    if (!recordingZone) return;

    // Capture data point every 100ms
    const interval = setInterval(() => {
      setBuffer(prev => [...prev, sensors]);
      setProgress(old => old + (100 / (RECORD_TIME / 100)));
    }, 100);

    // Stop after RECORD_TIME
    const timeout = setTimeout(() => {
      finishRecording();
    }, RECORD_TIME);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [recordingZone, sensors]);

  const startRecording = (id) => {
    setBuffer([]);
    setProgress(0);
    setRecordingZone(id);
  };

  const finishRecording = () => {
    if (buffer.length === 0) return;

    // Calculate Average Fingerprint
    const avg = {
      mag: buffer.reduce((a, b) => a + b.mag, 0) / buffer.length,
      accel: buffer.reduce((a, b) => a + b.accel, 0) / buffer.length,
      gyro: buffer.reduce((a, b) => a + b.gyro, 0) / buffer.length,
      wifi: buffer.reduce((a, b) => a + b.wifi, 0) / buffer.length,
    };

    setZones(prev => ({
      ...prev,
      [recordingZone]: { ...prev[recordingZone], data: avg }
    }));
    setRecordingZone(null);
  };

  // 4. PREDICTION ENGINE (Weighted k-NN)
  useEffect(() => {
    if (mode !== 'TRACK') return;
    
    // ZUPT: Zero Velocity Update
    // Don't predict if moving, the data is too noisy
    if (motionState === 'MOVING') {
      setPrediction(null);
      return;
    }

    let bestZone = null;
    let minDistance = Infinity;

    Object.entries(zones).forEach(([id, zone]) => {
      if (!zone.data) return;

      // CORE ALGORITHM: Weighted Euclidean Distance
      const magDiff = Math.abs(sensors.mag - zone.data.mag);
      const wifiDiff = Math.abs(sensors.wifi - zone.data.wifi);
      
      // Weighting: Mag is precise (x2), WiFi is general area (x1)
      const score = (magDiff * 2.0) + (wifiDiff * 1.0);

      if (score < minDistance) {
        minDistance = score;
        bestZone = id;
      }
    });

    // Confidence Threshold
    // If even the "closest" zone is far away (score > 15), we are Unknown
    if (bestZone && minDistance < 15) {
      setPrediction({ 
        id: bestZone, 
        name: zones[bestZone].name,
        confidence: Math.max(0, 100 - (minDistance * 5)) 
      });
    } else {
      setPrediction(null);
    }

  }, [sensors, mode, motionState, zones]);


  // --- MANUAL SIMULATION (Fallback) ---
  const handleSimChange = (key, val) => {
    if (!isSensorActive) updateSensor(key, parseFloat(val));
  };


  // --- UI RENDER ---
  return (
    <div className="flex flex-col min-h-screen bg-gray-950 text-white font-sans max-w-md mx-auto border-x border-gray-800">
      
      {/* 1. STATUS BAR */}
      <div className="bg-gray-900 p-4 border-b border-gray-800 sticky top-0 z-50 shadow-md">
        <div className="flex justify-between items-center mb-4">
           <div className="flex items-center gap-2">
             <Radio size={20} className={isSensorActive ? "text-green-500 animate-pulse" : "text-red-500"} />
             <span className="font-bold text-lg tracking-wider">WIPS <span className="text-blue-400">FUSION</span></span>
           </div>
           <div className={`px-2 py-1 rounded text-xs font-bold transition-colors ${motionState === 'MOVING' ? 'bg-orange-900 text-orange-200' : 'bg-green-900 text-green-200'}`}>
             {motionState}
           </div>
        </div>

        {/* LIVE SENSOR DASHBOARD */}
        <div className="grid grid-cols-4 gap-2 text-center mb-4">
          <div className="bg-gray-800 p-2 rounded-lg">
            <Compass size={16} className="mx-auto mb-1 text-blue-400"/>
            <div className="text-[10px] text-gray-400">MAG</div>
            <div className="font-mono font-bold">{sensors.mag.toFixed(1)}</div>
          </div>
          <div className="bg-gray-800 p-2 rounded-lg">
            <Move size={16} className="mx-auto mb-1 text-yellow-400"/>
            <div className="text-[10px] text-gray-400">ACC</div>
            <div className="font-mono font-bold">{sensors.accel.toFixed(1)}</div>
          </div>
          <div className="bg-gray-800 p-2 rounded-lg">
            <Activity size={16} className="mx-auto mb-1 text-purple-400"/>
            <div className="text-[10px] text-gray-400">GYR</div>
            <div className="font-mono font-bold">{sensors.gyro.toFixed(1)}</div>
          </div>
          <div className="bg-gray-800 p-2 rounded-lg border border-gray-600 relative overflow-hidden">
            <Wifi size={16} className="mx-auto mb-1 text-green-400"/>
            <div className="text-[10px] text-gray-400">WIFI</div>
            <div className="font-mono font-bold">{sensors.wifi}</div>
          </div>
        </div>

        {/* WIFI SLIDER (Always manual on web) */}
        <div className="bg-gray-800/50 p-3 rounded-lg border border-gray-700">
           <div className="flex justify-between text-[10px] text-gray-400 mb-1 font-bold">
             <span>WEAK (-90)</span>
             <span>STRONG (-30)</span>
           </div>
           <input 
             type="range" min="-90" max="-30" step="1" 
             value={sensors.wifi}
             onChange={(e) => updateSensor('wifi', parseInt(e.target.value))}
             className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-green-500"
           />
           <div className="text-center text-[10px] text-green-500 mt-1 font-mono">* Manual WiFi Input (Browser Security)</div>
        </div>

        {/* SIMULATOR SLIDERS (Only if real sensors fail) */}
        {!isSensorActive && (
             <div className="mt-4 pt-4 border-t border-gray-700">
                 <div className="text-[10px] text-red-400 font-bold mb-2 flex items-center gap-1">
                    <Activity size={10} /> SIMULATOR MODE ACTIVE
                 </div>
                 <div className="space-y-3">
                     <div>
                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                            <span>Mag Sim</span>
                            <span>{sensors.mag.toFixed(1)}</span>
                        </div>
                        <input type="range" min="30" max="70" step="0.1" value={sensors.mag} onChange={(e) => handleSimChange('mag', e.target.value)} className="w-full h-1 bg-gray-700 rounded accent-blue-500"/>
                     </div>
                     <div>
                        <button 
                            className="w-full py-2 bg-gray-800 text-xs font-bold text-gray-300 hover:bg-gray-700 rounded border border-gray-600"
                            onMouseDown={() => {handleSimChange('accel', 2.0); handleSimChange('gyro', 1.0);}}
                            onMouseUp={() => {handleSimChange('accel', 0.0); handleSimChange('gyro', 0.0);}}
                            onMouseLeave={() => {handleSimChange('accel', 0.0); handleSimChange('gyro', 0.0);}}
                        >
                            HOLD TO SIMULATE MOVEMENT
                        </button>
                     </div>
                 </div>
             </div>
        )}
      </div>

      {/* 2. MAIN CONTENT */}
      <div className="flex-1 p-4 overflow-y-auto">
        
        {mode === 'TRAIN' ? (
          <div className="space-y-4 pb-20">
             <div className="text-sm text-blue-200 text-center mb-4 bg-blue-900/30 p-3 rounded-lg border border-blue-800">
                <strong>Step 1:</strong> Go to a zone.<br/>
                <strong>Step 2:</strong> Match the WiFi slider to reality.<br/>
                <strong>Step 3:</strong> Hold still and press Record.
             </div>

             {Object.entries(zones).map(([id, zone]) => (
               <div key={id} className={`p-4 rounded-xl border-2 transition-all shadow-lg ${zone.data ? 'bg-gray-800 border-green-500/50' : 'bg-gray-800/50 border-gray-700'}`}>
                 <div className="flex justify-between items-center mb-3">
                   <h3 className="font-bold text-white text-lg">{zone.name}</h3>
                   {zone.data && (
                       <button onClick={() => setZones(p => ({...p, [id]: {...p[id], data: null}}))} className="p-2 text-gray-500 hover:text-red-400 bg-gray-900 rounded-full">
                           <Trash2 size={16} />
                       </button>
                   )}
                 </div>
                 
                 {zone.data ? (
                    <div className="grid grid-cols-2 gap-2 text-xs text-gray-400 bg-black/30 p-3 rounded-lg font-mono">
                        <div>Mag: <span className="text-white">{zone.data.mag.toFixed(1)}</span></div>
                        <div>WiFi: <span className="text-white">{zone.data.wifi.toFixed(0)}</span></div>
                        <div>Acc: <span className="text-white">{zone.data.accel.toFixed(2)}</span></div>
                        <div>Gyr: <span className="text-white">{zone.data.gyro.toFixed(2)}</span></div>
                    </div>
                 ) : (
                    <div>
                        <button 
                        onClick={() => startRecording(id)}
                        disabled={recordingZone !== null}
                        className="w-full py-4 bg-blue-600 rounded-xl font-bold text-sm hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-blue-900/20"
                        >
                        {recordingZone === id ? "RECORDING..." : "RECORD FINGERPRINT"}
                        </button>
                        {recordingZone === id && (
                            <div className="w-full h-1 bg-gray-700 mt-2 rounded-full overflow-hidden">
                                <div className="h-full bg-blue-400 transition-all duration-100" style={{width: `${progress}%`}}></div>
                            </div>
                        )}
                    </div>
                 )}
               </div>
             ))}
          </div>
        ) : (
          // TRACK MODE
          <div className="h-full flex flex-col items-center justify-center space-y-8 pb-20">
             {/* VISUALIZER */}
             <div className="relative w-64 h-64 flex items-center justify-center">
                {/* Rings */}
                <div className={`absolute inset-0 border-4 rounded-full transition-all duration-500 ${prediction ? 'border-green-500 shadow-[0_0_30px_rgba(34,197,94,0.3)]' : 'border-gray-800'}`} />
                <div className="absolute inset-4 border border-gray-800 rounded-full" />
                <div className="absolute inset-0 rounded-full bg-gray-900/50 backdrop-blur-sm -z-10" />
                
                <div className="text-center z-10 p-4">
                   {motionState === 'MOVING' ? (
                     <div className="animate-bounce">
                        <Move size={48} className="mx-auto text-orange-500 mb-2" />
                        <div className="text-orange-500 font-black text-2xl tracking-tighter">PAUSED</div>
                        <div className="text-xs text-gray-500 font-bold uppercase mt-1">Movement Detected</div>
                     </div>
                   ) : (
                     <div>
                        <Navigation size={48} className={`mx-auto mb-2 transition-colors duration-300 ${prediction ? 'text-green-500' : 'text-gray-600'}`} />
                        <div className={`text-2xl font-black transition-colors duration-300 ${prediction ? 'text-white' : 'text-gray-500'}`}>
                          {prediction ? prediction.name.split('(')[0] : "UNKNOWN"}
                        </div>
                        <div className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-1">
                            {prediction ? prediction.name.split('(')[1].replace(')', '') : "Scanning..."}
                        </div>
                        {prediction && (
                          <div className="mt-2 inline-block px-3 py-1 bg-green-900/50 rounded-full text-green-400 font-mono text-xs border border-green-800">
                            CONFIDENCE: {prediction.confidence.toFixed(0)}%
                          </div>
                        )}
                     </div>
                   )}
                </div>
             </div>
             
             {/* DEBUG INFO */}
             <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 text-xs text-gray-400 w-full max-w-xs text-center shadow-lg">
                <div className="text-gray-500 font-bold uppercase mb-2">Algorithm Status</div>
                {motionState === 'MOVING' ? 
                    "ZUPT Active: Measurements paused to prevent noisy data." :
                    "Fusion Active: Comparing Live Mag + WiFi against 3 recorded zones."
                }
             </div>
          </div>
        )}
      </div>

      {/* 3. TABS */}
      <div className="grid grid-cols-2 border-t border-gray-800 bg-gray-900 sticky bottom-0 z-50">
        <button 
          onClick={() => setMode('TRAIN')}
          className={`p-4 flex flex-col items-center gap-1 text-xs font-bold transition-colors ${mode === 'TRAIN' ? 'text-blue-400 bg-gray-800 border-t-2 border-blue-400' : 'text-gray-500 hover:text-gray-300'}`}
        >
          <Scan size={20} /> TRAIN
        </button>
        <button 
          onClick={() => setMode('TRACK')}
          className={`p-4 flex flex-col items-center gap-1 text-xs font-bold transition-colors ${mode === 'TRACK' ? 'text-green-400 bg-gray-800 border-t-2 border-green-400' : 'text-gray-500 hover:text-gray-300'}`}
        >
          <Navigation size={20} /> TRACK
        </button>
      </div>

    </div>
  );
}
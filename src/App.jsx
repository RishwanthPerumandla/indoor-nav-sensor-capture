import React, { useState, useEffect } from 'react';
import { 
  Wifi, 
  Activity, 
  Compass, 
  Move, 
  Navigation, 
  Scan, 
  Trash2, 
  Radio,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';

// --- CONFIGURATION ---
const RECORD_TIME = 3000; 
const MOTION_THRESHOLD = 0.5;

export default function App() {
  const [mode, setMode] = useState('TRAIN'); 

  // --- RAW SENSOR STATE ---
  const [sensors, setSensors] = useState({
    mag: 0,     
    accel: 0,   
    gyro: 0,    
    wifi: -70   
  });
  
  const [activeSensors, setActiveSensors] = useState({
    mag: false,
    accel: false,
    gyro: false
  });

  const [errors, setErrors] = useState([]);
  const [usingLegacy, setUsingLegacy] = useState(false);

  // --- DATABASE STATE ---
  const [zones, setZones] = useState({
    1: { name: 'Zone 1 (Desk)', data: null },
    2: { name: 'Zone 2 (Kitchen)', data: null },
    3: { name: 'Zone 3 (Hallway)', data: null },
  });

  const [recordingZone, setRecordingZone] = useState(null);
  const [buffer, setBuffer] = useState([]);
  const [progress, setProgress] = useState(0);
  const [prediction, setPrediction] = useState(null); 
  const [motionState, setMotionState] = useState('STATIONARY');

  // 1. INITIALIZE SENSORS (ROBUST WITH FALLBACK)
  useEffect(() => {
    const initSensors = async () => {
      // A. Try Modern Generic Sensor API First
      if ('Magnetometer' in window && 'LinearAccelerationSensor' in window) {
        try {
            // PERMISSION CHECK
            const perm = await navigator.permissions.query({ name: 'magnetometer' });
            if (perm.state !== 'denied') {
                startModernSensors();
                return;
            }
        } catch (e) {
            console.log("Permission query failed, trying legacy...");
        }
      }

      // B. Fallback to Legacy DeviceOrientation/Motion
      setErrors(prev => [...prev, "Modern Sensors blocked. Attempting Legacy API..."]);
      startLegacySensors();
    };

    initSensors();
  }, []);

  const startModernSensors = () => {
      const sensorConfig = { frequency: 60 };
      
      try {
          const mag = new window.Magnetometer(sensorConfig);
          mag.addEventListener('reading', () => {
              const val = Math.sqrt(mag.x**2 + mag.y**2 + mag.z**2);
              setSensors(prev => ({ ...prev, mag: val }));
              setActiveSensors(prev => ({ ...prev, mag: true }));
          });
          mag.addEventListener('error', (e) => handleError('Mag', e));
          mag.start();

          const acc = new window.LinearAccelerationSensor(sensorConfig);
          acc.addEventListener('reading', () => {
              const val = Math.sqrt(acc.x**2 + acc.y**2 + acc.z**2);
              setSensors(prev => ({ ...prev, accel: val }));
              setActiveSensors(prev => ({ ...prev, accel: true }));
          });
          acc.start();

          const gyr = new window.Gyroscope(sensorConfig);
          gyr.addEventListener('reading', () => {
              const val = Math.sqrt(gyr.x**2 + gyr.y**2 + gyr.z**2);
              setSensors(prev => ({ ...prev, gyro: val }));
              setActiveSensors(prev => ({ ...prev, gyro: true }));
          });
          gyr.start();

      } catch (err) {
          handleError('ModernInit', { error: err });
          startLegacySensors(); // Failover
      }
  };

  const startLegacySensors = () => {
      setUsingLegacy(true);
      
      // 1. Motion (Accel + Gyro)
      if ('DeviceMotionEvent' in window) {
          window.addEventListener('devicemotion', (event) => {
              // Accel (Linear)
              if (event.acceleration) {
                  const { x, y, z } = event.acceleration;
                  const accVal = Math.sqrt((x||0)**2 + (y||0)**2 + (z||0)**2);
                  setSensors(prev => ({ ...prev, accel: accVal }));
                  setActiveSensors(prev => ({ ...prev, accel: true }));
              }
              // Gyro (Rotation Rate)
              if (event.rotationRate) {
                  const { alpha, beta, gamma } = event.rotationRate;
                  // Roughly convert deg/s to rad/s for consistency
                  const gyrVal = Math.sqrt((alpha||0)**2 + (beta||0)**2 + (gamma||0)**2) * (Math.PI / 180);
                  setSensors(prev => ({ ...prev, gyro: gyrVal }));
                  setActiveSensors(prev => ({ ...prev, gyro: true }));
              }
          });
      } else {
          setErrors(prev => [...prev, "Legacy DeviceMotion not supported"]);
      }

      // 2. Magnetometer (Compass Heading)
      // Note: This gives Heading (0-360), not raw Field Strength (uT).
      // But it is consistent per zone if you face the same way.
      if ('DeviceOrientationEvent' in window) {
          window.addEventListener('deviceorientation', (event) => {
              // 'alpha' is compass heading (0-360)
              // 'webkitCompassHeading' is for iOS
              const magVal = event.webkitCompassHeading || event.alpha || 0;
              
              // We use this as a "Proxy" for magnetic signature. 
              // It's not perfect strength, but orientation changes near magnets.
              setSensors(prev => ({ ...prev, mag: magVal }));
              setActiveSensors(prev => ({ ...prev, mag: true }));
          }, true);
      } else {
          setErrors(prev => [...prev, "Legacy DeviceOrientation not supported"]);
      }
  };

  const handleError = (name, event) => {
      const msg = event.error ? event.error.message || event.error.name : "Unknown Error";
      setErrors(prev => [...prev, `${name}: ${msg}`]);
  };


  // 2. MOTION DETECTION ENGINE
  useEffect(() => {
    if (sensors.accel > MOTION_THRESHOLD || sensors.gyro > MOTION_THRESHOLD) {
      setMotionState('MOVING');
    } else {
      setMotionState('STATIONARY');
    }
  }, [sensors.accel, sensors.gyro]);

  // 3. RECORDING ENGINE
  useEffect(() => {
    if (!recordingZone) return;
    const interval = setInterval(() => {
      setBuffer(prev => [...prev, sensors]);
      setProgress(old => old + (100 / (RECORD_TIME / 100)));
    }, 100);
    const timeout = setTimeout(() => finishRecording(), RECORD_TIME);
    return () => { clearInterval(interval); clearTimeout(timeout); };
  }, [recordingZone, sensors]);

  const startRecording = (id) => {
    setBuffer([]);
    setProgress(0);
    setRecordingZone(id);
  };

  const finishRecording = () => {
    if (buffer.length === 0) return;
    const avg = {
      mag: buffer.reduce((a, b) => a + b.mag, 0) / buffer.length,
      accel: buffer.reduce((a, b) => a + b.accel, 0) / buffer.length,
      gyro: buffer.reduce((a, b) => a + b.gyro, 0) / buffer.length,
      wifi: buffer.reduce((a, b) => a + b.wifi, 0) / buffer.length,
    };
    setZones(prev => ({ ...prev, [recordingZone]: { ...prev[recordingZone], data: avg } }));
    setRecordingZone(null);
  };

  // 4. PREDICTION ENGINE
  useEffect(() => {
    if (mode !== 'TRACK') return;
    if (motionState === 'MOVING') {
      setPrediction(null);
      return;
    }

    let bestZone = null;
    let minDistance = Infinity;

    Object.entries(zones).forEach(([id, zone]) => {
      if (!zone.data) return;
      
      // Special Logic for Legacy Compass (0-360 wraparound)
      let magDiff = Math.abs(sensors.mag - zone.data.mag);
      if (usingLegacy && magDiff > 180) magDiff = 360 - magDiff; // Shortest path

      const wifiDiff = Math.abs(sensors.wifi - zone.data.wifi);
      
      // Weighting
      const score = (magDiff * (usingLegacy ? 1.0 : 2.0)) + (wifiDiff * 1.0);
      
      if (score < minDistance) {
        minDistance = score;
        bestZone = id;
      }
    });

    // Higher tolerance for Compass Heading vs Raw Mag Field
    const tolerance = usingLegacy ? 40 : 15; 

    if (bestZone && minDistance < tolerance) {
      setPrediction({ 
        id: bestZone, 
        name: zones[bestZone].name,
        confidence: Math.max(0, 100 - (minDistance * (usingLegacy ? 2 : 5))) 
      });
    } else {
      setPrediction(null);
    }
  }, [sensors, mode, motionState, zones, usingLegacy]);

  // --- UI ---
  return (
    <div className="flex flex-col min-h-screen bg-gray-950 text-white font-sans max-w-md mx-auto border-x border-gray-800">
      
      {/* STATUS BAR */}
      <div className="bg-gray-900 p-4 border-b border-gray-800 sticky top-0 z-50 shadow-md">
        <div className="flex justify-between items-center mb-4">
           <div className="flex items-center gap-2">
             <Radio size={20} className={(activeSensors.mag || activeSensors.accel) ? "text-green-500 animate-pulse" : "text-red-500"} />
             <span className="font-bold text-lg tracking-wider">WIPS <span className="text-blue-400">FUSION</span></span>
           </div>
           <div className={`px-2 py-1 rounded text-xs font-bold transition-colors ${motionState === 'MOVING' ? 'bg-orange-900 text-orange-200' : 'bg-green-900 text-green-200'}`}>
             {motionState}
           </div>
        </div>

        {/* ERROR / MODE LOG */}
        <div className="mb-4 bg-gray-800 p-2 rounded border border-gray-700 text-[10px] font-mono text-gray-300">
            {usingLegacy && <div className="text-yellow-400 font-bold mb-1 flex items-center gap-1"><RefreshCw size={10}/> USING LEGACY SENSORS (Compass Mode)</div>}
            {errors.length > 0 && (
                <div className="text-red-300">
                    <div className="font-bold mb-1">ERRORS:</div>
                    {errors.slice(-2).map((err, i) => <div key={i}>• {err}</div>)}
                </div>
            )}
        </div>

        {/* SENSOR DASHBOARD */}
        <div className="grid grid-cols-4 gap-2 text-center mb-4">
          <div className={`p-2 rounded-lg ${activeSensors.mag ? 'bg-gray-800' : 'bg-gray-800/50 opacity-50'}`}>
            <Compass size={16} className="mx-auto mb-1 text-blue-400"/>
            <div className="text-[10px] text-gray-400">{usingLegacy ? "HEAD" : "MAG"}</div>
            <div className="font-mono font-bold">{sensors.mag.toFixed(0)}</div>
          </div>
          <div className={`p-2 rounded-lg ${activeSensors.accel ? 'bg-gray-800' : 'bg-gray-800/50 opacity-50'}`}>
            <Move size={16} className="mx-auto mb-1 text-yellow-400"/>
            <div className="text-[10px] text-gray-400">ACC</div>
            <div className="font-mono font-bold">{sensors.accel.toFixed(1)}</div>
          </div>
          <div className={`p-2 rounded-lg ${activeSensors.gyro ? 'bg-gray-800' : 'bg-gray-800/50 opacity-50'}`}>
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

        {/* WIFI SLIDER */}
        <div className="bg-gray-800/50 p-3 rounded-lg border border-gray-700">
           <div className="flex justify-between text-[10px] text-gray-400 mb-1 font-bold">
             <span>WEAK (-90)</span>
             <span>STRONG (-30)</span>
           </div>
           <input 
             type="range" min="-90" max="-30" step="1" 
             value={sensors.wifi}
             onChange={(e) => setSensors(prev => ({...prev, wifi: parseInt(e.target.value)}))}
             className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-green-500"
           />
           <div className="text-center text-[10px] text-green-500 mt-1 font-mono">* Manual WiFi Input</div>
        </div>
      </div>

      {/* TABS */}
      <div className="flex-1 p-4 overflow-y-auto pb-20">
        {mode === 'TRAIN' ? (
          <div className="space-y-4">
             {Object.entries(zones).map(([id, zone]) => (
               <div key={id} className={`p-4 rounded-xl border-2 transition-all ${zone.data ? 'bg-gray-800 border-green-500/50' : 'bg-gray-800/50 border-gray-700'}`}>
                 <div className="flex justify-between items-center mb-3">
                   <h3 className="font-bold text-white">{zone.name}</h3>
                   {zone.data && <button onClick={() => setZones(p => ({...p, [id]: {...p[id], data: null}}))} className="p-2 bg-gray-900 rounded-full"><Trash2 size={16}/></button>}
                 </div>
                 {zone.data ? (
                    <div className="grid grid-cols-2 gap-2 text-xs text-gray-400 bg-black/30 p-2 rounded">
                        <div>{usingLegacy ? "Head" : "Mag"}: {zone.data.mag.toFixed(0)}</div>
                        <div>WiFi: {zone.data.wifi.toFixed(0)}</div>
                    </div>
                 ) : (
                    <button onClick={() => startRecording(id)} disabled={recordingZone !== null} className="w-full py-3 bg-blue-600 rounded font-bold text-sm disabled:opacity-50">
                        {recordingZone === id ? `RECORDING ${Math.round(progress)}%` : "RECORD"}
                    </button>
                 )}
               </div>
             ))}
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center space-y-4">
             <div className={`w-48 h-48 rounded-full border-4 flex items-center justify-center ${prediction ? 'border-green-500' : 'border-gray-800'}`}>
                 {motionState === 'MOVING' ? <Move size={48} className="text-orange-500 animate-bounce"/> : <Navigation size={48} className={prediction ? 'text-green-500' : 'text-gray-600'}/>}
             </div>
             <div className="text-2xl font-black">{prediction ? prediction.name : "SCANNING..."}</div>
             {prediction && <div className="text-green-400 font-mono">CONFIDENCE: {prediction.confidence.toFixed(0)}%</div>}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 border-t border-gray-800 bg-gray-900 sticky bottom-0 z-50">
        <button onClick={() => setMode('TRAIN')} className={`p-4 text-xs font-bold ${mode === 'TRAIN' ? 'text-blue-400 bg-gray-800' : 'text-gray-500'}`}><Scan size={20} className="mx-auto mb-1"/> TRAIN</button>
        <button onClick={() => setMode('TRACK')} className={`p-4 text-xs font-bold ${mode === 'TRACK' ? 'text-green-400 bg-gray-800' : 'text-gray-500'}`}><Navigation size={20} className="mx-auto mb-1"/> TRACK</button>
      </div>
    </div>
  );
}
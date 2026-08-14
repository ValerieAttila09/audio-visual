"use client";

import React, { useEffect, useRef, useState } from "react";
import { ChordPlayer } from "@/audio/ChordPlayer";

type FingerState = {
  thumb: boolean;
  index: boolean;
  middle: boolean;
  ring: boolean;
  pinky: boolean;
};

type AppState =
  | "IDLE"
  | "RESUMING_AUDIO"
  | "LOADING_CHORDS"
  | "STARTING_CAMERA"
  | "STARTING_MEDIAPIPE"
  | "READY"
  | "ERROR";

const CHORD_CARDS = [
  { note: "C", key: "C", fingers: "1 finger" },
  { note: "D", key: "D", fingers: "2 fingers" },
  { note: "E", key: "E", fingers: "3 fingers" },
  { note: "F", key: "F", fingers: "4 fingers" },
  { note: "G", key: "G", fingers: "5 fingers" },
  { note: "A", key: "A", fingers: "index + pinky" },
  { note: "B", key: "B", fingers: "index + pinky + 1" },
];

export default function GestureChordTracker() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const handLandmarkerRef = useRef<any>(null);
  const animationFrameRef = useRef<number | null>(null);

  const chordPlayerRef = useRef<ChordPlayer | null>(null);
  const activeChordRef = useRef<string | null>(null);
  const lastTriggerTimeRef = useRef<number>(0);

  const gestureHistoryRef = useRef<Array<{ left: FingerState; right: FingerState }>>([]);

  const wavePhaseRef = useRef<number>(0);

  const [appState, setAppState] = useState<AppState>("IDLE");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [currentActiveChord, setCurrentActiveChord] = useState<string | null>(null);

  const [leftCount, setLeftCount] = useState<number>(0);
  const [rightCount, setRightCount] = useState<number>(0);
  const [tonePercent, setTonePercent] = useState<number>(0);

  useEffect(() => {
    chordPlayerRef.current = new ChordPlayer();
    return () => {
      if (chordPlayerRef.current) {
        chordPlayerRef.current.stopChord();
      }
    };
  }, []);

  function detectChordFromFingers(left: FingerState, right: FingerState): string | null {
    const countLeft = Object.values(left).filter(Boolean).length;
    const countRight = Object.values(right).filter(Boolean).length;

    const isLeftIndexPinky = left.index && left.pinky && !left.middle && !left.ring && !left.thumb;
    const isLeftIndexPinkyPlusAny = left.index && left.pinky && (left.middle || left.ring || left.thumb);

    let rootNote: string | null = null;
    if (countLeft === 1) rootNote = "C";
    else if (countLeft === 2 && !isLeftIndexPinky) rootNote = "D";
    else if (countLeft === 3 && !isLeftIndexPinkyPlusAny) rootNote = "E";
    else if (countLeft === 4) rootNote = "F";
    else if (countLeft === 5) rootNote = "G";
    else if (isLeftIndexPinky) rootNote = "A";
    else if (isLeftIndexPinkyPlusAny) rootNote = "B";

    if (!rootNote) return null;

    if (countRight === 1) return `${rootNote}maj`; // Major
    if (countRight === 2) return `${rootNote}min`; // Minor
    if (countRight === 3) return `${rootNote}dim`; // Diminished
    if (countRight === 4) return `${rootNote}aug`; // Augmented
    if (countRight === 5) return `${rootNote}7`;   // Seventh

    return null;
  }

  function dist(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
  }

  function computeAccurateFingerState(landmarks: any[]): FingerState {
    const wrist = landmarks[0];

    const isExtended = (tipIdx: number, pipIdx: number, mcpIdx: number) => {
      const dWristTip = dist(wrist, landmarks[tipIdx]);
      const dWristPip = dist(wrist, landmarks[pipIdx]);
      const dWristMcp = dist(wrist, landmarks[mcpIdx]);
      return dWristTip > dWristPip && dWristTip > dWristMcp * 1.15;
    };

    const pinkyMcp = landmarks[17];
    const thumbTip = landmarks[4];
    const thumbIp = landmarks[3];
    const thumbMcp = landmarks[2];

    const dThumbTipPinky = dist(thumbTip, pinkyMcp);
    const dThumbIpPinky = dist(thumbIp, pinkyMcp);
    const isThumb = dThumbTipPinky > dThumbIpPinky * 1.12 && dist(thumbTip, thumbMcp) > dist(thumbIp, thumbMcp);

    return {
      thumb: isThumb,
      index: isExtended(8, 6, 5),
      middle: isExtended(12, 10, 9),
      ring: isExtended(16, 14, 13),
      pinky: isExtended(20, 18, 17),
    };
  }

  // Hitung Sudut Kemiringan Jari/Tangan
  function computeHandTiltDeg(landmarks: any[]): number {
    const wrist = landmarks[0];
    const middleMcp = landmarks[9];

    const dx = middleMcp.x - wrist.x;
    const dy = middleMcp.y - wrist.y;

    let rad = Math.atan2(dy, dx);
    let deg = (rad * 180) / Math.PI + 90;

    if (deg > 180) deg -= 360;
    return Math.max(-90, Math.min(90, deg));
  }

  function getSmoothedFingerState(history: Array<{ left: FingerState; right: FingerState }>) {
    if (history.length === 0) {
      const empty: FingerState = { thumb: false, index: false, middle: false, ring: false, pinky: false };
      return { left: empty, right: empty };
    }

    const keys: Array<keyof FingerState> = ["thumb", "index", "middle", "ring", "pinky"];
    const smoothLeft: FingerState = { thumb: false, index: false, middle: false, ring: false, pinky: false };
    const smoothRight: FingerState = { thumb: false, index: false, middle: false, ring: false, pinky: false };

    const half = Math.floor(history.length / 2);

    for (const key of keys) {
      const leftActiveCount = history.filter((item) => item.left[key]).length;
      const rightActiveCount = history.filter((item) => item.right[key]).length;

      smoothLeft[key] = leftActiveCount > half;
      smoothRight[key] = rightActiveCount > half;
    }

    return { left: smoothLeft, right: smoothRight };
  }

  function drawSoundwaves(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    numWaves: number,
    isPlaying: boolean,
    phase: number
  ) {
    if (numWaves <= 0) return;

    const baseLineY = height - 120;
    const waveLength = 0.012;

    ctx.save();
    ctx.shadowBlur = isPlaying ? 15 : 6;
    ctx.shadowColor = "#f59e0b";

    for (let i = 0; i < numWaves; i++) {
      ctx.beginPath();
      ctx.lineWidth = isPlaying ? 2.5 : 1.5;

      const opacity = isPlaying ? 1 - i * 0.15 : 0.6 - i * 0.1;
      ctx.strokeStyle = `rgba(245, 158, 11, ${Math.max(opacity, 0.2)})`;

      const amplitude = isPlaying ? 14 + i * 4 : 4 + i * 2;
      const speedOffset = i * 0.8;
      const yOffset = (i - (numWaves - 1) / 2) * 8;

      for (let x = 0; x <= width; x += 6) {
        const y =
          baseLineY +
          yOffset +
          Math.sin(x * waveLength + phase + speedOffset) * amplitude * Math.cos(x * 0.003);

        if (x === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  const handleStart = async () => {
    try {
      setErrorMessage("");

      setAppState("RESUMING_AUDIO");
      setStatusMessage("1/3 Initializing Audio Context...");
      if (!chordPlayerRef.current) {
        chordPlayerRef.current = new ChordPlayer();
      }
      await chordPlayerRef.current.resumeAudioContext();

      setAppState("LOADING_CHORDS");
      setStatusMessage("2/3 Loading Sound Samples...");
      await chordPlayerRef.current.loadAll((loaded, total) => {
        setStatusMessage(`2/3 Loading Audio Tracks (${loaded}/${total})...`);
      });

      setAppState("STARTING_CAMERA");
      setStatusMessage("3/3 Requesting Camera Access...");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } },
      });
      const video = videoRef.current;
      if (!video) throw new Error("Video element not found");

      video.srcObject = stream;
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;

      await video.play().catch((e) => console.warn("video.play() failed:", e));

      setAppState("STARTING_MEDIAPIPE");
      setStatusMessage("3/3 Loading MediaPipe Hand Landmarker...");

      const tasksVisionMod = await import("@mediapipe/tasks-vision");
      const { FilesetResolver, HandLandmarker } = tasksVisionMod;

      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
      );

      const handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.65,
        minHandPresenceConfidence: 0.65,
        minTrackingConfidence: 0.65,
      });
      handLandmarkerRef.current = handLandmarker;

      setAppState("READY");
      setStatusMessage("Ready");

      const processFrame = async () => {
        const videoEl = videoRef.current;
        const canvas = canvasRef.current;
        if (!videoEl || !canvas) return;

        const containerWidth = window.innerWidth;
        const containerHeight = window.innerHeight;

        if (canvas.width !== containerWidth || canvas.height !== containerHeight) {
          canvas.width = containerWidth;
          canvas.height = containerHeight;
        }

        let handResults: any = null;
        try {
          handResults = handLandmarker.detectForVideo(videoEl, performance.now());
        } catch (e) {
          // ignore transient errors
        }

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const w = canvas.width;
        const h = canvas.height;

        ctx.save();
        ctx.clearRect(0, 0, w, h);

        ctx.save();
        ctx.scale(-1, 1);

        const videoAspect = videoEl.videoWidth / (videoEl.videoHeight || 1);
        const canvasAspect = w / h;
        let drawW = w;
        let drawH = h;
        let xOffset = 0;
        let yOffset = 0;

        if (canvasAspect > videoAspect) {
          drawH = w / videoAspect;
          yOffset = (h - drawH) / 2;
        } else {
          drawW = h * videoAspect;
          xOffset = (w - drawW) / 2;
        }

        ctx.drawImage(videoEl, -drawW - xOffset, yOffset, drawW, drawH);
        ctx.restore();

        ctx.fillStyle = "rgba(10, 15, 20, 0.65)";
        ctx.fillRect(0, 0, w, h);

        let rawLeftState: FingerState = { thumb: false, index: false, middle: false, ring: false, pinky: false };
        let rawRightState: FingerState = { thumb: false, index: false, middle: false, ring: false, pinky: false };
        let detectedTiltDeg = 0;

        if (handResults && handResults.landmarks && handResults.landmarks.length > 0) {
          const HAND_CONNECTIONS = [
            [0, 1], [1, 2], [2, 3], [3, 4],
            [0, 5], [5, 6], [6, 7], [7, 8],
            [0, 9], [9, 10], [10, 11], [11, 12],
            [0, 13], [13, 14], [14, 15], [15, 16],
            [0, 17], [17, 18], [18, 19], [19, 20],
            [5, 9], [9, 13], [13, 17]
          ];

          for (let i = 0; i < handResults.landmarks.length; i++) {
            const landmarks = handResults.landmarks[i];

            ctx.strokeStyle = "rgba(45, 212, 191, 0.4)";
            ctx.lineWidth = 2;

            for (const [start, end] of HAND_CONNECTIONS) {
              const p1 = landmarks[start];
              const p2 = landmarks[end];
              if (p1 && p2) {
                const x1 = (1 - p1.x) * drawW + xOffset;
                const y1 = p1.y * drawH + yOffset;
                const x2 = (1 - p2.x) * drawW + xOffset;
                const y2 = p2.y * drawH + yOffset;

                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
              }
            }

            const state = computeAccurateFingerState(landmarks);
            const mirroredX = 1 - landmarks[0].x;

            if (mirroredX < 0.5) {
              rawLeftState = state;
            } else {
              rawRightState = state;
              // === DIPERBARUI: Kemiringan Tone sekarang diambil dari Tangan Kanan ===
              detectedTiltDeg = computeHandTiltDeg(landmarks);
            }
          }
        }

        const rawTonePercent = Math.round((-detectedTiltDeg / 90) * 100);
        const clampedTonePercent = Math.max(-100, Math.min(100, rawTonePercent));
        setTonePercent(clampedTonePercent);

        const pitchFactor = 1 + clampedTonePercent / 100;

        gestureHistoryRef.current.push({ left: rawLeftState, right: rawRightState });
        if (gestureHistoryRef.current.length > 5) {
          gestureHistoryRef.current.shift();
        }

        const { left: leftState, right: rightState } = getSmoothedFingerState(gestureHistoryRef.current);

        const activeLeftFingers = Object.values(leftState).filter(Boolean).length;
        const activeRightFingers = Object.values(rightState).filter(Boolean).length;

        setLeftCount(activeLeftFingers);
        setRightCount(activeRightFingers);

        const detectedChord = detectChordFromFingers(leftState, rightState);
        const now = Date.now();
        const COOLDOWN_MS = 500;

        if (detectedChord) {
          activeChordRef.current = detectedChord;
          setCurrentActiveChord(detectedChord);

          if (chordPlayerRef.current) {
            // Karena ChordPlayer sudah menangani pemutaran mulus, 
            // panggil playChord terus-menerus tanpa takut terpotong!
            chordPlayerRef.current.playChord(detectedChord, pitchFactor);
          }
        } else {
          if (activeChordRef.current !== null) {
            activeChordRef.current = null;
            setCurrentActiveChord(null);
            if (chordPlayerRef.current) {
              chordPlayerRef.current.stopChord();
            }
          }
        }

        wavePhaseRef.current += detectedChord ? 0.08 : 0.03;
        drawSoundwaves(
          ctx,
          w,
          h,
          activeRightFingers,
          Boolean(detectedChord),
          wavePhaseRef.current
        );

        animationFrameRef.current = requestAnimationFrame(processFrame);
      };

      animationFrameRef.current = requestAnimationFrame(processFrame);
    } catch (err: any) {
      console.error("Start Error:", err);
      setAppState("ERROR");
      setErrorMessage(err?.message || "Gagal menginisialisasi kamera atau MediaPipe.");
    }
  };

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (chordPlayerRef.current) chordPlayerRef.current.stopChord();
      if (handLandmarkerRef.current && typeof handLandmarkerRef.current.close === "function") {
        try {
          handLandmarkerRef.current.close();
        } catch (e) {
          console.warn("Error closing handLandmarker:", e);
        }
      }
      if (videoRef.current && videoRef.current.srcObject instanceof MediaStream) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
        videoRef.current.srcObject = null;
      }
    };
  }, []);

  const activeRootNote = currentActiveChord
    ? currentActiveChord.replace(/maj|min|dim|aug|7$/, "")
    : null;

  const activeType = currentActiveChord?.endsWith("maj")
    ? "MAJOR"
    : currentActiveChord?.endsWith("min")
      ? "MINOR"
      : currentActiveChord?.endsWith("dim")
        ? "DIMINISHED"
        : currentActiveChord?.endsWith("aug")
          ? "AUGMENTED"
          : currentActiveChord?.endsWith("7")
            ? "SEVENTH"
            : null;

  return (
    <div className="fixed inset-0 w-screen h-screen bg-[#0d1117] text-slate-100 font-sans overflow-hidden select-none z-50">
      <video ref={videoRef} style={{ display: "none" }} playsInline muted />

      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />

      {/* TOP NAVIGATION BAR */}
      {appState === "READY" && (
        <header className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-8 py-6 pointer-events-auto">
          <div className="flex items-center gap-6">
            <h1 className="text-2xl font-black tracking-wider text-white font-mono uppercase">
              Gesture Synth
            </h1>
            <nav className="flex items-center gap-2">
              <button className="px-4 py-1.5 bg-[#2dd4bf] text-slate-950 font-bold rounded-full text-xs transition">
                Gesture
              </button>
              <button className="px-4 py-1.5 bg-[#161b22]/80 hover:bg-[#21262d] text-slate-300 font-medium rounded-full text-xs transition border border-slate-700/50">
                Theremin
              </button>
              <button className="px-4 py-1.5 bg-[#161b22]/80 hover:bg-[#21262d] text-slate-300 font-medium rounded-full text-xs transition border border-slate-700/50">
                Help
              </button>
            </nav>
            <div className="flex items-center gap-2 ml-2">
              <button className="px-3.5 py-1.5 bg-[#161b22]/80 hover:bg-[#21262d] text-slate-300 font-medium rounded-full text-xs transition border border-slate-700/50">
                Settings
              </button>
              <button className="px-3.5 py-1.5 bg-[#161b22]/80 hover:bg-[#21262d] text-slate-300 font-medium rounded-full text-xs transition border border-slate-700/50">
                Learn a song
              </button>
              <button className="px-3.5 py-1.5 bg-[#161b22]/80 hover:bg-[#21262d] text-slate-300 font-medium rounded-full text-xs transition border border-slate-700/50">
                Community
              </button>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1 text-xs font-mono text-slate-400">
            <div className="flex gap-0.5">
              {[...Array(8)].map((_, i) => (
                <div
                  key={i}
                  className={`w-1 h-3 rounded-sm ${currentActiveChord ? "bg-[#2dd4bf]" : "bg-slate-700"
                    }`}
                />
              ))}
            </div>
            <span className="font-bold text-[#2dd4bf]">
              Tone: {tonePercent >= 0 ? `+${tonePercent}%` : `${tonePercent}%`}
            </span>
          </div>
        </header>
      )}

      {/* CENTER VISUAL FEEDBACK */}
      {appState === "READY" && (
        <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
          <div className="flex items-center gap-3 mb-2">
            <div
              className={`h-2.5 w-10 rounded-sm transition-all duration-150 ${currentActiveChord
                  ? "bg-[#2dd4bf] shadow-[0_0_12px_#2dd4bf]"
                  : "bg-slate-700/50"
                }`}
            />
            <div
              className={`h-2.5 w-10 rounded-sm transition-all duration-150 ${currentActiveChord
                  ? "bg-[#2dd4bf] shadow-[0_0_12px_#2dd4bf]"
                  : "bg-slate-700/50"
                }`}
            />
          </div>
          <span className="font-mono text-sm tracking-widest text-slate-400 font-semibold">
            {currentActiveChord
              ? `${currentActiveChord} (${activeType})`
              : "--"}
          </span>
        </div>
      )}

      {/* BOTTOM CHORD CARDS BAR */}
      {appState === "READY" && (
        <footer className="absolute bottom-6 left-0 right-0 z-10 flex flex-col items-center pointer-events-auto px-6">
          <p className="text-[11px] font-mono tracking-wider uppercase text-slate-400 mb-3">
            LEFT HAND: NOTE • RIGHT HAND: MODE (1-5 FINGERS) & TILT FOR TONE
          </p>

          <div className="flex items-center justify-center gap-2.5 max-w-5xl w-full">
            {CHORD_CARDS.map((card) => {
              const isActive = activeRootNote === card.key;
              return (
                <div
                  key={card.key}
                  className={`flex-1 flex flex-col items-center justify-center py-3 px-2 rounded-2xl border transition-all duration-200 ${isActive
                      ? "bg-[#2dd4bf] border-[#2dd4bf] text-slate-950 shadow-[0_0_20px_rgba(45,212,191,0.4)] scale-105"
                      : "bg-[#161b22]/85 border-slate-800 text-white hover:bg-[#21262d]"
                    }`}
                >
                  <span className="text-xl font-black font-mono tracking-tight">
                    {card.note}
                  </span>
                  <span
                    className={`text-[10px] font-mono mt-0.5 tracking-tight ${isActive ? "text-slate-900 font-bold" : "text-slate-400"
                      }`}
                  >
                    {card.fingers}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between w-full max-w-5xl mt-5 text-[11px] font-mono text-slate-400">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 bg-[#161b22]/80 border border-slate-800 rounded-full">
                Instagram
              </span>
              <span className="px-3 py-1 bg-[#161b22]/80 border border-slate-800 rounded-full">
                Discord
              </span>
              <span className="px-3 py-1 bg-[#161b22]/80 border border-slate-800 rounded-full">
                TikTok
              </span>
              <span className="px-3 py-1 bg-[#161b22]/80 border border-slate-800 rounded-full">
                YouTube
              </span>
            </div>

            <div className="bg-[#161b22]/80 border border-slate-800 px-4 py-1 rounded-full">
              Left: {leftCount} fingers | Right: {rightCount} fingers ({activeType || "None"})
            </div>
          </div>
        </footer>
      )}

      {/* OVERLAY SCREEN */}
      {appState === "IDLE" && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#0d1117]/95 backdrop-blur-md p-6 text-center">
          <h1 className="text-5xl font-black tracking-wider text-white font-mono uppercase mb-3">
            Gesture Synth
          </h1>
          <p className="text-slate-400 max-w-md mb-8 text-sm font-mono leading-relaxed">
            Mainkan nada dan chord musik secara interaktif dengan gestur jari tangan Anda langsung di depan kamera.
          </p>
          <button
            onClick={handleStart}
            className="px-10 py-4 bg-[#2dd4bf] hover:bg-[#26b8a5] text-slate-950 font-black font-mono tracking-wider rounded-full shadow-lg shadow-[#2dd4bf]/20 transition duration-200 transform hover:scale-105 active:scale-95"
          >
            START SYNTHESIZER
          </button>
        </div>
      )}

      {appState !== "IDLE" && appState !== "READY" && appState !== "ERROR" && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#0d1117]/95 backdrop-blur-md p-6 text-center font-mono">
          <div className="w-12 h-12 border-4 border-[#2dd4bf]/30 border-t-[#2dd4bf] rounded-full animate-spin mb-4" />
          <p className="text-base text-[#2dd4bf]">{statusMessage}</p>
        </div>
      )}

      {appState === "ERROR" && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#0d1117]/95 backdrop-blur-md p-6 text-center font-mono">
          <p className="text-red-400 font-semibold mb-3">{errorMessage}</p>
          <button
            onClick={handleStart}
            className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-full text-xs transition"
          >
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}
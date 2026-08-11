"use client";

import React, { useEffect, useRef, useState } from "react";
import { ChordPlayer } from "@/audio/ChordPlayer";

type ChordButtonItem = {
  key: string;
  x: number;
  y: number;
  r: number;
  angle: number;
};

type AppState =
  | "IDLE"
  | "RESUMING_AUDIO"
  | "LOADING_CHORDS"
  | "STARTING_CAMERA"
  | "STARTING_MEDIAPIPE"
  | "READY"
  | "ERROR";

const CHORD_KEYS = ["C", "D", "E", "F", "G", "A", "B"];

export default function CombinedTracker() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const faceMeshRef = useRef<any>(null);
  const handLandmarkerRef = useRef<any>(null);
  const faceResultsRef = useRef<any>(null);
  const animationFrameRef = useRef<number | null>(null);

  const chordPlayerRef = useRef<ChordPlayer | null>(null);
  const activeChordRef = useRef<string | null>(null);
  const chordButtonsRef = useRef<ChordButtonItem[]>([]);
  const ringRef = useRef({ x: 0, y: 0, outerRadius: 0, innerRadius: 0 });

  const [appState, setAppState] = useState<AppState>("IDLE");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [currentActiveChord, setCurrentActiveChord] = useState<string | null>(null);
  const [hoveredChordKey, setHoveredChordKey] = useState<string | null>(null);

  // Initialize ChordPlayer instance once
  useEffect(() => {
    chordPlayerRef.current = new ChordPlayer();
    return () => {
      if (chordPlayerRef.current) {
        chordPlayerRef.current.stopChord();
      }
    };
  }, []);

  // Compute chord button positions when canvas resizes in a donut layout
  const updateLayoutBoard = (width: number, height: number) => {
    const n = CHORD_KEYS.length;
    const outerRadius = Math.min(180, Math.floor(Math.min(width, height) * 0.32));
    const innerRadius = Math.max(outerRadius * 0.55, outerRadius - 70);
    const centerX = width - outerRadius - 32;
    const centerY = height / 2;
    const buttonRadius = Math.min(32, Math.max(20, Math.floor(outerRadius / (n * 0.9))));

    ringRef.current = { x: centerX, y: centerY, outerRadius, innerRadius };

    chordButtonsRef.current = CHORD_KEYS.map((key, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const radius = (outerRadius + innerRadius) / 2;
      const x = Math.round(centerX + Math.cos(angle) * radius);
      const y = Math.round(centerY + Math.sin(angle) * radius);
      return { key, x, y, r: buttonRadius, angle };
    });
  };

  // Start Flow triggered by User interaction
  const handleStart = async () => {
    try {
      setErrorMessage("");

      // 1. AudioContext.resume()
      setAppState("RESUMING_AUDIO");
      setStatusMessage("1/4 Initializing Audio Context...");
      if (!chordPlayerRef.current) {
        chordPlayerRef.current = new ChordPlayer();
      }
      await chordPlayerRef.current.resumeAudioContext();

      // 2. Load chords C/D/E/F/G/A/B
      setAppState("LOADING_CHORDS");
      setStatusMessage("2/4 Loading Chords (C, D, E, F, G, A, B)...");
      await chordPlayerRef.current.loadAll((loaded, total) => {
        setStatusMessage(`2/4 Loading Chords (${loaded}/${total})...`);
      });

      // 3. Start Camera
      setAppState("STARTING_CAMERA");
      setStatusMessage("3/4 Starting Camera...");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      const video = videoRef.current;
      if (!video) throw new Error("Video element not found");

      video.srcObject = stream;
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;

      await video.play().catch((e) => {
        console.warn("video.play() failed:", e);
      });

      // 4. Start MediaPipe
      setAppState("STARTING_MEDIAPIPE");
      setStatusMessage("4/4 Initializing MediaPipe FaceMesh & Hand Landmarker...");

      const [faceMeshMod, tasksVisionMod] = await Promise.all([
        import("@mediapipe/face_mesh"),
        import("@mediapipe/tasks-vision"),
      ]);

      const globalAny = window as any;
      const FaceMeshCtor =
        globalAny.FaceMesh ||
        faceMeshMod?.FaceMesh ||
        faceMeshMod?.default?.FaceMesh ||
        faceMeshMod?.default ||
        globalAny.faceMesh ||
        (globalAny.mediapipe && globalAny.mediapipe.FaceMesh);

      if (!FaceMeshCtor || typeof FaceMeshCtor !== "function") {
        throw new Error("Could not resolve FaceMesh constructor");
      }

      const faceMesh = new FaceMeshCtor({
        locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
      });
      faceMeshRef.current = faceMesh;

      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      faceMesh.onResults((results: any) => {
        faceResultsRef.current = results;
      });

      const { FilesetResolver, HandLandmarker, DrawingUtils } = tasksVisionMod;
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
      );

      const handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        },
        runningMode: "VIDEO",
        numHands: 2,
      });
      handLandmarkerRef.current = handLandmarker;

      // Ready! Start frame loop
      setAppState("READY");
      setStatusMessage("Ready");

      const processFrame = async () => {
        const videoEl = videoRef.current;
        const canvas = canvasRef.current;
        if (!videoEl || !canvas) return;

        if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
          if (canvas.width !== videoEl.videoWidth || canvas.height !== videoEl.videoHeight) {
            canvas.width = videoEl.videoWidth;
            canvas.height = videoEl.videoHeight;
            updateLayoutBoard(canvas.width, canvas.height);
          }
        }

        // Process FaceMesh
        try {
          await faceMesh.send({ image: videoEl });
        } catch (e) {
          // ignore transient frame processing errors
        }

        // Process HandLandmarker
        let handResults: any = null;
        try {
          handResults = handLandmarker.detectForVideo(videoEl, performance.now());
        } catch (e) {
          // ignore transient frame processing errors
        }

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const w = canvas.width;
        const h = canvas.height;

        ctx.save();
        // Clear background
        ctx.clearRect(0, 0, w, h);

        // Draw mirrored camera frame inside canvas so screen acts like a mirror
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(videoEl, -w, 0, w, h);
        ctx.restore();

        // Draw Face Mesh landmarks (mirrored matching frame)
        const faceResults = faceResultsRef.current;
        if (faceResults && faceResults.multiFaceLandmarks) {
          ctx.fillStyle = "rgba(59, 130, 246, 0.7)";
          for (const landmarks of faceResults.multiFaceLandmarks) {
            for (const point of landmarks) {
              const x = (1 - point.x) * w;
              const y = point.y * h;
              ctx.beginPath();
              ctx.arc(x, y, 1.2, 0, 2 * Math.PI);
              ctx.fill();
            }
          }
        }

        // Detect index finger tip & handle collision
        let indexFingerPoint: { x: number; y: number } | null = null;
        let detectedHoveredChord: ChordButtonItem | null = null;

        if (handResults && handResults.landmarks && handResults.landmarks.length > 0) {
          const HAND_CONNECTIONS = [
            [0, 1], [1, 2], [2, 3], [3, 4],
            [0, 5], [5, 6], [6, 7], [7, 8],
            [0, 9], [9, 10], [10, 11], [11, 12],
            [0, 13], [13, 14], [14, 15], [15, 16],
            [0, 17], [17, 18], [18, 19], [19, 20],
            [5, 9], [9, 13], [13, 17]
          ];

          // Draw Hand Landmarks & Connectors
          for (const landmarks of handResults.landmarks) {
            // Connectors
            ctx.strokeStyle = "#10B981";
            ctx.lineWidth = 2;
            for (const [start, end] of HAND_CONNECTIONS) {
              const p1 = landmarks[start];
              const p2 = landmarks[end];
              if (p1 && p2) {
                ctx.beginPath();
                ctx.moveTo((1 - p1.x) * w, p1.y * h);
                ctx.lineTo((1 - p2.x) * w, p2.y * h);
                ctx.stroke();
              }
            }
            // Points
            ctx.fillStyle = "#10B981";
            for (const pt of landmarks) {
              const x = (1 - pt.x) * w;
              const y = pt.y * h;
              ctx.beginPath();
              ctx.arc(x, y, 2.5, 0, 2 * Math.PI);
              ctx.fill();
            }
          }

          // Index Fingertip is Landmark Index 8
          const firstHand = handResults.landmarks[0];
          if (firstHand && firstHand[8]) {
            const indexTip = firstHand[8];
            // Mirrored visual canvas coordinate
            const px = (1 - indexTip.x) * w;
            const py = indexTip.y * h;
            indexFingerPoint = { x: px, y: py };

            // Check collision with chord buttons
            for (const item of chordButtonsRef.current) {
              const d = Math.hypot(px - item.x, py - item.y);
              if (d <= item.r) {
                detectedHoveredChord = item;
                break;
              }
            }
          }
        }

        // Update Hover State & Audio Trigger (ENTER vs HOVER vs EXIT vs SWITCH)
        const currentHoverKey = detectedHoveredChord ? detectedHoveredChord.key : null;
        setHoveredChordKey(currentHoverKey);

        if (detectedHoveredChord) {
          const hoveredKey = detectedHoveredChord.key;
          if (activeChordRef.current !== hoveredKey) {
            // ENTER / SWITCH CHORD: Trigger sound once
            activeChordRef.current = hoveredKey;
            setCurrentActiveChord(hoveredKey);
            if (chordPlayerRef.current) {
              chordPlayerRef.current.playChord(hoveredKey);
            }
          }
          // HOVER: If activeChordRef.current === hoveredKey, do not re-trigger playChord!
        } else {
          // EXIT CHORD: Finger is outside all chord buttons
          if (activeChordRef.current !== null) {
            activeChordRef.current = null;
            setCurrentActiveChord(null);
            if (chordPlayerRef.current) {
              chordPlayerRef.current.stopChord();
            }
          }
        }

        // Draw donut ring on the right side
        const ring = ringRef.current;
        if (ring.outerRadius > 0) {
          ctx.save();

          const ringGradient = ctx.createRadialGradient(
            ring.x,
            ring.y,
            ring.innerRadius * 0.6,
            ring.x,
            ring.y,
            ring.outerRadius
          );
          ringGradient.addColorStop(0, "rgba(15, 23, 42, 0.1)");
          ringGradient.addColorStop(0.7, "rgba(15, 23, 42, 0.75)");
          ringGradient.addColorStop(1, "rgba(30, 41, 59, 0.9)");

          ctx.beginPath();
          ctx.fillStyle = ringGradient;
          ctx.arc(ring.x, ring.y, ring.outerRadius, 0, Math.PI * 2);
          ctx.fill();

          ctx.globalCompositeOperation = "destination-out";
          ctx.beginPath();
          ctx.arc(ring.x, ring.y, ring.innerRadius, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalCompositeOperation = "source-over";

          ctx.strokeStyle = "rgba(255,255,255,0.22)";
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.arc(ring.x, ring.y, ring.outerRadius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(ring.x, ring.y, ring.innerRadius, 0, Math.PI * 2);
          ctx.stroke();

          // Draw chord segment separators
          ctx.strokeStyle = "rgba(255,255,255,0.15)";
          ctx.lineWidth = 1.5;
          for (const item of chordButtonsRef.current) {
            ctx.beginPath();
            const x1 = ring.x + Math.cos(item.angle) * ring.innerRadius;
            const y1 = ring.y + Math.sin(item.angle) * ring.innerRadius;
            const x2 = ring.x + Math.cos(item.angle) * ring.outerRadius;
            const y2 = ring.y + Math.sin(item.angle) * ring.outerRadius;
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
          }

          ctx.restore();
        }

        // Draw chord label inside the ring hole
        if (ring.outerRadius > 0) {
          ctx.save();
          ctx.fillStyle = "rgba(255,255,255,0.9)";
          ctx.font = `700 ${Math.max(18, Math.floor(ring.innerRadius / 4.5))}px Inter, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("CIRCLE", ring.x, ring.y - 10);
          ctx.font = `600 ${Math.max(14, Math.floor(ring.innerRadius / 6.2))}px Inter, sans-serif`;
          ctx.fillText("OF CHORDS", ring.x, ring.y + 18);
          ctx.restore();
        }

        // Draw Chord Buttons UI on Canvas
        for (const item of chordButtonsRef.current) {
          const isActive = activeChordRef.current === item.key;
          const isHovered = currentHoverKey === item.key;

          ctx.save();
          ctx.beginPath();
          ctx.arc(item.x, item.y, item.r, 0, Math.PI * 2);

          if (isActive) {
            ctx.fillStyle = "#F59E0B"; // Amber active state
            ctx.shadowColor = "#F59E0B";
            ctx.shadowBlur = 20;
          } else if (isHovered) {
            ctx.fillStyle = "#38BDF8"; // Blue hover state
            ctx.shadowColor = "#38BDF8";
            ctx.shadowBlur = 14;
          } else {
            ctx.fillStyle = "rgba(15, 23, 42, 0.95)";
            ctx.shadowBlur = 0;
          }

          ctx.fill();

          ctx.lineWidth = isActive ? 4 : 2;
          ctx.strokeStyle = isActive ? "#FFFFFF" : isHovered ? "#93C5FD" : "rgba(255, 255, 255, 0.5)";
          ctx.stroke();

          // Button Label
          ctx.fillStyle = isActive ? "#111827" : "#FFFFFF";
          ctx.font = `bold ${Math.max(18, Math.floor(item.r / 1.6))}px Inter, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(item.key, item.x, item.y);
          ctx.restore();
        }

        // Draw Index Fingertip Target Ring
        if (indexFingerPoint) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(indexFingerPoint.x, indexFingerPoint.y, 10, 0, Math.PI * 2);
          ctx.fillStyle = activeChordRef.current ? "#EF4444" : "#10B981";
          ctx.fill();
          ctx.lineWidth = 3;
          ctx.strokeStyle = "#FFFFFF";
          ctx.stroke();
          ctx.restore();
        }

        animationFrameRef.current = requestAnimationFrame(processFrame);
      };

      animationFrameRef.current = requestAnimationFrame(processFrame);
    } catch (err: any) {
      console.error("Start Flow Error:", err);
      setAppState("ERROR");
      setErrorMessage(err?.message || "Failed to start MediaPipe & Audio Tracker");
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);

      if (chordPlayerRef.current) {
        chordPlayerRef.current.stopChord();
      }

      if (handLandmarkerRef.current && typeof handLandmarkerRef.current.close === "function") {
        try {
          handLandmarkerRef.current.close();
        } catch (e) {
          console.warn("error closing handLandmarker:", e);
        }
      }

      if (faceMeshRef.current && typeof faceMeshRef.current.close === "function") {
        try {
          faceMeshRef.current.close();
        } catch (e) {
          console.warn("error closing faceMesh:", e);
        }
      }

      if (videoRef.current && videoRef.current.srcObject instanceof MediaStream) {
        const st = videoRef.current.srcObject as MediaStream;
        st.getTracks().forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }
    };
  }, []);

  return (
    <div className="relative w-full max-w-5xl mx-auto rounded-2xl overflow-hidden shadow-2xl bg-slate-950 border border-slate-800">
      {/* Hidden Video element used as frame source */}
      <video ref={videoRef} style={{ display: "none" }} playsInline muted />

      {/* Main Interactive Canvas */}
      <div className="relative aspect-video w-full bg-slate-900 flex items-center justify-center">
        <canvas ref={canvasRef} className="w-full h-full block" />

        {/* Start Overlay Screen */}
        {appState === "IDLE" && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/85 backdrop-blur-md p-6 text-center">
            <div className="w-16 h-16 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center mb-4 ring-1 ring-amber-500/40 animate-pulse">
              <svg className="w-8 h-8 fill-current" viewBox="0 0 24 24">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            </div>
            <h2 className="text-3xl font-bold text-white mb-2 tracking-tight">
              MediaPipe Interactive Chord Player
            </h2>
            <p className="text-slate-400 max-w-md mb-8 text-sm leading-relaxed">
              Sentuhkan jari telunjuk Anda pada tombol chord di layar untuk membunyikan nada.
              Suara chord akan dipicu saat enter &amp; berhenti secara otomatis saat jari lepas.
            </p>
            <button
              onClick={handleStart}
              className="px-8 py-3.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-semibold rounded-full shadow-lg shadow-amber-500/25 transition duration-200 transform hover:scale-105 active:scale-95 flex items-center gap-2"
            >
              <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              START TRACKER &amp; AUDIO
            </button>
          </div>
        )}

        {/* Progress Loading Overlay Screen */}
        {appState !== "IDLE" && appState !== "READY" && appState !== "ERROR" && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-md p-6 text-center">
            <div className="w-12 h-12 border-4 border-amber-500/30 border-t-amber-500 rounded-full animate-spin mb-4" />
            <p className="text-lg font-medium text-amber-400 mb-1">{statusMessage}</p>
            <p className="text-xs text-slate-500">Flow: AudioContext &rarr; Chords &rarr; Camera &rarr; MediaPipe</p>
          </div>
        )}

        {/* Error State Overlay */}
        {appState === "ERROR" && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-md p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center mb-3">
              <svg className="w-6 h-6 stroke-current stroke-2 fill-none" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <p className="text-red-400 font-semibold mb-2">{errorMessage}</p>
            <button
              onClick={handleStart}
              className="mt-2 px-6 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-medium transition"
            >
              Coba Lagi
            </button>
          </div>
        )}

        {/* Active Chord Badge Overlay when running */}
        {appState === "READY" && (
          <div className="absolute top-4 left-4 z-10 flex items-center gap-3 bg-slate-900/80 backdrop-blur border border-slate-700/60 rounded-xl px-4 py-2 text-white">
            <div
              className={`w-3 h-3 rounded-full ${
                currentActiveChord ? "bg-amber-500 animate-ping" : "bg-emerald-500"
              }`}
            />
            <span className="text-xs font-mono text-slate-400">CHORD ACTIVE:</span>
            <span className="text-base font-bold text-amber-400 min-w-8">
              {currentActiveChord ? `${currentActiveChord} Major` : "None (Lepas)"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}


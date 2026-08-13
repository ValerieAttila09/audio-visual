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

export default function GestureChordTracker() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const handLandmarkerRef = useRef<any>(null);
  const animationFrameRef = useRef<number | null>(null);

  const chordPlayerRef = useRef<ChordPlayer | null>(null);
  const activeChordRef = useRef<string | null>(null);
  const lastTriggerTimeRef = useRef<number>(0);

  const gestureHistoryRef = useRef<Array<{ left: FingerState; right: FingerState }>>([]);

  const [appState, setAppState] = useState<AppState>("IDLE");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [currentActiveChord, setCurrentActiveChord] = useState<string | null>(null);

  const [leftCount, setLeftCount] = useState<number>(0);
  const [rightCount, setRightCount] = useState<number>(0);

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

    if (countRight === 1) {
      if (countLeft === 1) return "Cmaj";
      if (countLeft === 2 && !isLeftIndexPinky) return "Dmaj";
      if (countLeft === 3 && !isLeftIndexPinkyPlusAny) return "Emaj";
      if (countLeft === 4) return "Fmaj";
      if (countLeft === 5) return "Gmaj";
      if (isLeftIndexPinky) return "Amaj";
      if (isLeftIndexPinkyPlusAny) return "Bmaj";
    }

    if (countRight === 2) {
      if (countLeft === 1) return "Cmin";
      if (countLeft === 2 && !isLeftIndexPinky) return "Dmin";
      if (countLeft === 3 && !isLeftIndexPinkyPlusAny) return "Emin";
      if (countLeft === 4) return "Fmin";
      if (countLeft === 5) return "Gmin";
      if (isLeftIndexPinky) return "Amin";
      if (isLeftIndexPinkyPlusAny) return "Bmin";
    }

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
      setStatusMessage("2/3 Loading Audio Tracks...");
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

        // Auto Resize Canvas Sesuai Ukuran Layar/Window
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

        // Render Kamera Mirror secara Full Screen (Cover)
        ctx.save();
        ctx.scale(-1, 1);
        
        // Menjaga Aspek Rasio Video Kamera saat Digambar ke Canvas Layar Penuh
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

        let rawLeftState: FingerState = { thumb: false, index: false, middle: false, ring: false, pinky: false };
        let rawRightState: FingerState = { thumb: false, index: false, middle: false, ring: false, pinky: false };

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
            const handedness = handResults.handedness[i]?.[0]?.categoryName;

            ctx.strokeStyle = handedness === "Left" ? "#3B82F6" : "#10B981";
            ctx.lineWidth = 3;

            for (const [start, end] of HAND_CONNECTIONS) {
              const p1 = landmarks[start];
              const p2 = landmarks[end];
              if (p1 && p2) {
                // Pemetaan koordinat landmark ke skala canvas full screen
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
            }
          }
        }

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
          if (
            activeChordRef.current !== detectedChord ||
            now - lastTriggerTimeRef.current > COOLDOWN_MS
          ) {
            activeChordRef.current = detectedChord;
            setCurrentActiveChord(detectedChord);
            lastTriggerTimeRef.current = now;

            if (chordPlayerRef.current) {
              chordPlayerRef.current.playChord(detectedChord);
            }
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

        // Overlay Status UI pada Posisi Kiri Atas Screen
        ctx.save();
        ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
        ctx.fillRect(24, 24, 320, 105);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
        ctx.strokeRect(24, 24, 320, 105);

        ctx.fillStyle = "#FFFFFF";
        ctx.font = "bold 14px Inter, sans-serif";
        ctx.fillText(`Jari Tangan Kiri  : ${activeLeftFingers} Jari`, 40, 52);
        ctx.fillText(`Jari Tangan Kanan : ${activeRightFingers} Jari`, 40, 76);
        ctx.fillText(
          `Mode Playback     : ${activeRightFingers === 1 ? "Major (1 Kanan)" : activeRightFingers === 2 ? "Minor (2 Kanan)" : "Menunggu..."}`,
          40,
          100
        );
        ctx.restore();

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

  return (
    <div className="fixed inset-0 w-screen h-screen bg-slate-950 overflow-hidden z-50">
      <video ref={videoRef} style={{ display: "none" }} playsInline muted />

      <div className="relative w-full h-full bg-slate-900 flex items-center justify-center">
        <canvas ref={canvasRef} className="w-full h-full block" />

        {appState === "IDLE" && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-md p-6 text-center">
            <div className="w-16 h-16 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center mb-4 ring-1 ring-amber-500/40 animate-pulse">
              <svg className="w-8 h-8 fill-current" viewBox="0 0 24 24">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            </div>
            <h2 className="text-3xl font-bold text-white mb-2 tracking-tight">
              Gesture Chord Player (Full Screen)
            </h2>
            <p className="text-slate-400 max-w-lg mb-8 text-sm leading-relaxed">
              Tampilkan kombinasi jari tangan kiri &amp; kanan pada kamera untuk memicu nada chord secara langsung di seluruh layar.
            </p>
            <button
              onClick={handleStart}
              className="px-8 py-3.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-semibold rounded-full shadow-lg shadow-amber-500/25 transition duration-200 transform hover:scale-105 active:scale-95 flex items-center gap-2"
            >
              <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              MULAI FULL SCREEN
            </button>
          </div>
        )}

        {appState !== "IDLE" && appState !== "READY" && appState !== "ERROR" && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-md p-6 text-center">
            <div className="w-12 h-12 border-4 border-amber-500/30 border-t-amber-500 rounded-full animate-spin mb-4" />
            <p className="text-lg font-medium text-amber-400 mb-1">{statusMessage}</p>
          </div>
        )}

        {appState === "ERROR" && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-md p-6 text-center">
            <p className="text-red-400 font-semibold mb-2">{errorMessage}</p>
            <button
              onClick={handleStart}
              className="mt-2 px-6 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-medium transition"
            >
              Coba Lagi
            </button>
          </div>
        )}

        {appState === "READY" && (
          <div className="absolute top-6 right-6 z-10 flex items-center gap-3 bg-slate-900/80 backdrop-blur border border-slate-700/60 rounded-xl px-5 py-2.5 text-white shadow-xl">
            <div
              className={`w-3.5 h-3.5 rounded-full ${
                currentActiveChord ? "bg-amber-500 animate-ping" : "bg-emerald-500"
              }`}
            />
            <span className="text-xs font-mono text-slate-400">CHORD AKTIF:</span>
            <span className="text-xl font-bold text-amber-400 min-w-16">
              {currentActiveChord ? currentActiveChord : "None"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
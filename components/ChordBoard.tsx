"use client";

import React, { useEffect, useRef } from "react";
import chordsJson from "./chords.json";

type ChordBoardItem = {
  key: string; // C, D, ...
  variants: string[];
  x: number;
  y: number;
  r: number;
};

export default function ChordBoard() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handRef = useRef<any>(null);
  const animationRef = useRef<number | null>(null);

  // chord buttons will be computed based on canvas size
  const boardRef = useRef<ChordBoardItem[]>([]);

  useEffect(() => {
    let mounted = true;

    async function setup() {
      if (typeof window === "undefined") return;

      const video = videoRef.current!;
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;

      // start camera
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;
        video.muted = true;
        video.autoplay = true;
        video.playsInline = true;
        await video.play().catch((e) => console.warn("video.play failed:", e));
      } catch (e) {
        console.error("camera error:", e);
        return;
      }

      // load hand landmarker dynamically
      let FilesetResolver: any, HandLandmarker: any;
      try {
        const tasksVision = await import("@mediapipe/tasks-vision");
        FilesetResolver = tasksVision.FilesetResolver;
        HandLandmarker = tasksVision.HandLandmarker;
      } catch (e) {
        console.error("Failed to import tasks-vision:", e);
        return;
      }

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
      handRef.current = handLandmarker;

      // helper: build chord board layout
      function layoutBoard() {
        const pad = 24;
        const width = canvas.width;
        const height = canvas.height;
        const keys = Object.keys(chordsJson);
        const n = keys.length;
        const radius = Math.min(48, Math.floor(width / (n * 2.5)));
        boardRef.current = keys.map((k, i) => {
          const spacing = width / (n + 1);
          const x = Math.round(spacing * (i + 1));
          const y = height - 120; // near bottom
          return { key: k, variants: chordsJson[k], x, y, r: radius };
        });
      }

      // initial layout after video size known
      const ensureSizeAndLayout = () => {
        if (!video.videoWidth || !video.videoHeight) return false;
        // use video size for canvas
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        layoutBoard();
        return true;
      };

      // wait until video metadata available
      if (!ensureSizeAndLayout()) {
        await new Promise((res) => {
          const t = () => {
            if (ensureSizeAndLayout()) {
              video.removeEventListener("loadedmetadata", t);
              res(null);
            }
          };
          video.addEventListener("loadedmetadata", t);
        });
      }

      // pinch detection params
      const PINCH_THRESHOLD = 0.06; // normalized distance

      // frame loop
      const frame = () => {
        if (!mounted) return;
        if (!video || !canvas) return;
        const w = canvas.width;
        const h = canvas.height;

        // draw mirrored video (mirror so user's left/right match screen)
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(video, -w, 0, w, h);
        ctx.restore();

        // get hand results
        let handResults: any = null;
        try {
          handResults = handRef.current?.detectForVideo(video, performance.now());
        } catch (e) {
          // ignore
        }

        // default no hover
        let hovered: ChordBoardItem | null = null;
        let pinchNow = false;

        if (handResults && handResults.landmarks && handResults.landmarks.length > 0) {
          // use first hand for virtual mouse
          const lm = handResults.landmarks[0];
          // Mediapipe landmarks: 4 = thumb tip, 8 = index fingertip
          const thumb = lm[4];
          const index = lm[8];

          const dx = thumb.x - index.x;
          const dy = thumb.y - index.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          pinchNow = dist < PINCH_THRESHOLD;

          // visual point (mirrored): x_visual = width - (index.x * w)
          const px = w - index.x * w;
          const py = index.y * h;

          // debug crosshair
          ctx.fillStyle = "rgba(255,255,255,0.9)";
          ctx.beginPath();
          ctx.arc(px, py, 6, 0, Math.PI * 2);
          ctx.fill();

          // collision detection against board buttons
          for (const item of boardRef.current) {
            const d = Math.hypot(px - item.x, py - item.y);
            if (d <= item.r) {
              hovered = item;
              break;
            }
          }
        }

        // draw chord buttons (canvas-only UI)
        for (const item of boardRef.current) {
          // base style
          ctx.save();
          ctx.beginPath();
          ctx.fillStyle = hovered === item ? "#ffcc00" : "rgba(0,0,0,0.45)";
          ctx.strokeStyle = "rgba(255,255,255,0.15)";
          ctx.lineWidth = 2;
          // rounded rect simulated by arc+rect
          ctx.arc(item.x, item.y, item.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          // label
          ctx.fillStyle = "#000";
          ctx.font = `${Math.max(18, item.r / 1.8)}px Arial`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(item.key, item.x, item.y);
          ctx.restore();
        }

        // if pinch over a hovered button => show chord name text
        if (pinchNow && hovered) {
          ctx.save();
          ctx.fillStyle = "rgba(0,0,0,0.6)";
          ctx.fillRect(20, 20, 240, 56);
          ctx.fillStyle = "#fff";
          ctx.font = "20px Arial";
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(`Pinch on: ${hovered.key}`, 30, 48);
          ctx.restore();
        }

        animationRef.current = requestAnimationFrame(frame);
      };

      animationRef.current = requestAnimationFrame(frame);
    }

    setup();

    return () => {
      mounted = false;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (handRef.current && typeof handRef.current.close === "function") {
        try {
          handRef.current.close();
        } catch (e) {
          console.warn(e);
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
    <div style={{ position: "relative" }}>
      <video ref={videoRef} style={{ display: "none" }} playsInline muted />
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "auto", display: "block" }}
      />
    </div>
  );
}

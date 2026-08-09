"use client";

import React, { useEffect, useRef } from "react";
import {
  FilesetResolver,
  HandLandmarker,
  DrawingUtils,
} from "@mediapipe/tasks-vision";

export default function HandTracker() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handLandmarkerRef = useRef<any>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function initHandLandmarker() {
      try {
        // Load the model files
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

        if (!isMounted) return;
        handLandmarkerRef.current = handLandmarker;

        // Start webcam
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // enable autoplay-friendly attributes
          videoRef.current.muted = true;
          videoRef.current.autoplay = true;
          videoRef.current.playsInline = true;

          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play().catch((e) => {
              console.warn("video.play() failed:", e);
            });
            detectHands();
          };
        }
      } catch (err) {
        console.error("Error initializing Hand Landmarker:", err);
      }
    }

    async function detectHands() {
      if (!videoRef.current || !handLandmarkerRef.current) return;

      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;
      const drawingUtils = new DrawingUtils(ctx);

      const processFrame = () => {
        if (!canvas || !videoRef.current) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;

        try {
          const results = handLandmarkerRef.current.detectForVideo(
            videoRef.current,
            performance.now()
          );

          if (results && results.landmarks) {
            for (const landmarks of results.landmarks) {
              drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
                color: "#00FF00",
                lineWidth: 2,
              });
              drawingUtils.drawLandmarks(landmarks, {
                color: "#FF0000",
                lineWidth: 1,
              });
            }
          }
        } catch (e) {
          // sometimes the detector isn't ready yet
          console.error("Hand detection error:", e);
        }

        animationFrameRef.current = requestAnimationFrame(processFrame);
      };

      processFrame();
    }

    initHandLandmarker();

    return () => {
      isMounted = false;
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (handLandmarkerRef.current && typeof handLandmarkerRef.current.close === "function") {
        try {
          handLandmarkerRef.current.close();
        } catch (e) {
          console.warn("Error closing handLandmarker:", e);
        }
      }
      // stop tracks
      if (videoRef.current && videoRef.current.srcObject instanceof MediaStream) {
        const st = videoRef.current.srcObject as MediaStream;
        st.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  return (
    <div style={{ position: "relative" }}>
      <video
        ref={videoRef}
        style={{ transform: "scaleX(-1)", width: "100%", height: "auto" }}
        playsInline
        muted
      />
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          transform: "scaleX(-1)",
          width: "100%",
          height: "auto",
        }}
      />
    </div>
  );
}

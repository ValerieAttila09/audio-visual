"use client";

import React, { useEffect, useRef } from "react";

export default function CombinedTracker() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const faceMeshRef = useRef<any>(null);
  const handLandmarkerRef = useRef<any>(null);
  const faceResultsRef = useRef<any>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;

    async function setup() {
      if (typeof window === "undefined") return;

      try {
        // Start camera once
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        const video = videoRef.current!;
        video.srcObject = stream;
        video.muted = true;
        video.autoplay = true;
        video.playsInline = true;

        await video.play().catch((e) => {
          console.warn("video.play() failed:", e);
        });

        // Dynamically import mediapipe modules
        const [cameraUtilsMod, faceMeshMod, tasksVisionMod] = await Promise.all([
          import("@mediapipe/camera_utils"),
          import("@mediapipe/face_mesh"),
          import("@mediapipe/tasks-vision"),
        ]);

        // Resolve FaceMesh constructor robustly
        const globalAny = window as any;
        const FaceMeshCtor =
          globalAny.FaceMesh ||
          faceMeshMod?.FaceMesh ||
          faceMeshMod?.default?.FaceMesh ||
          faceMeshMod?.default ||
          globalAny.faceMesh ||
          (globalAny.mediapipe && globalAny.mediapipe.FaceMesh);

        if (!FaceMeshCtor || typeof FaceMeshCtor !== "function") {
          console.error("Could not resolve FaceMesh constructor:", faceMeshMod, globalAny);
          return;
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
          // store results for drawing in the frame loop
          faceResultsRef.current = results;
        });

        // Initialize hand landmarker (tasks-vision)
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

        const drawingUtils = new DrawingUtils();

        // Frame loop: await faceMesh.send so faceResultsRef is updated, then run hand detector, then draw both
        const processFrame = async () => {
          if (!mounted) return;
          const videoEl = videoRef.current;
          const canvas = canvasRef.current;
          if (!videoEl || !canvas) return;

          // ensure canvas matches video size
          if (canvas.width !== videoEl.videoWidth || canvas.height !== videoEl.videoHeight) {
            canvas.width = videoEl.videoWidth;
            canvas.height = videoEl.videoHeight;
          }

          // ask faceMesh to process this frame
          try {
            await faceMesh.send({ image: videoEl });
          } catch (e) {
            // faceMesh may throw if not ready; ignore and continue
            // console.warn("faceMesh.send error:", e);
          }

          // run hand landmarker
          let handResults = null;
          try {
            handResults = handLandmarker.detectForVideo(videoEl, performance.now());
          } catch (e) {
            // ignore transient errors
            // console.warn("handLandmarker error:", e);
          }

          // draw video frame first
          const ctx = canvas.getContext("2d")!;
          ctx.save();
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

          // draw face landmarks if available
          const faceResults = faceResultsRef.current;
          if (faceResults && faceResults.multiFaceLandmarks) {
            ctx.fillStyle = "red";
            for (const landmarks of faceResults.multiFaceLandmarks) {
              for (const point of landmarks) {
                const x = point.x * canvas.width;
                const y = point.y * canvas.height;
                ctx.beginPath();
                ctx.arc(x, y, 1.5, 0, 2 * Math.PI);
                ctx.fill();
              }
            }
          }

          // draw hand landmarks
          if (handResults && handResults.landmarks) {
            // DrawingUtils from tasks-vision expects a ctx passed during creation; some versions accept an instance method
            try {
              // If drawingUtils requires ctx at construction, we created it without ctx above; attempt to draw using provided helpers
              // drawConnectors and drawLandmarks might be functions on DrawingUtils prototype
              if (drawingUtils.drawConnectors) {
                for (const landmarks of handResults.landmarks) {
                  drawingUtils.drawConnectors(ctx, landmarks, handLandmarkerRef.current.HAND_CONNECTIONS, {
                    color: "#00FF00",
                    lineWidth: 2,
                  });
                  drawingUtils.drawLandmarks(ctx, landmarks, {
                    color: "#FF0000",
                    lineWidth: 1,
                  });
                }
              } else {
                // Fallback: draw small circles
                ctx.fillStyle = "#00FF00";
                for (const landmarks of handResults.landmarks) {
                  for (const pt of landmarks) {
                    const x = pt.x * canvas.width;
                    const y = pt.y * canvas.height;
                    ctx.beginPath();
                    ctx.arc(x, y, 2, 0, 2 * Math.PI);
                    ctx.fill();
                  }
                }
              }
            } catch (e) {
              // last-resort fallback drawing
              ctx.fillStyle = "#00FF00";
              for (const landmarks of handResults.landmarks) {
                for (const pt of landmarks) {
                  const x = pt.x * canvas.width;
                  const y = pt.y * canvas.height;
                  ctx.beginPath();
                  ctx.arc(x, y, 2, 0, 2 * Math.PI);
                  ctx.fill();
                }
              }
            }
          }

          ctx.restore();

          animationFrameRef.current = requestAnimationFrame(processFrame);
        };

        // start loop
        animationFrameRef.current = requestAnimationFrame(processFrame);
      } catch (err) {
        console.error("CombinedTracker setup error:", err);
      }
    }

    setup();

    return () => {
      mounted = false;
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);

      // close/cleanup detectors
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

      // stop media tracks
      if (videoRef.current && videoRef.current.srcObject instanceof MediaStream) {
        const st = videoRef.current.srcObject as MediaStream;
        st.getTracks().forEach((t) => t.stop());
        videoRef.current.srcObject = null;
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
        style={{ position: "absolute", top: 0, left: 0, transform: "scaleX(-1)", width: "100%", height: "auto" }}
      />
    </div>
  );
}

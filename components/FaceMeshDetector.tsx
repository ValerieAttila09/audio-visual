"use client";

import React, { useEffect, useRef } from "react";

export default function FaceMeshDetector() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cameraInstance: any = null;

    if (typeof window !== "undefined") {
      (async () => {
        const [cameraMod, faceMeshMod] = await Promise.all([
          import("@mediapipe/camera_utils"),
          import("@mediapipe/face_mesh"),
        ]);
        const globalAny = window as any;
        const Camera =
          globalAny.Camera ||
          cameraMod?.Camera ||
          cameraMod?.default?.Camera ||
          globalAny.camera_utils ||
          globalAny.cameraUtils;

        let FaceMesh: any =
          globalAny.FaceMesh ||
          faceMeshMod?.FaceMesh ||
          faceMeshMod?.default?.FaceMesh ||
          faceMeshMod?.default ||
          globalAny.faceMesh ||
          (globalAny.mediapipe && globalAny.mediapipe.FaceMesh);
        if (!FaceMesh || typeof FaceMesh !== "function") {
          FaceMesh =
            (globalAny.faceMesh && globalAny.faceMesh.FaceMesh) ||
            (faceMeshMod && faceMeshMod.FaceMesh) ||
            (faceMeshMod && faceMeshMod.default && faceMeshMod.default.FaceMesh);
        }

        if (!FaceMesh || typeof FaceMesh !== "function") {
          console.error("Could not find FaceMesh constructor.", faceMeshMod, globalAny);
          return;
        }

        const faceMesh = new FaceMesh({
          locateFile: (file: string) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
        });

        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        faceMesh.onResults((results: any) => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          const canvasCtx = canvas.getContext("2d");
          if (!canvasCtx) return;

          canvasCtx.save();
          canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
          canvasCtx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

          if (results.multiFaceLandmarks) {
            canvasCtx.fillStyle = "red";
            results.multiFaceLandmarks.forEach((landmarks: any[]) => {
              landmarks.forEach((point: any) => {
                canvasCtx.beginPath();
                canvasCtx.arc(point.x * canvas.width, point.y * canvas.height, 1.5, 0, 2 * Math.PI);
                canvasCtx.fill();
              });
            });
          }
          canvasCtx.restore();
        });

        if (!Camera) {
          console.error("Could not find Camera constructor.", cameraMod, globalAny);
          return;
        }
        if (videoRef.current) {
          try {
            videoRef.current.muted = true;
            videoRef.current.autoplay = true;
            videoRef.current.playsInline = true;
          } catch (e) {
            // ignore
          }

          cameraInstance = new Camera(videoRef.current, {
            onFrame: async () => {
              if (videoRef.current) {
                await faceMesh.send({ image: videoRef.current });
              }
            },
            width: 640,
            height: 480,
          });
          cameraInstance.start();
        }
      })();
    }

    return () => {
      if (cameraInstance) {
        cameraInstance.stop();
      }
    };
  }, []);

  return (
    <div style={{ position: "relative" }}>
      <video ref={videoRef} style={{ display: "none" }} playsInline muted autoPlay />
      <canvas ref={canvasRef} width={640} height={480} />
    </div>
  );
}


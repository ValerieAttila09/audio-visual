"use client"; // Ensure this runs only on the client in Next.js 13+

import React, { useEffect, useRef } from "react";

export default function FaceMeshDetector() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    let cameraInstance;

    // Ensure this runs only in the browser
    if (typeof window !== "undefined") {
      (async () => {
        // Load mediapipe UMD bundles which attach globals to window
        const [cameraMod, faceMeshMod, handLandMarker] = await Promise.all([
          import("@mediapipe/camera_utils"),
          import("@mediapipe/face_mesh"),
        ]);
        const globalAny = window as any;
        const Camera = globalAny.Camera || cameraMod?.Camera || cameraMod?.default?.Camera || globalAny.camera_utils || globalAny.cameraUtils;

        // Resolve FaceMesh constructor from globals or module exports (UMD sometimes attaches to window as a namespace)
        let FaceMesh: any = globalAny.FaceMesh || faceMeshMod?.FaceMesh || faceMeshMod?.default?.FaceMesh || faceMeshMod?.default || globalAny.faceMesh || globalAny.mediapipe && globalAny.mediapipe.FaceMesh;
        if (!FaceMesh || typeof FaceMesh !== "function") {
          // If it's a namespace object (e.g., window.faceMesh.FaceMesh), try that
          FaceMesh = (globalAny.faceMesh && globalAny.faceMesh.FaceMesh) || (faceMeshMod && faceMeshMod.FaceMesh) || (faceMeshMod && faceMeshMod.default && faceMeshMod.default.FaceMesh);
        }

        if (!FaceMesh || typeof FaceMesh !== "function") {
          console.error("Could not find FaceMesh constructor.", faceMeshMod, globalAny);
          return;
        }

        const faceMesh = new FaceMesh({
          locateFile: (file) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
        });

        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        faceMesh.onResults((results) => {
          const canvasCtx = canvasRef.current.getContext("2d");
          canvasCtx.save();
          canvasCtx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
          canvasCtx.drawImage(
            results.image,
            0,
            0,
            canvasRef.current.width,
            canvasRef.current.height
          );

          // Draw landmarks
          if (results.multiFaceLandmarks) {
            canvasCtx.fillStyle = "red";
            results.multiFaceLandmarks.forEach((landmarks) => {
              landmarks.forEach((point) => {
                canvasCtx.beginPath();
                canvasCtx.arc(point.x * canvasRef.current.width, point.y * canvasRef.current.height, 1.5, 0, 2 * Math.PI);
                canvasCtx.fill();
              });
            });
          }
          canvasCtx.restore();
        });

        // Start camera
        if (!Camera) {
          console.error("Could not find Camera constructor.", cameraMod, globalAny);
          return;
        }
        if (videoRef.current) {
                  // Allow autoplay without user interaction by muting the video and enabling autoplay/playsInline
                  try {
                    videoRef.current.muted = true;
                    videoRef.current.autoplay = true;
                    videoRef.current.playsInline = true;
                  } catch (e) {
                    // ignore if properties can't be set
                  }

                  cameraInstance = new Camera(videoRef.current, {
                    onFrame: async () => {
                      await faceMesh.send({ image: videoRef.current });
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
      <video ref={videoRef} style={{ display: "none" }} playsInline muted autoPlay></video>
      <canvas ref={canvasRef} width={640} height={480} />
    </div>
  );
}

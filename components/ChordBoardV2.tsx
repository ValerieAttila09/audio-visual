"use client";

import React, { useEffect, useRef, useState } from "react";
import chordsJson from "./chords.json";
import { ChordPlayer } from "@/audio/ChordPlayer";

type FingerState = {
  thumb: boolean;
  index: boolean;
  middle: boolean;
  ring: boolean;
  pinky: boolean;
};

export default function ChordBoardV2() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handRef = useRef<any>(null);
  const animationRef = useRef<number | null>(null);
  const chordPlayerRef = useRef<any | null>(null);
  const lastTriggerRef = useRef<Record<string, number>>({});

  // chord sequences for UI rows
  const majorSequence = ["Cmaj", "Dmaj", "Emaj", "Fmaj", "Gmaj", "Amaj", "Bmaj"];
  const minorSequence = ["Cmin", "Dmin", "Emin", "Fmin", "Gmin", "Amin", "Bmin"];

  const [started, setStarted] = useState(false);

  async function handleStart() {
    try {
      if (!chordPlayerRef.current) chordPlayerRef.current = new ChordPlayer();
      await chordPlayerRef.current.resumeAudioContext();
      await chordPlayerRef.current.loadAll();
      setStarted(true);
    } catch (e) {
      console.error("Failed to start audio:", e);
      setStarted(true); // still proceed to setup camera even if audio failed
    }
  }

  useEffect(() => {
    let mounted = true;

    // map rules to chord names
    function detectChordFromFingerStates(left: FingerState, right: FingerState) {
      // helper counts
      const countLeft = Object.values(left).filter(Boolean).length;
      const countRight = Object.values(right).filter(Boolean).length;

      // helper for special patterns
      const leftIndexPinky = left.index && left.pinky && !left.middle && !left.ring;
      const leftIndexPinkyPlusAny = left.index && left.pinky && (left.middle || left.ring || left.thumb);

      // Major mapping
      if (countRight === 1) {
        if (countLeft === 1) return "Cmaj";
        if (countLeft === 2 && !leftIndexPinky) return "Dmaj";
        if (countLeft === 3 && !leftIndexPinky) return "Emaj";
        if (countLeft === 4) return "Fmaj";
        if (countLeft === 5) return "Gmaj";
        if (leftIndexPinky && countLeft === 2) return "Amaj"; // index+pinky
        if (leftIndexPinkyPlusAny && countLeft >= 3) return "Bmaj";
      }
      // Minor mapping (right has 2 fingers)
      if (countRight === 2) {
        if (countLeft === 1) return "Cmin";
        if (countLeft === 2 && !leftIndexPinky) return "Dmin";
        if (countLeft === 3 && !leftIndexPinky) return "Emin";
        if (countLeft === 4) return "Fmin";
        if (countLeft === 5) return "Gmin";
        if (leftIndexPinky && countLeft === 2) return "Amin";
        if (leftIndexPinkyPlusAny && countLeft >= 3) return "Bmin";
      }

      return null;
    }

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

      // load hand landmarker dynamically (setup proceeds after user started)
      // chordPlayerRef should be initialized by handleStart() prior to starting setup

      // if user didn't click Start, do not proceed
      if (!started) return;
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

      const ensureSizeAndLayout = () => {
        if (!video.videoWidth || !video.videoHeight) return false;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        return true;
      };

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

      function isFingerExtended(lm: any, tipIdx: number, pipIdx: number) {
        // For fingers except thumb: tip.y < pip.y means extended (camera coordinates: y increases down)
        return lm[tipIdx].y < lm[pipIdx].y;
      }

      function isThumbExtended(lm: any) {
        // Thumb: compare tip.x and ip/x for handedness; approximate: tip.x < ip.x for right hand non-mirrored
        // We'll judge extension by distance between tip and wrist in x/y
        const tip = lm[4];
        const ip = lm[3];
        return Math.abs(tip.x - ip.x) > 0.03; // heuristic
      }

      function computeHandFingerState(lm: any): FingerState {
        return {
          thumb: isThumbExtended(lm),
          index: isFingerExtended(lm, 8, 6),
          middle: isFingerExtended(lm, 12, 10),
          ring: isFingerExtended(lm, 16, 14),
          pinky: isFingerExtended(lm, 20, 18),
        };
      }

      // compute rotation of right hand: angle between index and wrist
      function handRotationDeg(lm: any) {
        const wrist = lm[0];
        const index = lm[8];
        const angle = Math.atan2(index.y - wrist.y, index.x - wrist.x);
        return (angle * 180) / Math.PI; // degrees
      }

      // debounce per chord
      const TRIGGER_COOLDOWN = 700; // ms

      const frame = () => {
        if (!mounted) return;
        if (!video || !canvas) return;
        const w = canvas.width;
        const h = canvas.height;

        // draw mirrored video
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(video, -w, 0, w, h);
        ctx.restore();

        // detect hands
        let res: any = null;
        try {
          res = handRef.current.detectForVideo(video, performance.now());
        } catch (e) {
          // ignore
        }

        // default states
        let leftState: FingerState = { thumb: false, index: false, middle: false, ring: false, pinky: false };
        let rightState: FingerState = { thumb: false, index: false, middle: false, ring: false, pinky: false };
        let rightRotation = 0;

        if (res && res.landmarks && res.landmarks.length > 0) {
          // res.landmarks is array per detected hand
          // Determine hand assignment by wrist.x (normalized). wrist.x < 0.5 -> left
          for (const lm of res.landmarks) {
            const wristX = lm[0].x;
            const state = computeHandFingerState(lm);
            if (wristX < 0.5) {
              leftState = state;
            } else {
              rightState = state;
              rightRotation = handRotationDeg(lm);
            }
          }
        }

        // detect chord
        const chordName = detectChordFromFingerStates(leftState, rightState);

        // compute pitch factor from rightRotation: as hand rotates to -90 deg, increase pitch up to 1.6x
        // Map rotationDeg in range [0 .. -90] -> factor [1 .. 1.6]
        let pitchFactor = 1;
        if (rightRotation < 0) {
          const t = Math.min(Math.abs(rightRotation) / 90, 1);
          pitchFactor = 1 + 0.6 * t; // up to +60%
        }

        // draw sequences UI
        const margin = 16;
        const rowHeight = 36;
        // Major row
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(margin, margin, w - margin * 2, rowHeight + 8);
        ctx.fillStyle = "#fff";
        ctx.font = "16px Arial";
        ctx.textBaseline = "middle";
        let x = margin + 8;
        for (const ch of majorSequence) {
          const isActive = chordName === ch;
          ctx.fillStyle = isActive ? "orange" : "#ddd";
          ctx.fillText(ch, x, margin + rowHeight / 2 + 4);
          x += ctx.measureText(ch).width + 24;
        }
        ctx.restore();

        // Minor row
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(margin, margin + rowHeight + 12, w - margin * 2, rowHeight + 8);
        ctx.fillStyle = "#fff";
        ctx.font = "16px Arial";
        ctx.textBaseline = "middle";
        x = margin + 8;
        for (const ch of minorSequence) {
          const isActive = chordName === ch;
          ctx.fillStyle = isActive ? "deepskyblue" : "#ddd";
          ctx.fillText(ch, x, margin + rowHeight + 12 + rowHeight / 2 + 4);
          x += ctx.measureText(ch).width + 24;
        }
        ctx.restore();

        // show finger counts for debug
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(margin, h - 80, 260, 64);
        ctx.fillStyle = "#fff";
        ctx.font = "14px Arial";
        ctx.fillText(`Left fingers: ${Object.values(leftState).filter(Boolean).length}`, margin + 8, h - 56);
        ctx.fillText(`Right fingers: ${Object.values(rightState).filter(Boolean).length}`, margin + 8, h - 36);
        ctx.fillText(`Right rot: ${Math.round(rightRotation)}°`, margin + 140, h - 36);
        ctx.restore();

        // trigger play if chord detected
        if (chordName) {
          const now = Date.now();
          const last = lastTriggerRef.current[chordName] || 0;
          if (now - last > TRIGGER_COOLDOWN) {
            // play via central ChordPlayer
            try {
              chordPlayerRef.current?.playChord(chordName, pitchFactor);
            } catch (e) {
              console.warn("Chord play error", e);
            }
            lastTriggerRef.current[chordName] = now;
          }
        }

        animationRef.current = requestAnimationFrame(frame);
      };

      animationRef.current = requestAnimationFrame(frame);
    }

    if (started) {
      setup();
    }

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
  }, [started]);

  return (
    <div style={{ position: "relative" }}>
      <video ref={videoRef} style={{ display: "none" }} playsInline muted />
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "auto", display: "block" }}
      />

      {/* Start Overlay */}
      {!started && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", zIndex: 50 }}>
          <div style={{ textAlign: "center", color: "white" }}>
            <h2 style={{ fontSize: 20, marginBottom: 8 }}>Start Chord Tracker</h2>
            <p style={{ marginBottom: 12, color: "#cbd5e1" }}>Click to enable audio and start the tracker</p>
            <button onClick={handleStart} style={{ padding: "10px 18px", borderRadius: 999, background: "#F59E0B", color: "#041014", fontWeight: 700 }}>
              START
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

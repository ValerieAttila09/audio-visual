import CombinedTracker from "@/components/CombinedTracker";

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4 md:p-8 font-sans">
      <header className="mb-6 text-center max-w-2xl">
        <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-amber-200 to-yellow-500 mb-2">
          Audio-Visual MediaPipe Chord Player
        </h1>
        <p className="text-slate-400 text-sm">
          Tekan <strong>START</strong> untuk mengaktifkan AudioContext &amp; MediaPipe Tracker.
          Arahkan telunjuk Anda pada tombol chord C, D, E, F, G, A, B untuk memainkan nada.
        </p>
      </header>

      <main className="w-full flex justify-center">
        <CombinedTracker />
      </main>
    </div>
  );
}


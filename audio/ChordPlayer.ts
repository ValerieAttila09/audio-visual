export class ChordPlayer {
	private context: AudioContext | null = null;
	private buffers: Map<string, AudioBuffer>;
	private currentSource: AudioBufferSourceNode | null = null;
	private currentGainNode: GainNode | null = null;
	private currentChordName: string | null = null;

	constructor() {
		this.buffers = new Map();
	}

	private getOrCreateContext(): AudioContext {
		if (!this.context) {
			const AudioContextClass =
				window.AudioContext || (window as any).webkitAudioContext;
			this.context = new AudioContextClass();
		}
		return this.context;
	}

	async resumeAudioContext() {
		const ctx = this.getOrCreateContext();
		if (ctx.state === "suspended") {
			await ctx.resume();
		}
	}

	private async tryFetchChordPaths(name: string): Promise<Response | null> {
		const candidates = [
			`/audio/chords/${name}.mp3`,
			`/audio/chords/${name}.wav`,
			`/audio/chords/${name}_Major_Chord.wav`,
			`/audio/chords/${name}_major.mp3`,
		];
		for (const p of candidates) {
			try {
				const res = await fetch(p);
				if (res.ok) return res;
			} catch (e) {
				// ignore and try next
			}
		}
		return null;
	}

	async loadChord(name: string) {
		const ctx = this.getOrCreateContext();
		const response = await this.tryFetchChordPaths(name);
		if (!response) {
			throw new Error(`Failed to load chord ${name} from public/audio/chords/`);
		}
		const arrayBuffer = await response.arrayBuffer();
		const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
		this.buffers.set(name, audioBuffer);
	}

	async loadAll(onProgress?: (loaded: number, total: number) => void) {
		const roots = ["C", "D", "E", "F", "G", "A", "B"];
		const suffixes = ["maj", "min", "dim", "aug", "7"];

		const chordKeys: string[] = [];
		for (const suffix of suffixes) {
			for (const root of roots) {
				chordKeys.push(`${root}${suffix}`);
			}
		}

		let loadedCount = 0;
		for (const name of chordKeys) {
			try {
				await this.loadChord(name);
			} catch (e) {
				console.warn(`Failed to load ${name}:`, e);
			}
			loadedCount++;
			if (onProgress) onProgress(loadedCount, chordKeys.length);
		}
	}

	playChord(name: string, pitchFactor = 1) {
		const ctx = this.getOrCreateContext();
		if (ctx.state === "suspended") {
			ctx.resume();
		}

		// 1. Jika chord yang dimainkan SAMA dan audio masih jalan, cukup ubah pitch-nya secara halus
		if (this.currentChordName === name && this.currentSource && this.currentGainNode) {
			this.currentSource.playbackRate.setTargetAtTime(pitchFactor, ctx.currentTime, 0.05);
			return;
		}

		// 2. Jika chord beda, hentikan chord sebelumnya dengan Fade-Out mulus (30ms)
		this.stopChord();

		const buffer = this.buffers.get(name);
		if (!buffer) {
			console.error(`Chord ${name} not found`);
			return;
		}

		// 3. Buat Source Node & Gain Node Baru
		const source = ctx.createBufferSource();
		source.buffer = buffer;
		
		// Mengaktifkan Seamless Looping Bawaan Web Audio API
		source.loop = true;
		source.playbackRate.value = pitchFactor;

		const gainNode = ctx.createGain();
		
		// 4. Efek Fade-In Tipis (20ms) untuk mencegah suara "Klik/Pop" saat mulai
		gainNode.gain.setValueAtTime(0, ctx.currentTime);
		gainNode.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.02);

		source.connect(gainNode).connect(ctx.destination);
		source.start(0);

		this.currentSource = source;
		this.currentGainNode = gainNode;
		this.currentChordName = name;
	}

	stopChord() {
		if (this.currentSource && this.currentGainNode && this.context) {
			const ctx = this.context;
			const source = this.currentSource;
			const gainNode = this.currentGainNode;

			// Fade-Out tipis (30ms) sebelum mematikan suara agar tidak patah/pop
			try {
				gainNode.gain.setValueAtTime(gainNode.gain.value, ctx.currentTime);
				gainNode.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.03);

				setTimeout(() => {
					try {
						source.stop();
						source.disconnect();
						gainNode.disconnect();
					} catch (e) {
						// abaikan jika sudah terhenti
					}
				}, 35);
			} catch (e) {
				try {
					source.stop();
					source.disconnect();
				} catch (err) {}
			}

			this.currentSource = null;
			this.currentGainNode = null;
			this.currentChordName = null;
		}
	}
}
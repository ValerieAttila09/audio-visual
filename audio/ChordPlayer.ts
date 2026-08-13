export class ChordPlayer {
	private context: AudioContext | null = null;
	private buffers: Map<string, AudioBuffer>;
	private currentSource: AudioBufferSourceNode | null = null;

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

	// try loading common file extensions and naming conventions
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
		// load major/minor sequences used by the app
		const chordKeys = [
			"Cmaj",
			"Dmaj",
			"Emaj",
			"Fmaj",
			"Gmaj",
			"Amaj",
			"Bmaj",
			"Cmin",
			"Dmin",
			"Emin",
			"Fmin",
			"Gmin",
			"Amin",
			"Bmin",
		];
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
		this.stopChord();

		const buffer = this.buffers.get(name);
		if (!buffer) {
			console.error(`Chord ${name} not found`);
			return;
		}

		const ctx = this.getOrCreateContext();
		if (ctx.state === "suspended") {
			ctx.resume();
		}

		const source = ctx.createBufferSource();
		source.buffer = buffer;
		source.playbackRate.value = pitchFactor;
		const gain = ctx.createGain();
		gain.gain.value = 1;
		source.connect(gain).connect(ctx.destination);
		source.start();
		this.currentSource = source;
	}

	stopChord() {
		if (this.currentSource) {
			try {
				this.currentSource.stop();
				this.currentSource.disconnect();
			} catch (e) {
				// Ignore if already stopped
			}
			this.currentSource = null;
		}
	}
}

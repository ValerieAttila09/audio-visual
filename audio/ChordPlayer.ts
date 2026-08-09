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

	async loadChord(name: string) {
		const ctx = this.getOrCreateContext();
		const response = await fetch(`/audio/chords/${name}_Major_Chord.wav`);
		if (!response.ok) {
			throw new Error(
				`Failed to load chord ${name} from /audio/chords/${name}_Major_Chord.wav`
			);
		}
		const arrayBuffer = await response.arrayBuffer();
		const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
		this.buffers.set(name, audioBuffer);
	}

	async loadAll(onProgress?: (loaded: number, total: number) => void) {
		const chordKeys = ["C", "D", "E", "F", "G", "A", "B"];
		let loadedCount = 0;
		await Promise.all(
			chordKeys.map(async (name) => {
				await this.loadChord(name);
				loadedCount++;
				if (onProgress) onProgress(loadedCount, chordKeys.length);
			})
		);
	}

	playChord(name: string) {
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
		source.connect(ctx.destination);
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
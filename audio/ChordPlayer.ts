export class ChordPlayer {
	private context: AudioContext;
	private buffers: Map<String, AudioBuffer>;

	constructor() {
		this.context = new AudioContext();
		this.buffers = new Map();
	}


	async loadChord(name: string) {
		const response = await fetch(`audio/chords/${name}.wav`);
		const arrayBuffer = await response.arrayBuffer();
		const audioBuffer = await this.context.decodeAudioData(arrayBuffer);
		this.buffers.set(name, audioBuffer);
	}

	async loadAll() {
		const chords = {
			C: { chord: "C Major", path: 'audio/C_Major_Chord.wav', },
			D: { chord: "D Major", path: 'audio/D_Major_Chord.wav', },
			E: { chord: "E Major", path: 'audio/E_Major_Chord.wav', },
			F: { chord: "F Major", path: 'audio/F_Major_Chord.wav', },
			G: { chord: "G Major", path: 'audio/G_Major_Chord.wav', },
			A: { chord: "A Major", path: 'audio/A_Major_Chord.wav', },
			B: { chord: "B Major", path: 'audio/B_Major_Chord.wav', }
		}

		await Promise.all(
			Object.keys(chords).map((name)=> this.loadChord(name))
		)
	}

	playChord(name: string) {
		const buffer = this.buffers.get(name);
		if (!buffer) {
			console.error(`Chord ${name} not found`);
			return;
		}
		const source = this.context.createBufferSource();
		source.buffer = buffer;
		source.connect(this.context.destination);
		source.start();
	}
}
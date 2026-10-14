/* global AudioWorkletProcessor, registerProcessor, sampleRate */
// The mic test's rolling recording (micTest.ts): keeps the last few seconds
// of the controller's mic on the audio thread, in a ring, with no work on the
// page while testing. Any message asks for the ring, oldest sample first; it
// is posted back once (transferred, not copied). Mono: the first channel.
class MicRing extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ring = new Float32Array(Math.max(1, Math.round(options.processorOptions.seconds * sampleRate)));
    this.pos = 0;
    this.filled = 0;
    // lifetime: OK — lives with the worklet node; the AudioContext's close() ends both
    this.port.onmessage = () => {
      const n = this.filled;
      const out = new Float32Array(n);
      const start = (this.pos - n + this.ring.length) % this.ring.length;
      for (let i = 0; i < n; i++) out[i] = this.ring[(start + i) % this.ring.length];
      this.port.postMessage({ samples: out, sampleRate }, [out.buffer]);
    };
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      // loop: HOT-PATH-OK — N = 128 samples per audio quantum, a ring write, no allocation
      for (let i = 0; i < ch.length; i++) {
        this.ring[this.pos] = ch[i];
        this.pos = (this.pos + 1) % this.ring.length;
      }
      this.filled = Math.min(this.ring.length, this.filled + ch.length);
    }
    return true;
  }
}

registerProcessor("mic-ring", MicRing);

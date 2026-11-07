// Minimal Gemini Live API client (raw WebSocket, push-to-talk / manual activity detection).

const ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

function bufToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function base64ToInt16(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, bytes.length >> 1);
}

export class GeminiLive {
  /**
   * @param {{apiKey:string, model:string, voice:string, systemPrompt:string}} cfg
   * @param {{onAudio?, onInputText?, onOutputText?, onTurnComplete?, onInterrupted?, onClose?}} handlers
   */
  constructor(cfg, handlers) {
    this.cfg = cfg;
    this.h = handlers;
    this.ready = false;
    this.ws = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${ENDPOINT}?key=${encodeURIComponent(this.cfg.apiKey)}`);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      const decoder = new TextDecoder();

      ws.onopen = () => {
        const model = this.cfg.model.startsWith('models/') ? this.cfg.model : `models/${this.cfg.model}`;
        ws.send(
          JSON.stringify({
            setup: {
              model,
              generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.cfg.voice } } },
              },
              systemInstruction: { parts: [{ text: this.cfg.systemPrompt }] },
              realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              ...(this.cfg.tools ? { tools: this.cfg.tools } : {}),
            },
          }),
        );
      };

      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(typeof ev.data === 'string' ? ev.data : decoder.decode(ev.data));
        } catch {
          return;
        }
        if (msg.setupComplete) {
          this.ready = true;
          resolve(this);
          return;
        }
        if (msg.toolCall?.functionCalls?.length) this.h.onToolCall?.(msg.toolCall.functionCalls);
        const sc = msg.serverContent;
        if (!sc) return;
        if (sc.interrupted) this.h.onInterrupted?.();
        for (const part of sc.modelTurn?.parts || []) {
          if (part.inlineData?.data) this.h.onAudio?.(base64ToInt16(part.inlineData.data));
        }
        if (sc.inputTranscription?.text) this.h.onInputText?.(sc.inputTranscription.text);
        if (sc.outputTranscription?.text) this.h.onOutputText?.(sc.outputTranscription.text);
        if (sc.turnComplete) this.h.onTurnComplete?.();
      };

      ws.onerror = () => {
        /* details arrive in onclose */
      };

      ws.onclose = (ev) => {
        const wasReady = this.ready;
        this.ready = false;
        const reason =
          ev.reason || (ev.code === 1006 ? 'Network error – check your connection' : `Closed (${ev.code})`);
        if (!wasReady) reject(new Error(reason));
        else this.h.onClose?.(reason);
      };
    });
  }

  send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  startTurn() {
    this.send({ realtimeInput: { activityStart: {} } });
  }

  sendAudio(buffer) {
    this.send({ realtimeInput: { audio: { data: bufToBase64(buffer), mimeType: 'audio/pcm;rate=16000' } } });
  }

  /** @param {{id:string, name:string, response:object}[]} functionResponses */
  sendToolResponse(functionResponses) {
    this.send({ toolResponse: { functionResponses } });
  }

  endTurn() {
    this.send({ realtimeInput: { activityEnd: {} } });
  }

  close() {
    this.ready = false;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }
    this.ws = null;
  }
}

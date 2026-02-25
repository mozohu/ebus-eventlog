import { WebSocketServer } from 'ws';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { authenticateRequest } from './auth.js';

const TTS_VOICE = 'zh-TW-HsiaoChenNeural';
const MAX_TEXT_LENGTH = 4096;

export function attachTtsWebSocket(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/tts' });

  wss.on('connection', (ws, req) => {
    let authenticated = false;

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { ws.send(JSON.stringify({ type: 'error', message: 'invalid JSON' })); return; }

      // First message must be auth
      if (!authenticated) {
        if (msg.action !== 'auth' || !msg.token) {
          ws.send(JSON.stringify({ type: 'error', message: 'authenticate first: { action: "auth", token: "..." }' }));
          return;
        }
        try {
          const fakeReq = { headers: { authorization: `Bearer ${msg.token}` } };
          const user = await authenticateRequest(fakeReq);
          if (!user) throw new Error('invalid token');
          authenticated = true;
          ws.send(JSON.stringify({ type: 'auth_ok' }));
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', message: 'auth failed' }));
          ws.close();
        }
        return;
      }

      if (msg.action === 'stop') {
        ws._ttsAbort = true;
        return;
      }

      if (msg.action === 'speak') {
        const text = (msg.text || '').trim();
        if (!text) { ws.send(JSON.stringify({ type: 'error', message: 'empty text' })); return; }
        if (text.length > MAX_TEXT_LENGTH) { ws.send(JSON.stringify({ type: 'error', message: `text too long (max ${MAX_TEXT_LENGTH})` })); return; }

        ws._ttsAbort = false;

        try {
          const tts = new MsEdgeTTS();
          await tts.setMetadata(msg.voice || TTS_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, 'zh-TW');

          const { audioStream } = tts.toStream(text);

          ws.send(JSON.stringify({ type: 'start', format: 'mp3' }));

          await new Promise((resolve, reject) => {
            audioStream.on('data', (chunk) => {
              if (ws._ttsAbort || ws.readyState !== 1) { audioStream.destroy(); return; }
              ws.send(chunk);
            });
            audioStream.on('end', resolve);
            audioStream.on('error', reject);
          });

          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'end' }));
          }
        } catch (e) {
          console.error('[TTS]', e.message);
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'error', message: e.message }));
          }
        }
      }
    });
  });

  console.log('🔊 TTS WebSocket ready at /ws/tts (edge-tts)');
}

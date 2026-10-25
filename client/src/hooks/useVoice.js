import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.js';
import { SpeechError, canListen, canSpeak, listen, speak, speechLangFor, stopSpeaking } from '../lib/speech.js';

// Voice in the chat, kept simple:
//   mic button   -> speak; your words appear in the chat box as you talk, and are sent when you stop
//   speaker      -> when on, Saathi's replies are read aloud (off by default, remembered)
// `phase` drives the face: listening while you talk, speaking while a reply is read aloud.
// Browsers without speech recognition (Firefox) get no mic button; typing works as always.

const SPEAKER_KEY = 'saathi.speaker';

function readSpeaker() {
  try {
    return localStorage.getItem(SPEAKER_KEY) === '1';
  } catch {
    return false;
  }
}

export function useVoice(chat) {
  const { lang, t } = useI18n();
  const [phase, setPhase] = useState('idle'); // idle | listening | speaking
  const [interim, setInterim] = useState('');
  const [notice, setNotice] = useState(null);
  const [speakerOn, setSpeakerOnState] = useState(readSpeaker);
  const session = useRef(null);
  const speakerRef = useRef(speakerOn);
  speakerRef.current = speakerOn;

  // Leaving the screen stops the mic and any speech.
  useEffect(
    () => () => {
      session.current?.abort();
      stopSpeaking();
    },
    [],
  );

  /** Sends through the normal chat; reads the reply aloud when the speaker is on. */
  const send = useCallback(
    async (text) => {
      stopSpeaking();
      const reply = await chat.send(text, { voice: speakerRef.current });
      if (speakerRef.current && reply?.text && !reply.error) {
        setPhase('speaking');
        const spoke = await speak(reply.text, { lang: speechLangFor(reply.text, lang.speak) });
        if (!spoke) setNotice(t('voice.noVoice'));
        setPhase((p) => (p === 'speaking' ? 'idle' : p));
      }
      return reply;
    },
    [chat, lang, t],
  );

  /** Mic button: start listening, or stop and send what was heard so far. */
  const toggleListen = useCallback(async () => {
    if (session.current) return session.current.stop();
    stopSpeaking();
    setNotice(null);
    setInterim('');
    setPhase('listening');
    session.current = listen({ lang: lang.listen, onInterim: setInterim });
    let text = null;
    try {
      text = await session.current.promise;
    } catch (err) {
      const code = err instanceof SpeechError ? err.code : 'failed';
      if (code === 'denied') setNotice(t('voice.denied'));
      else if (code !== 'aborted') setNotice(t('voice.noSpeech'));
    } finally {
      session.current = null;
      setInterim('');
      setPhase('idle');
    }
    if (text) send(text);
  }, [lang, send, t]);

  const setSpeakerOn = useCallback((on) => {
    setSpeakerOnState(on);
    if (!on) stopSpeaking();
    try {
      localStorage.setItem(SPEAKER_KEY, on ? '1' : '0');
    } catch {
      /* private mode: just not remembered */
    }
  }, []);

  return { canListen, canSpeak, phase, interim, notice, speakerOn, setSpeakerOn, toggleListen, send };
}

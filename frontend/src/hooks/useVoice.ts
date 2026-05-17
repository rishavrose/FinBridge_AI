/**
 * useVoice — Speech-to-text + text-to-speech hook
 *
 * STT: Web Speech API (SpeechRecognition) — Chrome, Edge, Safari
 * TTS: Web Speech Synthesis API — all modern browsers
 *
 * Continuous mode: accumulates speech until `silenceMs` of silence,
 * then delivers the full transcript and stops.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

// Browser Speech API types (not included in all TypeScript DOM lib versions)
declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }

  interface SpeechRecognition extends EventTarget {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    maxAlternatives: number;
    onresult: ((event: SpeechRecognitionEvent) => void) | null;
    onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
    onend: (() => void) | null;
    onstart: (() => void) | null;
    start(): void;
    stop(): void;
    abort(): void;
  }

  interface SpeechRecognitionEvent extends Event {
    readonly resultIndex: number;
    readonly results: SpeechRecognitionResultList;
  }

  interface SpeechRecognitionErrorEvent extends Event {
    readonly error: string;
    readonly message: string;
  }
}

export interface UseVoiceOptions {
  /** BCP-47 language tag. Defaults to en-IN for Indian English accent. */
  lang?: string;
  /** Milliseconds of silence after last speech before auto-submitting. Default 5000. */
  silenceMs?: number;
  /** Called with the full accumulated transcript after silence timeout. */
  onTranscript: (text: string) => void;
  /** Called with live interim text while the user is still speaking. */
  onInterim?: (text: string) => void;
}

export interface UseVoiceReturn {
  // ── STT ──────────────────────────────────────────────────────────────────
  isListening: boolean;
  interimTranscript: string;
  sttSupported: boolean;
  startListening: () => void;
  stopListening: () => void;
  // ── TTS ──────────────────────────────────────────────────────────────────
  isSpeaking: boolean;
  ttsSupported: boolean;
  speak: (text: string) => void;
  cancelSpeech: () => void;
  // ── Error ─────────────────────────────────────────────────────────────────
  error: string | null;
  clearError: () => void;
}

/** Strip markdown-ish / metric-card prefixes that sound bad when spoken. */
function cleanForSpeech(text: string): string {
  return text
    .replace(/\[Tools:[^\]]*\]\n*/g, '')
    .replace(/[*_`#~]/g, '')
    .replace(/\(([^)]+)\)/g, ', $1,')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Pick the best Indian-English female voice available in the browser.
 * Priority: known Indian female names → any en-IN → en-GB female → any en.
 */
function pickIndianFemaleVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;

  // Known Indian / South-Asian female voice names across browsers & OS
  const femaleHints = ['lekha', 'heera', 'priya', 'aditi', 'divya', 'veena', 'sangita', 'zira'];
  const maleHints   = ['rishi', 'mohan', 'suresh', 'deepak', 'david', 'james', 'daniel', 'mark', 'fred', 'alex'];

  // 1. Named Indian female voices (macOS: Lekha, Windows: Heera, etc.)
  for (const hint of femaleHints) {
    const v = voices.find(v => v.name.toLowerCase().includes(hint));
    if (v) return v;
  }

  // 2. Any en-IN voice that isn't a known male name
  const enIn = voices.filter(v => v.lang === 'en-IN' || v.lang === 'en_IN');
  const enInFemale = enIn.filter(v => !maleHints.some(m => v.name.toLowerCase().includes(m)));
  if (enInFemale.length > 0) return enInFemale[0];
  if (enIn.length > 0) return enIn[0];

  // 3. Google UK English Female (clear, closest non-Indian fallback)
  const ukFemale = voices.find(v => v.name.toLowerCase().includes('uk english female'));
  if (ukFemale) return ukFemale;

  // 4. Any en-GB voice
  const enGb = voices.filter(v => v.lang.startsWith('en-GB') || v.lang.startsWith('en_GB'));
  if (enGb.length > 0) return enGb[0];

  // 5. Any English voice
  const enAny = voices.filter(v => v.lang.startsWith('en'));
  return enAny[0] ?? null;
}

export function useVoice({
  lang = 'en-IN',
  silenceMs = 5000,
  onTranscript,
  onInterim,
}: UseVoiceOptions): UseVoiceReturn {
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<SpeechRecognition | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const onInterimRef = useRef(onInterim);
  const accumulatedRef = useRef('');       // full text built across multiple sentences
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);      // true when user explicitly cancels
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);

  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  useEffect(() => { onInterimRef.current = onInterim; }, [onInterim]);

  const RecognitionCtor =
    typeof window !== 'undefined'
      ? (window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null)
      : null;

  const sttSupported = RecognitionCtor !== null;
  const ttsSupported =
    typeof window !== 'undefined' && 'speechSynthesis' in window;

  // Pre-load voices and stay updated — browsers fire onvoiceschanged once loaded
  useEffect(() => {
    if (!ttsSupported) return;
    const load = () => { voicesRef.current = window.speechSynthesis.getVoices(); };
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, [ttsSupported]);

  // ── STT ──────────────────────────────────────────────────────────────────

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current !== null) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const resetSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      // Silence timeout — stop recognition; onend will deliver the transcript
      recRef.current?.stop();
    }, silenceMs);
  }, [clearSilenceTimer, silenceMs]);

  /** Cancel without delivering any transcript. */
  const stopListening = useCallback(() => {
    cancelledRef.current = true;
    clearSilenceTimer();
    accumulatedRef.current = '';
    recRef.current?.stop();
    recRef.current = null;
    setIsListening(false);
    setInterimTranscript('');
  }, [clearSilenceTimer]);

  const startListening = useCallback(() => {
    if (!RecognitionCtor || isListening) return;
    setError(null);
    setInterimTranscript('');
    accumulatedRef.current = '';
    cancelledRef.current = false;

    const rec = new RecognitionCtor();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = true;   // keep session open across sentences
    rec.maxAlternatives = 1;

    rec.onstart = () => setIsListening(true);

    rec.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const chunk = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          // Append confirmed sentence and restart the silence countdown
          accumulatedRef.current +=
            (accumulatedRef.current ? ' ' : '') + chunk.trim();
          setInterimTranscript('');
          resetSilenceTimer();
        } else {
          interim += chunk;
        }
      }

      if (interim) {
        setInterimTranscript(interim);
        onInterimRef.current?.(interim);
      }
    };

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'aborted') return;
      if (event.error === 'no-speech') return;

      const msg =
        event.error === 'not-allowed'
          ? 'Microphone access denied — allow it in browser settings.'
          : event.error === 'network'
          ? 'Network error during voice recognition.'
          : `Voice error: ${event.error}`;
      setError(msg);
      setIsListening(false);
      setInterimTranscript('');
      recRef.current = null;
      clearSilenceTimer();
    };

    rec.onend = () => {
      clearSilenceTimer();
      setIsListening(false);
      setInterimTranscript('');
      recRef.current = null;

      // Deliver accumulated text unless the user explicitly cancelled
      if (!cancelledRef.current) {
        const text = accumulatedRef.current.trim();
        if (text) onTranscriptRef.current(text);
      }
      accumulatedRef.current = '';
      cancelledRef.current = false;
    };

    recRef.current = rec;

    try {
      rec.start();
    } catch {
      setError('Could not start microphone. Is one already in use?');
      recRef.current = null;
    }
  }, [RecognitionCtor, isListening, lang, resetSilenceTimer, clearSilenceTimer]);

  // ── TTS ──────────────────────────────────────────────────────────────────

  const speak = useCallback(
    (text: string) => {
      if (!ttsSupported) return;
      window.speechSynthesis.cancel();

      const clean = cleanForSpeech(text);
      if (!clean) return;

      const utt = new SpeechSynthesisUtterance(clean);

      // Pick best Indian female voice; fall back gracefully if none found
      const voice = pickIndianFemaleVoice(voicesRef.current);
      if (voice) {
        utt.voice = voice;
        utt.lang = voice.lang;
      } else {
        utt.lang = 'en-IN';
      }

      utt.rate = 1.0;    // natural pace — Indian voices can sound rushed at 1.1
      utt.pitch = 1.15;  // slightly higher for female tone
      utt.volume = 1;

      utt.onstart = () => setIsSpeaking(true);
      utt.onend = () => setIsSpeaking(false);
      utt.onerror = () => setIsSpeaking(false);

      window.speechSynthesis.speak(utt);
    },
    [ttsSupported],
  );

  const cancelSpeech = useCallback(() => {
    if (ttsSupported) window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, [ttsSupported]);

  // ── Cleanup ───────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      clearSilenceTimer();
      recRef.current?.stop();
      if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
    };
  }, [clearSilenceTimer]);

  return {
    isListening,
    interimTranscript,
    sttSupported,
    startListening,
    stopListening,
    isSpeaking,
    ttsSupported,
    speak,
    cancelSpeech,
    error,
    clearError: () => setError(null),
  };
}

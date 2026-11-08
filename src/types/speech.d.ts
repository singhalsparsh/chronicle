/**
 * Minimal Web Speech API typings (SpeechRecognition) for the browser-based
 * voice-to-text exit interview. Well-supported in Chromium; gracefully absent
 * in other engines (the UI falls back to typing).
 */

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  readonly results: SpeechRecognitionResultList;
  readonly resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
  onend: ((this: SpeechRecognition, ev: Event) => void) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

declare const SpeechRecognition:
  | { prototype: SpeechRecognition; new (): SpeechRecognition }
  | undefined;

declare const webkitSpeechRecognition:
  | { prototype: SpeechRecognition; new (): SpeechRecognition }
  | undefined;

interface Window {
  SpeechRecognition?: { prototype: SpeechRecognition; new (): SpeechRecognition };
  webkitSpeechRecognition?: { prototype: SpeechRecognition; new (): SpeechRecognition };
}

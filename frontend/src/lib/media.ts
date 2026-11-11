export type MediaAccess = { ok: true; audioOnly: boolean } | { ok: false; message: string };

/**
 * Asks for camera and microphone before joining a call, so the browser's
 * permission prompt appears on a click (browsers block prompts otherwise) and
 * problems are explained before the call opens. Falls back to audio only when
 * there is no camera. The test stream is stopped straight away.
 */
export async function requestMediaAccess(): Promise<MediaAccess> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    return { ok: false, message: 'Video calls need a secure (https) connection and a browser that supports them, such as a recent Chrome, Edge, Firefox or Safari.' };
  }
  try {
    stop(await navigator.mediaDevices.getUserMedia({ video: true, audio: true }));
    return { ok: true, audioOnly: false };
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      try {
        stop(await navigator.mediaDevices.getUserMedia({ audio: true }));
        return { ok: true, audioOnly: true };
      } catch {
        return { ok: false, message: 'No camera or microphone was found. Connect one and try again.' };
      }
    }
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return {
        ok: false,
        message: 'Camera and microphone access is blocked. Allow it from the camera icon in the address bar (or your browser\'s site settings), then try again.',
      };
    }
    if (name === 'NotReadableError' || name === 'AbortError') {
      return { ok: false, message: 'Your camera or microphone is being used by another app. Close it (for example another video call) and try again.' };
    }
    return { ok: false, message: 'Could not start your camera and microphone. Check your device settings and try again.' };
  }
}

function stop(stream: MediaStream) {
  stream.getTracks().forEach((t) => t.stop());
}

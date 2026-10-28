import { useEffect, useState } from 'react';
import type { UpdateState } from '../types';

export function UpdateStatus({ onError }: { onError: (message: string) => void }) {
  const [state, setState] = useState<UpdateState>({ phase: 'idle' });
  useEffect(() => {
    let active = true, receivedEvent = false;
    const unsubscribe = window.apdf.onUpdateState(next => { receivedEvent = true; if (active) setState(next); });
    void window.apdf.getUpdateState().then(next => { if (active && !receivedEvent) setState(next); }).catch(e => onError(e.message));
    return () => { active = false; unsubscribe(); };
  }, [onError]);
  if (state.phase === 'idle') return null;
  return <div className="update-status" role="status" aria-live="polite">
    {state.phase === 'checking' ? <p>Checking for updates…</p> : state.phase === 'downloading' ? <>
      <p>Downloading aPDF {state.version} · {Math.floor(state.percent || 0)}%</p>
      <progress aria-label="Update download" max={100} value={state.percent || 0} />
    </> : state.phase === 'downloaded' ? <>
      <p>aPDF {state.version} is ready to install.</p>
      <button className="secondary-button" onClick={() => { void window.apdf.checkForUpdates().catch(e => onError(e.message)); }}>Restart and install…</button>
    </> : <p>Installing update…</p>}
  </div>;
}

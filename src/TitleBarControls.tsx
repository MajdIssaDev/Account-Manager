import { useEffect, useState } from "react";

export default function TitleBarControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    void window.ram.isMaximized().then(setMaximized);
    return window.ram.onMaximized(setMaximized);
  }, []);

  return (
    <div className="win-controls">
      <button type="button" className="win-btn" title="Minimize" onClick={() => window.ram.minimize()}>
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 6.5h8" />
        </svg>
      </button>
      <button
        type="button"
        className="win-btn"
        title={maximized ? "Restore" : "Maximize"}
        onClick={() => void window.ram.toggleMaximize()}
      >
        {maximized ? (
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3.5 4.5h5v5h-5z" />
            <path d="M4.5 3.5h5v5" />
          </svg>
        ) : (
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 2.5h7v7h-7z" />
          </svg>
        )}
      </button>
      <button type="button" className="win-btn close" title="Close" onClick={() => window.ram.closeWindow()}>
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
        </svg>
      </button>
    </div>
  );
}

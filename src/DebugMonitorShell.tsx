import { lazy, Suspense, useEffect, useState } from "react";

const LazyDebugDrawer = lazy(async () => {
  try {
    return await import("./debug/DebugDrawer");
  } catch {
    return { default: () => null };
  }
});

export function DebugMonitorShell() {
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    void window.ram
      .debugIsEnabled()
      .then((on) => setAvailable(on === true))
      .catch(() => setAvailable(false));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!available) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        className="debug-fab"
        title="Debug monitor (Ctrl+Shift+D)"
        onClick={() => setOpen((v) => !v)}
      >
        DBG
      </button>
      <Suspense fallback={null}>
        <LazyDebugDrawer open={open} onClose={() => setOpen(false)} />
      </Suspense>
    </>
  );
}

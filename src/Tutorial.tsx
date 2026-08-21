import { useEffect, useState, type CSSProperties } from "react";

export type TutorialStep = {
  target: string;
  title: string;
  body: string;
};

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    target: "add-account",
    title: "Add an account",
    body: "Start here. Paste a .ROBLOSECURITY cookie, sign in, sign up, or use quick add. Sessions stay on this PC.",
  },
  {
    target: "settings",
    title: "Settings",
    body: "Set the Roblox Player path, Potassium attach, GitHub token for updates, and pick a color theme.",
  },
  {
    target: "updates",
    title: "Updates",
    body: "This chip shows the current version. Click it to check GitHub. Newer versions replace files in this install and ask you to restart — no Setup wizard.",
  },
  {
    target: "attach",
    title: "Potassium attach",
    body: "When this is on, a successful launch tries to attach Potassium to that Roblox process if Potassium is already running.",
  },
  {
    target: "labels",
    title: "Labels",
    body: "Filter the grid from this sidebar. Select more than one label to show accounts that have any of them (OR).",
  },
  {
    target: "inactive",
    title: "Inactive accounts",
    body: "Inactive accounts are hidden from the grid. Click Show Inactive to reveal them. Click it alone, with no labels, to see every inactive account.",
  },
  {
    target: "create-label",
    title: "Your own labels",
    body: "Main and Alt ship by default. Use the + next to Labels, or right-click a card → Add label → New label. Double-click a label to rename it; the color dots cycle palettes.",
  },
  {
    target: "cards",
    title: "Account cards",
    body: "Click a card to select it. Ctrl+click adds or removes one. Shift+click selects a range, left-to-right then top-to-bottom. Right-click opens actions without changing the selection.",
  },
  {
    target: "launch-selected",
    title: "Launch selected",
    body: "When several cards are selected, a Launch selected bar floats over the bottom of the grid so the cards do not jump. Right-click the selection for labels, inactive/active, and remove.",
  },
  {
    target: "help",
    title: "Replay this tutorial",
    body: "The (i) button opens this walkthrough again. Finishing it once is enough — later app updates will not show it on launch.",
  },
];

type Hole = {
  top: number;
  left: number;
  width: number;
  height: number;
  radius: string;
};

function measureHole(target: string): Hole | null {
  const el = document.querySelector(`[data-tour="${target}"]`);
  if (!(el instanceof HTMLElement)) {
    return null;
  }
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = r.left;
  let top = r.top;
  let right = r.right;
  let bottom = r.bottom;
  let radius = getComputedStyle(el).borderRadius || "0px";

  if (target === "cards") {
    left = r.left;
    top = r.top;
    right = vw;
    bottom = vh;
    radius = "0px";
  } else if (target === "labels") {
    left = 0;
    top = r.top;
    right = r.right;
    bottom = vh;
    radius = "0px";
  }

  left = Math.max(0, Math.round(left));
  top = Math.max(0, Math.round(top));
  right = Math.min(vw, Math.round(right));
  bottom = Math.min(vh, Math.round(bottom));

  return {
    top,
    left,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    radius,
  };
}

export default function Tutorial(props: {
  steps?: TutorialStep[];
  allowSkip?: boolean;
  onEnd: () => void;
}) {
  const steps = props.steps || TUTORIAL_STEPS;
  const [index, setIndex] = useState(0);
  const [hole, setHole] = useState<Hole | null>(null);

  const step = steps[index];
  const last = index === steps.length - 1;
  const allowSkip = props.allowSkip !== false;

  useEffect(() => {
    const measure = () => setHole(measureHole(step.target));
    measure();
    const timer = window.setInterval(measure, 120);
    const ro = new ResizeObserver(measure);
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (el) {
      ro.observe(el);
    }
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearInterval(timer);
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step.target]);

  const tipStyle = (): CSSProperties => {
    if (!hole) {
      return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
    }
    const gap = 12;
    const cardW = Math.min(340, window.innerWidth - 24);
    const cardH = 200;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (hole.width > 280 && hole.height > 220) {
      return {
        top: Math.min(hole.top + 16, vh - cardH - 12),
        left: Math.min(Math.max(hole.left + 16, 12), vw - cardW - 12),
        width: cardW,
      };
    }
    const below = hole.top + hole.height + gap;
    const top = vh - below > cardH + 16 ? below : Math.max(12, hole.top - cardH - gap);
    const left = Math.min(Math.max(12, hole.left), vw - cardW - 12);
    return { top, left, width: cardW };
  };

  return (
    <div className="tour">
      {!hole && <div className="tour-dim" />}
      {hole && (
        <div
          className="tour-hole"
          style={{
            top: hole.top,
            left: hole.left,
            width: hole.width,
            height: hole.height,
            borderRadius: hole.radius,
          }}
        />
      )}
      <div className="tour-card" style={tipStyle()}>
        <div className="tour-step">
          {index + 1} / {steps.length}
        </div>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div className="tour-nav">
          <button className="btn" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
            Previous
          </button>
          {last ? (
            <button className="btn primary" onClick={props.onEnd}>
              End tutorial
            </button>
          ) : (
            <>
              <button className="btn primary" onClick={() => setIndex((i) => i + 1)}>
                Next
              </button>
              {allowSkip && (
                <button className="btn" onClick={props.onEnd}>
                  End tutorial
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

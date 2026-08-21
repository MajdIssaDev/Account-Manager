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
    body: "Main and Alt ship by default. Add more names, pick a color, and double-click a label to rename it. Color dots cycle palettes.",
  },
  {
    target: "cards",
    title: "Account cards",
    body: "Each card can launch, focus, or close that client. Assign labels, mark Inactive (only Inactive shows a badge), and tick the box to multi-select.",
  },
  {
    target: "launch-selected",
    title: "Launch selected",
    body: "Select two or more accounts and this button appears. It launches them one after another. Remove always asks you to confirm first.",
  },
  {
    target: "help",
    title: "Replay this tutorial",
    body: "You can open this walkthrough again anytime from Tutorial. End tutorial closes it and remembers you have seen it.",
  },
];

export default function Tutorial(props: {
  steps?: TutorialStep[];
  onEnd: () => void;
}) {
  const steps = props.steps || TUTORIAL_STEPS;
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const step = steps[index];

  useEffect(() => {
    const measure = () => {
      const el = document.querySelector(`[data-tour="${step.target}"]`);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    const timer = window.setInterval(measure, 250);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step.target]);

  const pad = 8;
  const hole = rect
    ? {
        top: Math.max(8, rect.top - pad),
        left: Math.max(8, rect.left - pad),
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      }
    : null;

  const tipStyle = (): CSSProperties => {
    if (!hole) {
      return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
    }
    const below = hole.top + hole.height + 12;
    const spaceBelow = window.innerHeight - below;
    const top = spaceBelow > 180 ? below : Math.max(12, hole.top - 168);
    const left = Math.min(Math.max(12, hole.left), window.innerWidth - 360);
    return { top, left };
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
          {index < steps.length - 1 ? (
            <button className="btn primary" onClick={() => setIndex((i) => i + 1)}>
              Next
            </button>
          ) : (
            <button className="btn primary" onClick={props.onEnd}>
              End tutorial
            </button>
          )}
          <button className="btn" onClick={props.onEnd}>
            End tutorial
          </button>
        </div>
      </div>
    </div>
  );
}

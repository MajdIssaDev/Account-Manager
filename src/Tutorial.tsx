import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

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
    body: "Set the Roblox folder (default or a pinned version for Potassium), attach, GitHub token for updates, and a color theme.",
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
    body: "Filter the grid from this sidebar. The play button launches every active account with that label. Select more than one label to show accounts that have any of them (OR).",
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

const COMPACT_TARGETS = new Set([
  "attach",
  "updates",
  "help",
  "settings",
  "add-account",
  "create-label",
  "inactive",
  "launch-selected",
]);

function holePad(target: string): number {
  if (target === "attach") {
    return 12;
  }
  if (COMPACT_TARGETS.has(target)) {
    return 8;
  }
  return 0;
}

function overlapArea(
  a: { left: number; top: number; width: number; height: number },
  b: { left: number; top: number; width: number; height: number },
): number {
  const x = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
  const y = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
  return x * y;
}

function measureHole(target: string): Hole | null {
  const el = document.querySelector(`[data-tour="${target}"]`);
  if (!(el instanceof HTMLElement)) {
    return null;
  }
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pad = holePad(target);
  let left = r.left - pad;
  let top = r.top - pad;
  let right = r.right + pad;
  let bottom = r.bottom + pad;
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
  } else if (pad > 0 && (!radius || radius === "0px")) {
    radius = "8px";
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

function placeCard(hole: Hole, cardW: number, cardH: number): CSSProperties {
  const gap = 14;
  const margin = 12;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxLeft = Math.max(margin, vw - cardW - margin);
  const maxTop = Math.max(margin, vh - cardH - margin);
  const clampPos = (left: number, top: number) => ({
    left: Math.min(Math.max(margin, left), maxLeft),
    top: Math.min(Math.max(margin, top), maxTop),
  });

  const holeRight = hole.left + hole.width;
  const holeBottom = hole.top + hole.height;
  const midY = hole.top + hole.height / 2 - cardH / 2;
  const spaceRight = vw - holeRight - margin;
  const spaceLeft = hole.left - margin;
  const spaceBelow = vh - holeBottom - margin;
  const spaceAbove = hole.top - margin;
  const prefer: "right" | "below" | "above" | "left" =
    hole.height > 160 ? "right" : hole.top + hole.height > vh - 80 ? "above" : "below";
  const sideRank = (side: typeof prefer) => (side === prefer ? 0 : side === "right" || side === "below" ? 1 : 2);

  const slots: { left: number; top: number; room: number; side: typeof prefer }[] = [
    { left: holeRight + gap, top: hole.top, room: Math.min(1, Math.max(0, spaceRight / cardW)), side: "right" },
    { left: holeRight + gap, top: midY, room: Math.min(1, Math.max(0, spaceRight / cardW)), side: "right" },
    { left: holeRight + gap, top: holeBottom - cardH, room: Math.min(1, Math.max(0, spaceRight / cardW)), side: "right" },
    { left: hole.left, top: holeBottom + gap, room: Math.min(1, Math.max(0, spaceBelow / cardH)), side: "below" },
    { left: holeRight - cardW, top: holeBottom + gap, room: Math.min(1, Math.max(0, spaceBelow / cardH)), side: "below" },
    { left: hole.left, top: hole.top - cardH - gap, room: Math.min(1, Math.max(0, spaceAbove / cardH)), side: "above" },
    { left: holeRight - cardW, top: hole.top - cardH - gap, room: Math.min(1, Math.max(0, spaceAbove / cardH)), side: "above" },
    { left: hole.left - cardW - gap, top: hole.top, room: Math.min(1, Math.max(0, spaceLeft / cardW)), side: "left" },
    { left: hole.left - cardW - gap, top: midY, room: Math.min(1, Math.max(0, spaceLeft / cardW)), side: "left" },
  ];

  let best = clampPos(holeRight + gap, hole.top);
  let bestScore = Number.POSITIVE_INFINITY;

  for (const slot of slots) {
    const p = clampPos(slot.left, slot.top);
    const overlap = overlapArea({ ...p, width: cardW, height: cardH }, hole);
    const score = (1 - slot.room) * 2_000_000 + sideRank(slot.side) * 1_000 + overlap;
    if (score < bestScore) {
      best = p;
      bestScore = score;
    }
  }

  return { top: best.top, left: best.left, width: cardW };
}

export default function Tutorial(props: {
  steps?: TutorialStep[];
  allowSkip?: boolean;
  onEnd: () => void;
}) {
  const steps = props.steps || TUTORIAL_STEPS;
  const [index, setIndex] = useState(0);
  const [hole, setHole] = useState<Hole | null>(null);
  const [cardBox, setCardBox] = useState({ w: 340, h: 210 });
  const cardRef = useRef<HTMLDivElement>(null);

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

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) {
      return;
    }
    const { width, height } = el.getBoundingClientRect();
    setCardBox((prev) =>
      Math.abs(prev.w - width) < 1 && Math.abs(prev.h - height) < 1
        ? prev
        : { w: width, h: height },
    );
  }, [index, step.body, hole]);

  const tipStyle = (): CSSProperties => {
    if (!hole) {
      return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
    }
    return placeCard(hole, cardBox.w, cardBox.h);
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
      <div className="tour-card" ref={cardRef} style={tipStyle()}>
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

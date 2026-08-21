import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

export type CtxItem =
  | { type: "sep" }
  | {
      type: "item";
      label: string;
      disabled?: boolean;
      danger?: boolean;
      checked?: boolean;
      keepOpen?: boolean;
      children?: CtxItem[];
      onClick?: () => void;
    };

function placeNested(el: HTMLElement): CSSProperties {
  const parent = el.parentElement;
  if (!parent) {
    return {};
  }
  const pr = parent.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const pad = 8;
  const gap = 2;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = pr.right + gap;
  if (left + w > vw - pad) {
    left = pr.left - gap - w;
  }
  if (left < pad) {
    left = Math.max(pad, vw - w - pad);
  }

  let top = pr.top;
  if (top + h > vh - pad) {
    top = Math.max(pad, vh - h - pad);
  }

  return { position: "fixed", left, top, right: "auto", visibility: "visible" };
}

function MenuList(props: {
  items: CtxItem[];
  onClose: () => void;
  nested?: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [nestedPos, setNestedPos] = useState<CSSProperties | undefined>(
    props.nested ? { visibility: "hidden" } : undefined,
  );

  useLayoutEffect(() => {
    if (!props.nested) {
      return;
    }
    const el = listRef.current;
    if (!el) {
      return;
    }
    setNestedPos(placeNested(el));
  }, [props.nested, props.items, open]);

  return (
    <div
      ref={listRef}
      className={`ctx-list${props.nested ? " nested" : ""}`}
      role="menu"
      style={nestedPos}
    >
      {props.items.map((item, i) => {
        if (item.type === "sep") {
          return <div key={`sep-${i}`} className="ctx-sep" />;
        }
        const hasKids = Boolean(item.children?.length);
        return (
          <div
            key={`${item.label}-${i}`}
            className="ctx-wrap"
            onMouseEnter={() => setOpen(hasKids ? i : null)}
          >
            <button
              type="button"
              className={`ctx-item${item.danger ? " danger" : ""}${item.checked ? " checked" : ""}`}
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled || hasKids) {
                  return;
                }
                item.onClick?.();
                if (!item.keepOpen) {
                  props.onClose();
                }
              }}
            >
              <span className="ctx-check">{item.checked ? "✓" : ""}</span>
              <span className="ctx-label">{item.label}</span>
              {hasKids && <span className="ctx-caret">›</span>}
            </button>
            {hasKids && open === i && item.children && (
              <MenuList items={item.children} onClose={props.onClose} nested />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function ContextMenu(props: {
  x: number;
  y: number;
  items: CtxItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: props.x, top: props.y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const r = el.getBoundingClientRect();
    const left = Math.min(props.x, window.innerWidth - r.width - 8);
    const top = Math.min(props.y, window.innerHeight - r.height - 8);
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [props.x, props.y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        props.onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        props.onClose();
      }
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", props.onClose);
    window.addEventListener("scroll", props.onClose, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", props.onClose);
      window.removeEventListener("scroll", props.onClose, true);
    };
  }, [props]);

  return (
    <div className="ctx" ref={ref} style={{ left: pos.left, top: pos.top }}>
      <MenuList items={props.items} onClose={props.onClose} />
    </div>
  );
}

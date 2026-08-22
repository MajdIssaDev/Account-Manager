import { useEffect, useState } from "react";
import type { HiveCatalogControl } from "../shared/types";
import { formatSliderValue } from "./hiveSliderFormat";

export default function HiveCatalogSlider(props: {
  control: HiveCatalogControl;
  accountId: string | undefined;
  busy: boolean;
  onCommit: (id: string, value: number) => void;
}) {
  const { control: c, accountId } = props;
  const fallback = c.default ?? c.min ?? 0;
  const [value, setValue] = useState(fallback);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!accountId) {
      setValue(fallback);
      setLoaded(false);
      return;
    }
    setLoaded(false);
    void window.ram
      .hiveSend({
        accountId,
        op: "slider.get",
        payload: { id: c.id },
        timeoutMs: 12000,
      })
      .then((res) => {
        const v = Number(res.data?.data?.value);
        if (Number.isFinite(v)) {
          setValue(v);
        } else {
          setValue(fallback);
        }
        setLoaded(true);
      })
      .catch(() => {
        setValue(fallback);
        setLoaded(true);
      });
  }, [accountId, c.id, fallback]);

  const commit = (next: number) => {
    setValue(next);
    props.onCommit(c.id, next);
  };

  return (
    <div className="hive-catalog-slider-wrap">
      <span className="hive-slider-value" title={loaded ? undefined : "Loading…"}>
        {formatSliderValue(value, c.isInt)}
      </span>
      <input
        type="range"
        className="hive-slider"
        min={c.min ?? 0}
        max={c.max ?? 100}
        step={c.isInt ? 1 : 0.05}
        value={value}
        disabled={props.busy || !accountId}
        onChange={(e) => setValue(Number(e.target.value))}
        onMouseUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
        onTouchEnd={(e) => commit(Number((e.target as HTMLInputElement).value))}
      />
    </div>
  );
}

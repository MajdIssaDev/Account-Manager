import { useEffect, useState } from "react";
import type { HiveCatalogControl } from "../shared/types";
import { formatSliderValue } from "./hiveSliderFormat";

export default function HiveCatalogSlider(props: {
  control: HiveCatalogControl;
  accountId: string | undefined;
  initialValue?: number;
  lazy?: boolean;
  busy: boolean;
  onCommit: (id: string, value: number) => void;
}) {
  const { control: c, accountId } = props;
  const fallback = props.initialValue ?? c.default ?? c.min ?? 0;
  const [value, setValue] = useState(fallback);
  const [loaded, setLoaded] = useState(props.initialValue !== undefined);

  useEffect(() => {
    if (props.initialValue !== undefined && Number.isFinite(props.initialValue)) {
      setValue(props.initialValue);
      setLoaded(true);
      return;
    }
    if (!accountId || props.lazy) {
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
  }, [accountId, c.id, fallback, props.initialValue, props.lazy]);

  useEffect(() => {
    if (!props.lazy || !accountId || loaded || props.initialValue !== undefined) {
      return;
    }
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
        }
        setLoaded(true);
      });
  }, [props.lazy, accountId, c.id, loaded, props.initialValue]);

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

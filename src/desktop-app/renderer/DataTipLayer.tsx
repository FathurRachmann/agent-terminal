import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type TipPos = "top" | "bottom" | "left" | "right";

type TipState = {
  text: string;
  preferred: TipPos;
  anchor: DOMRect;
};

const GAP = 6;
const PAD = 8;

function parsePos(raw: string | null): TipPos {
  if (raw === "bottom" || raw === "left" || raw === "right" || raw === "top") {
    return raw;
  }
  return "top";
}

function placeTip(
  anchor: DOMRect,
  tipW: number,
  tipH: number,
  preferred: TipPos,
): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const positions: Record<TipPos, { top: number; left: number }> = {
    top: {
      top: anchor.top - tipH - GAP,
      left: anchor.left + anchor.width / 2 - tipW / 2,
    },
    bottom: {
      top: anchor.bottom + GAP,
      left: anchor.left + anchor.width / 2 - tipW / 2,
    },
    right: {
      top: anchor.top + anchor.height / 2 - tipH / 2,
      left: anchor.right + GAP,
    },
    left: {
      top: anchor.top + anchor.height / 2 - tipH / 2,
      left: anchor.left - tipW - GAP,
    },
  };

  const order: TipPos[] =
    preferred === "top"
      ? ["top", "bottom", "right", "left"]
      : preferred === "bottom"
        ? ["bottom", "top", "right", "left"]
        : preferred === "right"
          ? ["right", "left", "bottom", "top"]
          : ["left", "right", "bottom", "top"];

  for (const pos of order) {
    const { top, left } = positions[pos];
    const fitsX = left >= PAD && left + tipW <= vw - PAD;
    const fitsY = top >= PAD && top + tipH <= vh - PAD;
    if (fitsX && fitsY) return { top, left };
  }

  const fallback = positions[preferred];
  return {
    top: Math.min(Math.max(PAD, fallback.top), Math.max(PAD, vh - tipH - PAD)),
    left: Math.min(
      Math.max(PAD, fallback.left),
      Math.max(PAD, vw - tipW - PAD),
    ),
  };
}

function tipHost(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest("[data-tip]");
}

/**
 * Global hover/focus tooltips for `[data-tip]`.
 * Portal + position:fixed, clamped to the viewport so tips never clip
 * against overflow:hidden chrome at the window edges.
 */
export function DataTipLayer() {
  const [tip, setTip] = useState<TipState | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );
  const bubbleRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!tip || !bubbleRef.current) {
      setCoords(null);
      return;
    }
    const { offsetWidth: w, offsetHeight: h } = bubbleRef.current;
    setCoords(placeTip(tip.anchor, w, h, tip.preferred));
  }, [tip]);

  useEffect(() => {
    const show = (el: HTMLElement) => {
      const text = el.getAttribute("data-tip")?.trim();
      if (!text) return;
      activeRef.current = el;
      setTip({
        text,
        preferred: parsePos(el.getAttribute("data-tip-pos")),
        anchor: el.getBoundingClientRect(),
      });
    };

    const hide = () => {
      activeRef.current = null;
      setTip(null);
      setCoords(null);
    };

    const onOver = (e: MouseEvent) => {
      const el = tipHost(e.target);
      if (!el) {
        if (activeRef.current) hide();
        return;
      }
      if (el === activeRef.current) return;
      show(el);
    };

    const onOut = (e: MouseEvent) => {
      const from = tipHost(e.target);
      const to = tipHost(e.relatedTarget);
      if (from && !to) hide();
    };

    const onFocusIn = (e: FocusEvent) => {
      const el = tipHost(e.target);
      if (el) show(el);
    };

    const onFocusOut = (e: FocusEvent) => {
      const from = tipHost(e.target);
      const to = tipHost(e.relatedTarget);
      if (from && !to) hide();
    };

    const onRefresh = () => {
      if (activeRef.current?.isConnected) show(activeRef.current);
      else hide();
    };

    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    window.addEventListener("scroll", onRefresh, true);
    window.addEventListener("resize", onRefresh);

    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("scroll", onRefresh, true);
      window.removeEventListener("resize", onRefresh);
    };
  }, []);

  if (!tip) return null;

  return createPortal(
    <div
      ref={bubbleRef}
      role="tooltip"
      className="data-tip-bubble"
      style={{
        top: coords?.top ?? -9999,
        left: coords?.left ?? -9999,
        opacity: coords ? 1 : 0,
      }}
    >
      {tip.text}
    </div>,
    document.body,
  );
}

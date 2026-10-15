// A press-and-hold button for the console (KEY0 / KEY1, the OLED pad): a
// pointer or Space / Enter goes down and up with the event's time, so the
// caller can tell a tap from a hold; the release counts even off the button
// (pointer capture), and a cancel or lost focus drops the press.
import type { ButtonHTMLAttributes } from "react";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "onPointerDown" | "onPointerUp" | "onPointerCancel" | "onKeyDown" | "onKeyUp" | "onBlur"> & {
  onDown: (at: number) => void;
  onUp: (at: number) => void;
  onCancel: () => void;
};

export default function HoldButton({ onDown, onUp, onCancel, ...rest }: Props) {
  return (
    <button
      type="button"
      {...rest}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        onDown(e.timeStamp);
        try {
          e.currentTarget.setPointerCapture?.(e.pointerId);
        } catch {
          // error: NOT-WORTH — a pointer that is already gone: its pointercancel / blur ends the press
        }
      }}
      onPointerUp={(e) => onUp(e.timeStamp)}
      onPointerCancel={onCancel}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
          e.preventDefault();
          onDown(e.timeStamp);
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onUp(e.timeStamp);
        }
      }}
      onBlur={onCancel}
    />
  );
}

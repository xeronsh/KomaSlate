import * as SliderPrimitive from "@radix-ui/react-slider";
import { clsx } from "clsx";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";

export interface SliderProps
  extends ComponentPropsWithoutRef<typeof SliderPrimitive.Root> {
  label?: string;
}

export const Slider = forwardRef<
  ElementRef<typeof SliderPrimitive.Root>,
  SliderProps
>(function Slider({ className, label, ...props }, ref) {
  return (
    <SliderPrimitive.Root
      ref={ref}
      aria-label={props["aria-label"] ?? label}
      className={clsx("ui-slider-root h-5 w-full", className)}
      {...props}
    >
      <SliderPrimitive.Track className="ui-slider-track">
        <SliderPrimitive.Range className="ui-slider-range" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="ui-slider-thumb" />
    </SliderPrimitive.Root>
  );
});

// Local types for the Frame Overlay system

export type FrameOptions = {
  railSize?: { top?: number; right?: number; bottom?: number; left?: number }; // px
  show?: { top?: boolean; right?: boolean; bottom?: boolean; left?: boolean };
  mode?: "safe" | "compatB";
};

export interface FrameOverlayInterface {
  mount(opts?: FrameOptions): void;
  update(opts: FrameOptions): void;
  unmount(): void;
}

export type RailPosition = "top" | "right" | "bottom" | "left";

export interface RailElement extends HTMLDivElement {
  dataset: DOMStringMap & {
    rail: RailPosition;
  };
}



// Scene model. Field names and meanings follow the open .excalidraw JSON format (version 2)
// so files open in other tools that read it; only the element types below are drawn here.
export type FillStyle = "hachure" | "cross-hatch" | "solid" | "zigzag";
export type StrokeStyle = "solid" | "dashed" | "dotted";
export type Arrowhead = "arrow" | "triangle" | "triangle_outline" | "bar" | "circle" | "circle_outline" | "diamond" | "diamond_outline";
export type TextAlign = "left" | "center" | "right";
export type ToolType = "hand" | "selection" | "rectangle" | "diamond" | "ellipse" | "arrow" | "line" | "freedraw" | "text" | "image" | "eraser";
export type ElementType = "rectangle" | "diamond" | "ellipse" | "arrow" | "line" | "freedraw" | "text" | "image";
export const ELEMENT_TYPES: readonly ElementType[] = ["rectangle", "diamond", "ellipse", "arrow", "line", "freedraw", "text", "image"];

export type Point = [number, number];
export type Binding = { elementId: string; fixedPoint: [number, number]; mode?: "inside" | "orbit" };

export interface BaseElement {
  id: string;
  type: ElementType;
  x: number; y: number; width: number; height: number;
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: FillStyle;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  roughness: number;
  opacity: number;
  roundness: null | { type: number; value?: number };
  seed: number;
  version: number;
  versionNonce: number;
  index: string | null;
  isDeleted: boolean;
  groupIds: string[];
  frameId: null;
  boundElements: { id: string; type: "arrow" | "text" }[] | null;
  updated: number;
  link: string | null;
  locked: boolean;
  [extra: string]: unknown;
}
export interface LinearElement extends BaseElement {
  type: "arrow" | "line";
  points: Point[];
  startBinding: Binding | null;
  endBinding: Binding | null;
  startArrowhead: Arrowhead | null;
  endArrowhead: Arrowhead | null;
  elbowed?: boolean;
  polygon?: boolean;
}
export interface FreedrawElement extends BaseElement {
  type: "freedraw";
  points: Point[];
  pressures: number[];
  simulatePressure: boolean;
}
export interface TextElement extends BaseElement {
  type: "text";
  text: string;
  originalText: string;
  fontSize: number;
  fontFamily: number;
  textAlign: TextAlign;
  verticalAlign: "top" | "middle" | "bottom";
  containerId: string | null;
  lineHeight: number;
  autoResize: boolean;
}
export interface ImageElement extends BaseElement {
  type: "image";
  fileId: string | null;
  status: "pending" | "saved" | "error";
  scale: [number, number];
  crop: null;
}
export type Element = BaseElement | LinearElement | FreedrawElement | TextElement | ImageElement;

export type BinaryFile = { id: string; mimeType: string; dataURL: string; created: number };
export type BinaryFiles = Record<string, BinaryFile>;

/** The part of the editor state that is saved with a scene. */
export type SavedAppState = { viewBackgroundColor: string; gridSize: number | null; gridModeEnabled?: boolean };

export type SceneFile = {
  type: "excalidraw";
  version: 2;
  source: string;
  elements: Element[];
  appState: SavedAppState;
  files: BinaryFiles;
};
export type LibraryItem = { id: string; status: "unpublished" | "published"; elements: Element[]; created: number; name?: string };
export type LibraryFile = { type: "excalidrawlib"; version: 2; source: string; libraryItems: LibraryItem[] };

export const isLinear = (e: Element): e is LinearElement => e.type === "arrow" || e.type === "line";
export const isFreedraw = (e: Element): e is FreedrawElement => e.type === "freedraw";
export const isText = (e: Element): e is TextElement => e.type === "text";
export const isImage = (e: Element): e is ImageElement => e.type === "image";
export const hasPoints = (e: Element): e is LinearElement | FreedrawElement => isLinear(e) || isFreedraw(e);

/** Font families by their number in the file format. */
export const FONT = { hand: 5, normal: 6, code: 3 } as const;
export const FONT_SIZES = { S: 16, M: 20, L: 28, XL: 36 } as const;
export function fontStack(family: number): string {
  if (family === 3 || family === 8) return `"Cascadia Code", "SFMono-Regular", Menlo, Consolas, monospace`;
  if (family === 2 || family === 6 || family === 9 || family === 10 || family === 7) return `system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  return `Kalam, "Comic Sans MS", "Segoe Print", cursive`;
}
export const LINE_HEIGHT = (family: number) => (family === 3 || family === 8 ? 1.2 : family === 5 || family === 1 ? 1.25 : 1.35);

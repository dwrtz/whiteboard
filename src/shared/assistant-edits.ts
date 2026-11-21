import { z } from "zod";
import { bump, DEFAULT_STYLE, newElement, syncIndices } from "./elements";
import { dropDeadBindings, syncBoundElements, placeBoundEnds, updateBoundArrows, BINDABLE } from "./binding";
import { center } from "./geometry";
import { isText, type Element, type LinearElement } from "./types";

const id = z.string().min(1).max(128);
const coordinate = z.number().finite().min(-1_000_000).max(1_000_000);
const size = z.number().positive().max(100_000);
const expected = { id, version: z.number().int(), versionNonce: z.number().int() };
const text = z.string().min(1).max(4096);
const paint = z.string().regex(/^#[a-f\d]{6}$/i).optional();
export const editSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add_shape"), id, shape: z.enum(["rectangle", "ellipse", "diamond"]), x: coordinate, y: coordinate, width: size, height: size, strokeColor: paint, backgroundColor: paint }),
  z.object({ op: z.literal("add_text"), id, text, x: coordinate, y: coordinate, fontSize: z.number().min(4).max(200).optional() }),
  z.object({ op: z.literal("move"), ...expected, x: coordinate, y: coordinate }),
  z.object({ op: z.literal("set_text"), ...expected, text }),
  z.object({ op: z.literal("delete"), ...expected }),
  z.object({ op: z.literal("connect"), id, from: id, to: id }),
]);
export type BoardEdit = z.infer<typeof editSchema>;

function textDimensions(value: string, fontSize: number) {
  const lines = value.split("\n");
  return { width: Math.ceil(Math.max(1, ...lines.map(line => Array.from(line).length)) * fontSize * 0.65), height: Math.ceil(lines.length * fontSize * 1.25) };
}

/** Compute a whole batch before publishing. IDs supplied on creation also protect against duplicate inserts on retries. */
export function applyBoardEdits(current: Element[], edits: BoardEdit[], now: number): Element[] {
  const scene = new Map(current.map(element => [element.id, element]));
  const moved = new Set<string>();
  for (const edit of edits) {
    const before = scene.get(edit.id);
    if ("version" in edit) {
      if (!before || before.isDeleted || before.version !== edit.version || before.versionNonce !== edit.versionNonce) throw new Error("Stale element. Read the board again.");
      if (before.locked) throw new Error("This element is locked.");
      if (edit.op === "move") {
        scene.set(edit.id, bump(before, { x: edit.x, y: edit.y }, now));
        moved.add(edit.id);
      }
      if (edit.op === "delete") scene.set(edit.id, bump(before, { isDeleted: true }, now));
      if (edit.op === "set_text") {
        moved.add(edit.id);
        if (!isText(before)) throw new Error("set_text requires a text element.");
        scene.set(edit.id, bump(before, { text: edit.text, originalText: edit.text, ...textDimensions(edit.text, before.fontSize) }, now));
      }
      continue;
    }
    if (before) throw new Error("Element ID already exists. Choose a fresh ID.");
    if (edit.op === "add_shape") {
      scene.set(edit.id, newElement(edit.shape, edit.x, edit.y, DEFAULT_STYLE, now, { id: edit.id, width: edit.width, height: edit.height, strokeColor: edit.strokeColor ?? DEFAULT_STYLE.strokeColor, backgroundColor: edit.backgroundColor ?? DEFAULT_STYLE.backgroundColor }));
    } else if (edit.op === "add_text") {
      const fontSize = edit.fontSize ?? DEFAULT_STYLE.fontSize;
      scene.set(edit.id, newElement("text", edit.x, edit.y, DEFAULT_STYLE, now, { id: edit.id, text: edit.text, originalText: edit.text, fontSize, ...textDimensions(edit.text, fontSize) }));
    } else {
      const from = scene.get(edit.from), to = scene.get(edit.to);
      if (!from || !to || from.id === to.id || from.isDeleted || to.isDeleted || !BINDABLE.has(from.type) || !BINDABLE.has(to.type)) throw new Error("A connection needs two different live, bindable elements.");
      const [x, y] = center(from), [tx, ty] = center(to);
      const arrow = newElement("arrow", x, y, DEFAULT_STYLE, now, { id: edit.id, points: [[0, 0], [tx - x, ty - y]], width: Math.abs(tx - x), height: Math.abs(ty - y),
        startBinding: { elementId: from.id, fixedPoint: [0.5, 0.5] }, endBinding: { elementId: to.id, fixedPoint: [0.5, 0.5] } }) as LinearElement;
      scene.set(edit.id, placeBoundEnds(arrow, scene));
    }
  }
  const indexed = syncIndices([...scene.values()]);
  return syncBoundElements(dropDeadBindings(updateBoundArrows(indexed, moved, now), now), now);
}

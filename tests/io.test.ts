import { describe, it, expect } from "vitest";
import { el, indexed } from "./helpers";
import { parseSceneFile, parseLibraryFile, serializeScene, serializeLibrary, restoreElements, ImportError } from "../src/shared/restore";
import { generateKey, encrypt, decrypt, decryptText, isKey, sha1Hex, toB64, fromB64, sealScene, openScene } from "../src/shared/crypto";
import { settings } from "../src/shared/settings";

describe("file format", () => {
  it("writes .excalidraw JSON that opens again unchanged", () => {
    const els = indexed([el("rectangle", 1, 2, 30, 40, { backgroundColor: "#a5d8ff", fillStyle: "hachure" }), el("text", 5, 5, 50, 25, { text: "Hi", originalText: "Hi" })]);
    const text = serializeScene(els, { viewBackgroundColor: "#fffce8", gridSize: 20, gridModeEnabled: true }, {}, "https://example.test");
    const doc = JSON.parse(text);
    expect(doc).toMatchObject({ type: "excalidraw", version: 2, source: "https://example.test", appState: { viewBackgroundColor: "#fffce8", gridSize: 20 } });
    const back = parseSceneFile(text);
    expect(back.elements.map(e => e.id)).toEqual(els.map(e => e.id));
    expect(back.elements[0]).toMatchObject({ x: 1, y: 2, width: 30, height: 40, backgroundColor: "#a5d8ff", fillStyle: "hachure" });
    expect(back.appState.viewBackgroundColor).toBe("#fffce8");
    // every field survives a second round trip unchanged
    expect(JSON.parse(serializeScene(back.elements, back.appState, {}, "https://example.test")).elements).toEqual(doc.elements);
  });
  it("keeps element links and customData for other tools", () => {
    const [r] = indexed([el("rectangle", 0, 0, 10, 10, { link: "https://example.com", customData: { plugin: { n: 1 } } })]);
    const back = parseSceneFile(serializeScene([r], { viewBackgroundColor: "#ffffff", gridSize: 20 } as any, {}, "x")).elements[0] as any;
    expect(back.link).toBe("https://example.com"); expect(back.customData).toEqual({ plugin: { n: 1 } });
  });
  it("leaves out deleted elements and unused files", () => {
    const [a, b] = indexed([el("image", 0, 0, 10, 10, { fileId: "f1" }), el("rectangle", 0, 0)]);
    const files = { f1: { id: "f1", mimeType: "image/png", dataURL: "data:image/png;base64,AAAA", created: 1 }, f2: { id: "f2", mimeType: "image/png", dataURL: "data:image/png;base64,BBBB", created: 1 } };
    const doc = JSON.parse(serializeScene([a, { ...b, isDeleted: true }], { viewBackgroundColor: "#fff", gridSize: null }, files, "x"));
    expect(doc.elements.length).toBe(1); expect(Object.keys(doc.files)).toEqual(["f1"]);
  });
  it("opens files from other tools: fills missing fields, drops unknown types, maps old arrowheads", () => {
    const text = JSON.stringify({ type: "excalidraw", version: 2, elements: [
      { id: "a", type: "rectangle", x: 10, y: 10, width: 20, height: 20 },
      { id: "b", type: "frame", x: 0, y: 0, width: 100, height: 100 },
      { id: "c", type: "arrow", x: 0, y: 0, points: [[0, 0], [10, 10]], endArrowhead: "dot", startArrowhead: "<script>" },
      { id: "d", type: "embeddable", x: 0, y: 0 },
      { id: "e", type: "rectangle", isDeleted: true },
      { id: "f", type: "text", x: 0, y: 0, text: "x", fontFamily: 1, strokeColor: "javascript:alert(1)" },
    ] });
    const r = parseSceneFile(text);
    expect(r.elements.map(e => e.id)).toEqual(["a", "c", "f"]);
    expect(r.skipped).toBe(2);
    expect(r.elements[0]).toMatchObject({ strokeColor: "#1e1e1e", strokeWidth: 2, opacity: 100, fillStyle: "solid", groupIds: [] });
    expect((r.elements[1] as any).endArrowhead).toBe("circle");
    expect((r.elements[1] as any).startArrowhead).toBeNull();
    expect(r.elements[2].strokeColor).toBe("#1e1e1e");
    expect(r.elements.every(e => typeof e.index === "string")).toBe(true);
  });
  it("refuses things that are not drawings", () => {
    expect(() => parseSceneFile("nope")).toThrow(ImportError);
    expect(() => parseSceneFile(JSON.stringify({ type: "other", elements: [] }))).toThrow(/not a drawing/);
    expect(() => parseSceneFile(JSON.stringify({ type: "excalidrawlib", libraryItems: [] }))).toThrow(/library/);
  });
  it("rejects image data that isn't a base64 image data URL", () => {
    const r = parseSceneFile(JSON.stringify({ type: "excalidraw", elements: [], files: { a: { dataURL: "javascript:1" }, b: { dataURL: "data:image/png;base64,AAAA" } } }));
    expect(Object.keys(r.files)).toEqual(["b"]);
  });
  it("reads library files (version 1 and 2) and writes version 2", () => {
    const els = [el("rectangle", 0, 0)];
    const v2 = parseLibraryFile(serializeLibrary([{ id: "i1", status: "unpublished", elements: els, created: 5, name: "Box" }], "x"));
    expect(v2).toMatchObject([{ id: "i1", name: "Box", created: 5 }]);
    const v1 = parseLibraryFile(JSON.stringify({ type: "excalidrawlib", version: 1, library: [els] }));
    expect(v1.length).toBe(1);
    expect(JSON.parse(serializeLibrary(v2, "x"))).toMatchObject({ type: "excalidrawlib", version: 2 });
  });
  it("keeps tombstones when asked (server and live sessions)", () => {
    const r = restoreElements([{ id: "a", type: "rectangle", isDeleted: true }], true);
    expect(r.elements[0].isDeleted).toBe(true);
  });
});

describe("encryption", () => {
  it("round-trips with the right key and fails with a wrong one", async () => {
    const k = await generateKey(); expect(isKey(k)).toBe(true);
    const box = await encrypt(k, "secret drawing");
    expect(box.length).toBe(12 + "secret drawing".length + 16);
    expect(await decryptText(k, box)).toBe("secret drawing");
    await expect(decrypt(await generateKey(), box)).rejects.toThrow();
  });
  it("deflates share-link drawings before encrypting (like Excalidraw) and still opens plain ones", async () => {
    const k = await generateKey();
    const json = JSON.stringify({ type: "excalidraw", elements: Array.from({ length: 200 }, (_, i) => ({ id: `e${i}`, type: "rectangle", x: i, y: i })) });
    const sealed = await sealScene(k, json);
    expect(sealed.length).toBeLessThan(json.length / 4);
    expect(new TextDecoder().decode(await decrypt(k, sealed))[0]).not.toBe("{"); // compressed inside
    expect(await openScene(k, sealed)).toBe(json);
    expect(await openScene(k, await encrypt(k, json))).toBe(json); // uncompressed body
  });
  it("hashes files like the file format (SHA-1 hex) and converts base64", async () => {
    expect(await sha1Hex(new TextEncoder().encode("abc"))).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect([...fromB64(toB64(new Uint8Array([0, 1, 254, 255])))]).toEqual([0, 1, 254, 255]);
  });
});

describe("settings", () => {
  it("reads the product name and accent colour", () => {
    expect(settings.appName).toBe("Whiteboard");
    expect(settings.accentColor).toBe("#4c6ef5");
  });
});

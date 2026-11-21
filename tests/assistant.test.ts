import { describe, expect, it } from "vitest";
import { parseAssistantLink } from "../src/shared/assistant-links";
import { applyBoardEdits, type BoardEdit } from "../src/shared/assistant-edits";
import { isLinear } from "../src/shared/types";

const origin = "https://board.example";
const id = "a".repeat(20), key = "b".repeat(22);
const shape = (id: string, x: number): BoardEdit => ({op:"add_shape", shape:"rectangle", id, x, y:0, width:40, height:40});
describe("assistant room contracts", () => {
  it("reads only explicit fragment credentials from this board", () => {
    for (const path of ["/", "/mcp/"]) expect(parseAssistantLink(origin+path+"#room="+id+","+key, origin)).toEqual({roomId:id,key});
    expect(parseAssistantLink(origin+"/mcp/#invite="+key,origin)).toEqual({invite:key});
    for (const url of ["https://elsewhere.example/#room="+id+","+key, origin+"/mcp/?invite="+key, origin+"/#json="+id+","+key, origin+"/#invite="+key]) expect(parseAssistantLink(url, origin)).toBeNull();
  });
  it("updates bound arrows, preserves tombstones and rejects duplicate creation IDs", () => {
    const scene = applyBoardEdits([], [shape("a",0), shape("b",130), {op:"connect",id:"arrow",from:"a",to:"b"}], 1);
    const [a,b] = scene;
    const moved = applyBoardEdits(scene, [{op:"move", id:"a", version:a.version, versionNonce:a.versionNonce,x:30,y:0}], 2);
    expect(moved[2].x).not.toBe(scene[2].x);
    expect(() => applyBoardEdits(scene, [shape("a",25)], 3)).toThrow("already exists");
    const removed = applyBoardEdits(moved, [{op:"delete",id:b.id,version:b.version,versionNonce:b.versionNonce}], 4);
    expect(removed[1].isDeleted).toBe(true);
    expect(isLinear(removed[2]) && removed[2].endBinding).toBeNull();
  });
  it("validates an entire batch before changing the input", () => {
    const scene=applyBoardEdits([], [shape("x",0)], 1);
    expect(() => applyBoardEdits(scene,[shape("y",80),{op:"delete",id:"x",version:0,versionNonce:0}],2)).toThrow("Stale");
    expect(scene.map(e=>e.id)).toEqual(["x"]);
  });
});

import inputs from "../../spekkr.inputs.json";
const hex = /^#[0-9a-fA-F]{6}$/;
const i = inputs as Record<string, unknown>;
export const settings = {
  appName: (typeof i.app_name === "string" && i.app_name.trim()) || "Whiteboard",
  accentColor: typeof i.accent_color === "string" && hex.test(i.accent_color) ? i.accent_color : "#4c6ef5",
};

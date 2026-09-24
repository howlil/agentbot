import { Plugin } from "obsidian";

export const NOX_SETTINGS_KEY = "nox-settings";

export interface NoxSettings {
  executablePath: string;
  preferredModel: string;
}

export const DEFAULT_NOX_SETTINGS: NoxSettings = {
  executablePath: "",
  preferredModel: "",
};

export function decodeNoxSettings(
  rawData: Record<string, unknown> | null,
): NoxSettings {
  const value = rawData?.[NOX_SETTINGS_KEY];
  if (!value || typeof value !== "object") return { ...DEFAULT_NOX_SETTINGS };
  const candidate = value as Partial<NoxSettings>;
  return {
    executablePath:
      typeof candidate.executablePath === "string"
        ? candidate.executablePath
        : "",
    preferredModel:
      typeof candidate.preferredModel === "string"
        ? candidate.preferredModel
        : "",
  };
}

export async function saveNoxSettings(
  plugin: Plugin,
  settings: NoxSettings,
): Promise<void> {
  const current = (await plugin.loadData()) ?? {};
  await plugin.saveData({
    ...current,
    [NOX_SETTINGS_KEY]: settings,
  });
}

import { Plugin } from "obsidian";

export const FORGE_SETTINGS_KEY = "forge-settings";

export interface ForgeSettings {
  executablePath: string;
  preferredModel: string;
}

export const DEFAULT_FORGE_SETTINGS: ForgeSettings = {
  executablePath: "",
  preferredModel: "",
};

export function decodeForgeSettings(
  rawData: Record<string, unknown> | null,
): ForgeSettings {
  const value = rawData?.[FORGE_SETTINGS_KEY];
  if (!value || typeof value !== "object") return { ...DEFAULT_FORGE_SETTINGS };
  const candidate = value as Partial<ForgeSettings>;
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

export async function saveForgeSettings(
  plugin: Plugin,
  settings: ForgeSettings,
): Promise<void> {
  const current = (await plugin.loadData()) ?? {};
  await plugin.saveData({
    ...current,
    [FORGE_SETTINGS_KEY]: settings,
  });
}

import { App, PluginSettingTab, Setting } from "obsidian";
import type ForgePlugin from "../main";

export class ForgeSettingsTab extends PluginSettingTab {
  constructor(app: App, private readonly forge: ForgePlugin) {
    super(app, forge);
  }

  display(): void {
    const { containerEl } = this;
    const settings = this.forge.getSettings();
    containerEl.empty();
    containerEl.createEl("h2", { text: "Forge" });

    new Setting(containerEl)
      .setName("Agent executable")
      .setDesc("Optional absolute path to the configured agent runtime.")
      .addText((text) =>
        text
          .setPlaceholder("Use PATH discovery")
          .setValue(settings.executablePath)
          .onChange(async (value) => {
            await this.forge.updateSettings({ executablePath: value.trim() });
          }),
      );

    new Setting(containerEl)
      .setName("Preferred model")
      .setDesc("Leave blank to use the runtime default model.")
      .addText((text) =>
        text
          .setPlaceholder("Runtime default")
          .setValue(settings.preferredModel)
          .onChange(async (value) => {
            await this.forge.updateSettings({ preferredModel: value.trim() });
          }),
      );
  }
}

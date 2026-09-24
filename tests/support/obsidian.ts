export class TFile {
  constructor(
    public path: string,
    public stat: { mtime: number } = { mtime: 0 },
  ) {}
}

export class MarkdownView {
  constructor(
    public file: TFile | null,
    public editor: {
      getValue(): string;
      getSelection(): string;
      offsetToPos(offset: number): unknown;
      replaceRange(
        replacement: string,
        from: unknown,
        to: unknown,
      ): void;
    },
  ) {}
}

export class Plugin {
  registerEvent(_event: unknown): void {}
  async loadData(): Promise<Record<string, unknown> | null> {
    return null;
  }
  async saveData(_data: unknown): Promise<void> {}
}

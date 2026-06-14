export interface GameScene {
  resize(viewportSize: number): void;
  update(deltaMs: number): void;
  destroy(): void;
  handleKeyDown?(event: KeyboardEvent): boolean | void;
}

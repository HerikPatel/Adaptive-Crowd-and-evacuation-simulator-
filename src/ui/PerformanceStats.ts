/** Render cadence measurement stays outside deterministic simulation state. */
export class PerformanceStats {
  fps = 0;
  frameTime = 0;
  updateTime = 0;
  private frames = 0;
  private elapsed = 0;
  private work = 0;
  record(frameDelta: number, workMs: number) {
    if (frameDelta <= 0 || frameDelta > 1) return;
    this.frames++;
    this.elapsed += frameDelta;
    this.work += workMs;
    if (this.elapsed >= 0.5) {
      this.fps = this.frames / this.elapsed;
      this.frameTime = (this.elapsed * 1000) / this.frames;
      this.updateTime = this.work / this.frames;
      this.frames = 0;
      this.elapsed = 0;
      this.work = 0;
    }
  }
}

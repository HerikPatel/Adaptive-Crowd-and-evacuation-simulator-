import type { Euler, PerspectiveCamera, Vector3 } from "three";

const movementKeys = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "ShiftLeft", "ShiftRight"]);

/** Canvas input for the stadium fly camera. Orbit and fly share one camera. */
export class StadiumFreeCamera {
  private events = new AbortController();
  private keys = new Set<string>();
  private drag?: { id: number; x: number; y: number; moved: boolean };
  private suppressClick = false;
  private lastFrame = 0;
  private orientation: Euler;
  private motion: Vector3;
  enabled = false;

  constructor(private camera: PerspectiveCamera, private canvas: HTMLCanvasElement) {
    this.orientation = camera.rotation.clone().reorder("YXZ");
    this.motion = camera.position.clone();
    const options = { signal: this.events.signal };
    canvas.addEventListener("keydown", event => {
      if (!this.enabled || !movementKeys.has(event.code) || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault(); this.keys.add(event.code);
    }, options);
    canvas.addEventListener("keyup", event => this.keys.delete(event.code), options);
    canvas.addEventListener("blur", () => this.clearInput(), options);
    window.addEventListener("blur", () => this.clearInput(), options);
    canvas.addEventListener("pointerdown", event => {
      if (!this.enabled || this.drag || event.button !== 0) return;
      canvas.focus({ preventScroll: true }); this.suppressClick = false;
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
      canvas.setPointerCapture(event.pointerId);
    }, options);
    canvas.addEventListener("pointermove", event => {
      const drag = this.drag;
      if (drag?.id !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = this.suppressClick = true;
      drag.x = event.clientX; drag.y = event.clientY;
      this.orientation.y -= dx * 0.003;
      this.orientation.x = Math.max(-1.56, Math.min(1.56, this.orientation.x - dy * 0.003));
      this.camera.quaternion.setFromEuler(this.orientation);
    }, options);
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
      canvas.addEventListener(name, event => {
        if (this.drag?.id === event.pointerId) this.drag = undefined;
      }, options);
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.orientation.setFromQuaternion(this.camera.quaternion, "YXZ");
    this.clearInput();
    this.suppressClick = false;
    if (enabled) this.canvas.focus({ preventScroll: true });
  }

  clearInput() {
    const pointer = this.drag?.id;
    this.drag = undefined;
    if (pointer !== undefined && this.canvas.hasPointerCapture(pointer)) this.canvas.releasePointerCapture(pointer);
    this.keys.clear(); this.lastFrame = 0;
  }

  allowClick() {
    const allowed = !this.suppressClick;
    this.suppressClick = false;
    return allowed;
  }

  update(now: number) {
    const delta = this.lastFrame ? Math.min((now - this.lastFrame) / 1000, 0.05) : 0;
    this.lastFrame = now;
    if (!this.keys.size) return;
    const axis = (positive: string, negative: string) => Number(this.keys.has(positive)) - Number(this.keys.has(negative));
    const speed = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? 54 : 18;
    const direction = this.motion.set(axis("KeyD", "KeyA"), 0, axis("KeyS", "KeyW")).applyQuaternion(this.camera.quaternion);
    direction.y += axis("KeyE", "KeyQ");
    if (direction.lengthSq() > 1) direction.normalize();
    this.camera.position.addScaledVector(direction, speed * delta);
  }

  dispose() { this.clearInput(); this.events.abort(); }
}

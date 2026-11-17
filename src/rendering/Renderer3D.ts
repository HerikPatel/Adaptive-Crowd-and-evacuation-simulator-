import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Grid, CellType } from "../simulation/Grid";
import type { Agent } from "../simulation/Agent";
import type { MapLabel } from "../maps/maps";
import type { RenderOptions } from "./Renderer";

/**
 * Three.js view of the building simulation. It reads the same Grid and Agent
 * state as the 2D Canvas renderer, so the simulation, routing and metrics are
 * unchanged; only the presentation differs. 1 world unit = 1 grid cell = 1 m.
 */
const FLOOR_PX = 16; // floor texture resolution per cell
const WALL_HEIGHT = { cutaway: 1.1, full: 2.6 } as const;
const BODY_RADIUS = 0.2, BODY_LENGTH = 0.85, HEAD_RADIUS = 0.13;
const COLORS = {
  background: 0x09121d,
  wall: 0x3d566b,
  agent: new THREE.Color(0xc6e4ff),
  rerouting: new THREE.Color(0xffc477),
  exit: 0x67dec1,
  blocked: 0xef735c,
};

export type WallMode = keyof typeof WALL_HEIGHT;

export class Renderer3D {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 16 / 10, 0.1, 500);
  private controls: OrbitControls;
  private sun = new THREE.DirectionalLight(0xffffff, 1.6);
  private layout = new THREE.Group();
  private floorCanvas = document.createElement("canvas");
  private floorTexture = new THREE.CanvasTexture(this.floorCanvas);
  private bodies: THREE.InstancedMesh | null = null;
  private heads: THREE.InstancedMesh | null = null;
  private paths = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xb49eff, transparent: true, opacity: 0.45 }),
  );
  private grid: Grid | null = null;
  private layoutRevision = -1;
  private densityRevision = -1;
  private wallMode: WallMode = "cutaway";
  private resizeObserver: ResizeObserver;
  private matrix = new THREE.Matrix4();

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.canvas = this.renderer.domElement;
    this.canvas.setAttribute("aria-label", "3D view of the crowd evacuation simulation. Drag to orbit, scroll to zoom.");
    this.canvas.tabIndex = 0;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.prepend(this.canvas);

    this.scene.background = new THREE.Color(COLORS.background);
    this.scene.fog = new THREE.Fog(COLORS.background, 80, 220);
    this.scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x1a2633, 1.1));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target, this.layout, this.paths);
    this.floorTexture.colorSpace = THREE.SRGBColorSpace;
    this.floorTexture.anisotropy = 4;

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 160;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
  }

  setWallMode(mode: WallMode) {
    if (mode === this.wallMode) return;
    this.wallMode = mode;
    this.layoutRevision = -1; // rebuild walls on the next frame
  }

  /** Oblique overview of the whole floor plan. */
  resetView() {
    if (!this.grid) return;
    const { width: w, height: h } = this.grid, span = Math.max(w, h);
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(0, span * 0.78, span * 0.62);
    this.controls.update();
  }

  topView() {
    if (!this.grid) return;
    const span = Math.max(this.grid.width, this.grid.height * this.camera.aspect);
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(0, span * 1.2, 0.01);
    this.controls.update();
  }

  private resize() {
    const width = this.container.clientWidth;
    if (!width || !this.grid) return;
    const height = Math.round(Math.max(360, Math.min(width * (this.grid.height / this.grid.width) * 1.1, window.innerHeight * 0.75)));
    this.renderer.setSize(width, height, false);
    this.canvas.style.width = "100%";
    this.canvas.style.height = `${height}px`;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private toWorld(px: number, py: number, grid: Grid) {
    return { x: px / grid.cellSize - grid.width / 2, z: py / grid.cellSize - grid.height / 2 };
  }

  private clearLayout() {
    for (const child of [...this.layout.children]) {
      this.layout.remove(child);
      child.traverse((node) => {
        const mesh = node as THREE.Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else if (material && material !== this.floorMaterial) {
          (material as THREE.SpriteMaterial).map?.dispose();
          material.dispose();
        }
      });
    }
  }

  private floorMaterial = new THREE.MeshStandardMaterial({ map: this.floorTexture, roughness: 0.92 });

  private buildLayout(grid: Grid, labels: MapLabel[]) {
    const firstBuild = this.grid !== grid && (!this.grid || this.grid.width !== grid.width || this.grid.height !== grid.height);
    this.grid = grid;
    this.layoutRevision = grid.layoutRevision;
    this.densityRevision = -1;
    this.clearLayout();
    const { width: w, height: h } = grid, wallHeight = WALL_HEIGHT[this.wallMode];

    this.floorCanvas.width = w * FLOOR_PX;
    this.floorCanvas.height = h * FLOOR_PX;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.layout.add(floor);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(w + 60, h + 60),
      new THREE.MeshStandardMaterial({ color: 0x0c1824, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.layout.add(ground);

    // Only wall cells that touch floor become blocks; solid interior mass is skipped.
    const walls: [number, number][] = [];
    const blocked: [number, number][] = [];
    const exits: [number, number][] = [];
    const furniture: [number, number][] = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const exit = grid.exitAt(x, y);
        if (exit) (grid.blockedExits.has(exit) ? blocked : exits).push([x, y]);
        if (grid.type(x, y) === CellType.Obstacle) furniture.push([x, y]);
        if (grid.type(x, y) !== CellType.Wall) continue;
        let edge = false;
        for (let dy = -1; dy <= 1 && !edge; dy++)
          for (let dx = -1; dx <= 1 && !edge; dx++)
            if (grid.inside(x + dx, y + dy) && grid.type(x + dx, y + dy) !== CellType.Wall) edge = true;
        if (edge) walls.push([x, y]);
      }
    const box = (list: [number, number][], height: number, material: THREE.Material, shadows = true) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, height, 1), material, list.length);
      list.forEach(([x, y], i) => {
        this.matrix.makeTranslation(x + 0.5 - w / 2, height / 2, y + 0.5 - h / 2);
        mesh.setMatrixAt(i, this.matrix);
      });
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
      this.layout.add(mesh);
    };
    box(walls, wallHeight, new THREE.MeshStandardMaterial({ color: COLORS.wall, roughness: 0.75 }));
    box(furniture, 0.75, new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.8 }));
    box(exits, 0.06, new THREE.MeshStandardMaterial({ color: COLORS.exit, emissive: COLORS.exit, emissiveIntensity: 0.6 }), false);
    box(blocked, wallHeight * 0.9, new THREE.MeshStandardMaterial({ color: COLORS.blocked, emissive: COLORS.blocked, emissiveIntensity: 0.35 }));

    // Exit beacons and labels.
    for (const id of grid.exitIds) {
      const cells = grid.exits(id, true);
      if (!cells.length) continue;
      const isBlocked = grid.blockedExits.has(id);
      const cx = cells.reduce((s, p) => s + p.x + 0.5, 0) / cells.length - w / 2;
      const cz = cells.reduce((s, p) => s + p.y + 0.5, 0) / cells.length - h / 2;
      const color = isBlocked ? COLORS.blocked : COLORS.exit;
      if (!isBlocked) {
        const beacon = new THREE.Mesh(
          new THREE.CylinderGeometry(0.06, 0.06, 2.4, 8),
          new THREE.MeshBasicMaterial({ color }),
        );
        beacon.position.set(cx, 1.2, cz);
        this.layout.add(beacon);
        const light = new THREE.PointLight(color, 6, 7, 1.6);
        light.position.set(cx, 1.2, cz);
        this.layout.add(light);
      }
      this.layout.add(this.label(isBlocked ? `EXIT ${id} · BLOCKED` : `EXIT ${id}`, cx, 3.2, cz, color, 1.5));
    }
    for (const label of labels.filter((l) => !l.exit)) {
      const p = this.toWorld(label.x, label.y, grid);
      this.layout.add(this.label(label.text, p.x + label.text.length * 0.3, 0.6, p.z, 0x91a9be, 1.0));
    }

    // Sun and shadow camera cover the whole plan.
    const span = Math.max(w, h);
    this.sun.position.set(-span * 0.35, span * 0.9, span * 0.45);
    const cam = this.sun.shadow.camera;
    cam.left = -w / 2 - 4; cam.right = w / 2 + 4; cam.top = h / 2 + 4; cam.bottom = -h / 2 - 4;
    cam.near = 1; cam.far = span * 3;
    cam.updateProjectionMatrix();
    this.scene.fog = new THREE.Fog(COLORS.background, span * 1.4, span * 3.2);

    if (firstBuild) {
      this.resize();
      this.resetView();
    }
  }

  private label(text: string, x: number, y: number, z: number, color: number, scale: number) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    const font = "600 44px Segoe UI, Inter, sans-serif";
    ctx.font = font;
    canvas.width = Math.ceil(ctx.measureText(text).width) + 32;
    canvas.height = 64;
    ctx.font = font;
    ctx.fillStyle = "rgba(9,18,29,0.72)";
    ctx.beginPath();
    ctx.roundRect(0, 4, canvas.width, 56, 12);
    ctx.fill();
    ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
    ctx.textBaseline = "middle";
    ctx.fillText(text, 16, 33);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
    sprite.scale.set((canvas.width / 64) * scale, scale, 1);
    sprite.position.set(x, y, z);
    sprite.renderOrder = 10;
    return sprite;
  }

  /** Floor texture = 2D floor plan + the same density heatmap as the Canvas view. */
  private paintFloor(grid: Grid) {
    const c = this.floorCanvas.getContext("2d")!, s = FLOOR_PX;
    c.fillStyle = "#0e1a27";
    c.fillRect(0, 0, this.floorCanvas.width, this.floorCanvas.height);
    for (let y = 0; y < grid.height; y++)
      for (let x = 0; x < grid.width; x++) {
        if (grid.type(x, y) === CellType.Wall) continue;
        c.fillStyle = "#2a3d50";
        c.fillRect(x * s, y * s, s, s);
        c.strokeStyle = "#344a5e";
        c.lineWidth = 1;
        c.strokeRect(x * s + 0.5, y * s + 0.5, s - 1, s - 1);
        const density = grid.density[grid.index(x, y)];
        if (density >= 0.015 && grid.walkable(x, y)) {
          c.fillStyle = `hsla(${140 * (1 - density)},85%,55%,${0.12 + 0.6 * density})`;
          c.fillRect(x * s, y * s, s, s);
        }
      }
    this.floorTexture.needsUpdate = true;
  }

  private ensureAgentMeshes(count: number) {
    if (this.bodies && this.bodies.instanceMatrix.count >= count) return;
    const capacity = Math.max(64, count);
    for (const mesh of [this.bodies, this.heads]) {
      if (!mesh) continue;
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
    const material = () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 });
    this.bodies = new THREE.InstancedMesh(new THREE.CapsuleGeometry(BODY_RADIUS, BODY_LENGTH, 4, 10), material(), capacity);
    this.heads = new THREE.InstancedMesh(new THREE.SphereGeometry(HEAD_RADIUS, 12, 8), material(), capacity);
    for (const mesh of [this.bodies, this.heads]) {
      mesh.castShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, COLORS.agent);
      this.scene.add(mesh);
    }
  }

  render(grid: Grid, agents: Agent[], densityRevision: number, time: number, labels: MapLabel[], options: RenderOptions) {
    if (grid !== this.grid || grid.layoutRevision !== this.layoutRevision) this.buildLayout(grid, labels);
    if (densityRevision !== this.densityRevision) {
      this.densityRevision = densityRevision;
      this.paintFloor(grid);
    }
    this.ensureAgentMeshes(agents.length);
    const bodies = this.bodies!, heads = this.heads!;
    const bodyY = BODY_RADIUS + BODY_LENGTH / 2, headY = BODY_RADIUS * 2 + BODY_LENGTH + HEAD_RADIUS * 0.7;
    let n = 0;
    for (const a of agents) {
      if (a.evacuated) continue;
      const p = this.toWorld(a.position.x, a.position.y, grid);
      const color = a.reroutingUntil > time ? COLORS.rerouting : COLORS.agent;
      this.matrix.makeTranslation(p.x, bodyY, p.z);
      bodies.setMatrixAt(n, this.matrix);
      bodies.setColorAt(n, color);
      this.matrix.makeTranslation(p.x, headY, p.z);
      heads.setMatrixAt(n, this.matrix);
      heads.setColorAt(n, color);
      n++;
    }
    for (const mesh of [bodies, heads]) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    this.paths.visible = options.paths;
    if (options.paths) {
      const points: number[] = [];
      for (const a of agents) {
        if (a.evacuated || !a.path.length) continue;
        let prev = this.toWorld(a.position.x, a.position.y, grid);
        for (let i = a.pathIndex; i < a.path.length; i++) {
          const c = grid.center(a.path[i]), next = this.toWorld(c.x, c.y, grid);
          points.push(prev.x, 0.08, prev.z, next.x, 0.08, next.z);
          prev = next;
        }
      }
      this.paths.geometry.dispose();
      this.paths.geometry = new THREE.BufferGeometry();
      this.paths.geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

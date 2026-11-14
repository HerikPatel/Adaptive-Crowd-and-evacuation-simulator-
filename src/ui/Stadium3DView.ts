import { STADIUM, type Point, type SurfaceId } from "../maps/stadium";
import type { NavigationEdge } from "../maps/stadiumNavigation";
import type { StadiumRouter, StadiumRouteStep } from "../pathfinding/StadiumRouter";
import type { StadiumRenderFrame, StadiumRenderPerson } from "../simulation/StadiumSimulation";
import { destinationColor, levelShowsSurface, STADIUM_3D_ASSUMPTIONS, STADIUM_BLOCKED_COLOR,
  STADIUM_DESTINATIONS, STADIUM_REFERENCE_ROUTE_COLOR, surfaceElevation, type StadiumViewLevel } from "./StadiumVisuals";

type Three = typeof import("three");
type Controls = import("three/addons/controls/OrbitControls.js").OrbitControls;

/** Lazily loaded architectural renderer. It never updates simulation state. */
export class Stadium3DView {
  private THREE?: Three;
  private renderer?: import("three").WebGLRenderer;
  private scene?: import("three").Scene;
  private camera?: import("three").PerspectiveCamera;
  private controls?: Controls;
  private bodies?: import("three").InstancedMesh;
  private heads?: import("three").InstancedMesh;
  private rings?: import("three").InstancedMesh;
  private markers?: import("three").InstancedMesh;
  private routeGroup?: import("three").Group;
  private architecture?: import("three").Group;
  private personIds: number[] = [];
  private selectedPersonId: number | null = null;
  private selectedSectionId: string | null = null;
  private level: StadiumViewLevel = "overview";
  private following = false;
  private lastWidth = 0;
  private lastHeight = 0;
  private sampleStarted = 0;
  private sampleFrames = 0;
  private sampleRenderMs = 0;

  constructor(private container: HTMLElement, private router: StadiumRouter,
    private onSelectPerson: (id: number) => void, private onFollowEnded: () => void,
    private performanceOutput: HTMLElement) {}

  async initialize() {
    if (this.renderer) return;
    const [THREE, controlsModule] = await Promise.all([
      import("three"), import("three/addons/controls/OrbitControls.js"),
    ]);
    if (!document.createElement("canvas").getContext("webgl2") && !document.createElement("canvas").getContext("webgl"))
      throw new Error("WebGL is unavailable in this browser.");
    this.THREE = THREE;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0xe8edf1, 1);
    renderer.shadowMap.enabled = false;
    renderer.domElement.setAttribute("aria-label", "Interactive schematic three-dimensional stadium view");
    renderer.domElement.tabIndex = 0;
    this.container.replaceChildren(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xe8edf1, 28, 55);
    this.scene = scene;
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.up.set(0, 1, 0);
    this.camera = camera;
    const controls = new controlsModule.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 5;
    controls.maxDistance = 55;
    controls.maxPolarAngle = Math.PI * 0.49;
    this.controls = controls;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8594a3, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(-12, 25, -10); scene.add(sun);
    this.buildArchitecture();
    this.buildCrowd();
    this.preset("overview");
    renderer.domElement.addEventListener("click", event => this.pick(event));
  }

  setSelection(personId: number | null, sectionId: string | null) {
    this.selectedPersonId = personId;
    this.selectedSectionId = sectionId;
    if (personId === null) this.following = false;
  }

  setLevel(level: StadiumViewLevel) {
    this.level = level;
    this.container.dataset.level = level;
    for (const object of this.architecture?.children ?? []) {
      const surface = object.userData.surface as SurfaceId | undefined;
      const connection = object.userData.connection as boolean | undefined;
      object.visible = level === "overview" || (level === "connections" ? Boolean(connection) : surface ? levelShowsSurface(level, surface) : true);
    }
  }

  setFollowing(value: boolean) { this.following = value && this.selectedPersonId !== null; }
  get isFollowing() { return this.following; }

  preset(name: "overview" | "connections" | "gates" | "fit") {
    if (!this.camera || !this.controls) return;
    const positions = {
      overview: [0, 29, 24], connections: [-12, 17, 19], gates: [0, 11, 29], fit: [0, 27, 23],
    } as const;
    const [x, y, z] = positions[name];
    this.camera.position.set(x, y, z);
    this.container.dataset.camera = name;
    this.controls.target.set(0, 3, 0);
    this.controls.update();
    this.following = false;
  }

  render(frame: StadiumRenderFrame) {
    if (!this.renderer || !this.scene || !this.camera || !this.controls || !this.THREE) return;
    const started = performance.now();
    this.resize();
    this.updateCrowd(frame);
    this.updateRoutes(frame);
    this.updateFollow(frame);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    const elapsed = performance.now() - started;
    this.recordPerformance(elapsed);
  }

  private world(point: Point, elevation: number) {
    const scale = STADIUM_3D_ASSUMPTIONS.drawingScale;
    return this.THREE!.Vector3
      ? new this.THREE!.Vector3((point.x - STADIUM.width / 2) * scale, elevation, (point.y - STADIUM.height / 2) * scale)
      : undefined as never;
  }

  private buildArchitecture() {
    const T = this.THREE!, group = new T.Group();
    group.name = "schematic-stadium"; this.architecture = group; this.scene!.add(group);
    const ground = new T.Mesh(new T.PlaneGeometry(30, 24), new T.MeshStandardMaterial({ color: 0xd7dde2, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.userData.surface = "exterior"; group.add(ground);
    const field = new T.Mesh(new T.PlaneGeometry(10, 4.8), new T.MeshStandardMaterial({ color: 0x8eaa8b, roughness: 1 }));
    field.rotation.x = -Math.PI / 2; field.position.y = 0.02; field.userData.surface = "lower-bowl"; group.add(field);

    for (const section of STADIUM.sections) {
      const shape = new T.Shape();
      section.polygon.forEach((point, index) => {
        const x = (point.x - STADIUM.width / 2) * STADIUM_3D_ASSUMPTIONS.drawingScale;
        const y = -(point.y - STADIUM.height / 2) * STADIUM_3D_ASSUMPTIONS.drawingScale;
        if (index) shape.lineTo(x, y); else shape.moveTo(x, y);
      });
      shape.closePath();
      const material = new T.MeshStandardMaterial({ color: section.surfaceId === "lower-bowl" ? 0xb9c0c6 : 0xaab5bf,
        roughness: 0.9, side: T.DoubleSide });
      const mesh = new T.Mesh(new T.ShapeGeometry(shape), material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = surfaceElevation(section.surfaceId);
      mesh.userData.surface = section.surfaceId;
      mesh.userData.sectionId = section.id;
      group.add(mesh);
    }

    const concourseMaterial = new T.MeshStandardMaterial({ color: 0xc5ccd1, roughness: 0.95 });
    for (const edge of this.router.network.edges.filter(edge =>
      !edge.transfer && edge.kind !== "gate" && this.router.nodes.get(edge.from)!.surfaceId === "concourse")) {
      this.addEdgeSegments(group, edge, concourseMaterial, 0.055, false);
    }
    const connectionMaterial = new T.MeshStandardMaterial({ color: 0x6f7f8d, roughness: 0.8 });
    for (const edge of this.router.network.edges.filter(edge => edge.transfer))
      this.addEdgeSegments(group, edge, connectionMaterial, edge.kind === "ramp" ? 0.13 : 0.1, true);

    for (const gate of STADIUM.gates) {
      const data = STADIUM_DESTINATIONS[gate.id as keyof typeof STADIUM_DESTINATIONS];
      const marker = new T.Mesh(new T.BoxGeometry(1.35, 1.3, 0.35), new T.MeshStandardMaterial({ color: data.color }));
      marker.position.copy(this.world(gate.at, 0.65)); marker.userData.surface = "exterior"; marker.userData.gateId = gate.id;
      group.add(marker);
      const label = this.labelSprite(data.label, data.color);
      label.position.copy(this.world(gate.at, 1.75)); label.userData.surface = "exterior"; group.add(label);
    }
    this.routeGroup = new T.Group(); this.scene!.add(this.routeGroup);
  }

  private addEdgeSegments(group: import("three").Group, edge: NavigationEdge,
    material: import("three").Material, radius: number, connection: boolean) {
    const fromSurface = this.router.nodes.get(edge.from)!.surfaceId;
    const toSurface = this.router.nodes.get(edge.to)!.surfaceId;
    for (let i = 1; i < edge.points.length; i++) {
      const aT = (i - 1) / (edge.points.length - 1), bT = i / (edge.points.length - 1);
      const a = this.world(edge.points[i - 1], surfaceElevation(fromSurface) * (1 - aT) + surfaceElevation(toSurface) * aT);
      const b = this.world(edge.points[i], surfaceElevation(fromSurface) * (1 - bT) + surfaceElevation(toSurface) * bT);
      const mesh = this.cylinderBetween(a, b, radius, material);
      mesh.userData.surface = fromSurface; mesh.userData.connection = connection; mesh.userData.edgeId = edge.id;
      group.add(mesh);
    }
  }

  private cylinderBetween(a: import("three").Vector3, b: import("three").Vector3, radius: number, material: import("three").Material) {
    const T = this.THREE!, direction = new T.Vector3().subVectors(b, a);
    const mesh = new T.Mesh(new T.CylinderGeometry(radius, radius, direction.length(), 6), material);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), direction.normalize());
    return mesh;
  }

  private labelSprite(text: string, color: string) {
    const T = this.THREE!, canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 96;
    const context = canvas.getContext("2d")!; context.fillStyle = "rgba(255,255,255,.94)"; context.roundRect(8, 8, 240, 80, 18); context.fill();
    context.strokeStyle = color; context.lineWidth = 8; context.stroke(); context.fillStyle = "#17212b";
    context.font = "700 40px system-ui"; context.textAlign = "center"; context.textBaseline = "middle"; context.fillText(text, 128, 50);
    const sprite = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(canvas), transparent: true }));
    sprite.scale.set(2.4, 0.9, 1); return sprite;
  }

  private buildCrowd() {
    const T = this.THREE!, count = 1000;
    const material = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 });
    this.bodies = new T.InstancedMesh(new T.CylinderGeometry(0.16, 0.22, 0.82, 6), material, count);
    this.heads = new T.InstancedMesh(new T.SphereGeometry(0.18, 7, 5), material.clone(), count);
    const ringMaterial = new T.MeshBasicMaterial({ color: 0xffffff, side: T.DoubleSide });
    this.rings = new T.InstancedMesh(new T.TorusGeometry(0.34, 0.055, 5, 12), ringMaterial, count);
    this.markers = new T.InstancedMesh(new T.OctahedronGeometry(0.2), new T.MeshBasicMaterial({ color: STADIUM_REFERENCE_ROUTE_COLOR }), count);
    for (const mesh of [this.bodies, this.heads, this.rings, this.markers]) {
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage); mesh.frustumCulled = false; this.scene!.add(mesh);
    }
  }

  private updateCrowd(frame: StadiumRenderFrame) {
    const T = this.THREE!, object = new T.Object3D(), color = new T.Color();
    let visiblePeople = 0, visibleTransfers = 0;
    this.personIds = frame.people.map(person => person.id);
    frame.people.forEach((person, index) => {
      const visible = person.movementState !== "evacuated" && levelShowsSurface(this.level, person.surfaceId) &&
        (this.level !== "connections" || person.transferEdgeId !== null);
      if (visible) { visiblePeople++; if (person.transferEdgeId) visibleTransfers++; }
      const point = this.personWorld(person);
      const moving = frame.running && !person.waiting && !person.stranded && person.movementState !== "seated" && person.movementState !== "node";
      const bob = moving ? Math.sin(frame.time * 8 + person.id) * 0.045 : 0;
      const selected = person.id === this.selectedPersonId || (this.selectedSectionId !== null && person.sectionId === this.selectedSectionId);
      object.position.set(point.x, point.y + 0.47 + bob, point.z); object.scale.setScalar(visible ? selected ? 1.28 : 1 : 0); object.rotation.set(0, 0, 0); object.updateMatrix();
      this.bodies!.setMatrixAt(index, object.matrix); this.bodies!.setColorAt(index, color.set(destinationColor(person.targetGateId)));
      object.position.y = point.y + 1.02 + bob; object.updateMatrix(); this.heads!.setMatrixAt(index, object.matrix); this.heads!.setColorAt(index, color);
      const showRing = visible && (person.waiting || person.stranded || selected);
      object.position.set(point.x, point.y + 0.06, point.z); object.rotation.set(Math.PI / 2, 0, 0); object.scale.setScalar(showRing ? selected ? 1.35 : 1 : 0); object.updateMatrix();
      this.rings!.setMatrixAt(index, object.matrix); this.rings!.setColorAt(index, color.set(person.stranded ? STADIUM_BLOCKED_COLOR : "#ffffff"));
      object.position.set(point.x, point.y + 1.55, point.z); object.rotation.set(0, frame.time * 2, Math.PI / 4); object.scale.setScalar(visible && person.rerouting ? 1 : 0); object.updateMatrix();
      this.markers!.setMatrixAt(index, object.matrix);
    });
    for (const mesh of [this.bodies!, this.heads!, this.rings!, this.markers!]) {
      mesh.count = frame.people.length; mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.container.dataset.visiblePeople = String(visiblePeople);
    this.container.dataset.visibleTransfers = String(visibleTransfers);
  }

  private personWorld(person: StadiumRenderPerson) {
    let elevation = person.surfaceId ? surfaceElevation(person.surfaceId) : STADIUM_3D_ASSUMPTIONS.concourseElevation;
    if (person.transferEdgeId && person.transferProgress !== null) {
      const edge = this.router.edges.get(person.transferEdgeId)!;
      const from = surfaceElevation(this.router.nodes.get(edge.from)!.surfaceId);
      const to = surfaceElevation(this.router.nodes.get(edge.to)!.surfaceId);
      elevation = from + (to - from) * person.transferProgress;
    }
    return this.world(person.position, elevation);
  }

  private updateRoutes(frame: StadiumRenderFrame) {
    if (!this.routeGroup || !this.THREE) return;
    for (const child of this.routeGroup.children) {
      const mesh = child as import("three").Line;
      mesh.geometry.dispose(); (mesh.material as import("three").Material).dispose();
    }
    this.routeGroup.clear();
    let routes: { steps: readonly StadiumRouteStep[]; gateId: string | null }[] = [];
    if (this.selectedPersonId !== null) {
      const person = frame.people.find(candidate => candidate.id === this.selectedPersonId);
      if (person) routes = [{ steps: person.remainingRoute, gateId: person.targetGateId }];
    } else if (this.selectedSectionId) {
      const unique = new Map<string, { steps: readonly StadiumRouteStep[]; gateId: string | null }>();
      for (const person of frame.people.filter(candidate => candidate.sectionId === this.selectedSectionId && candidate.remainingRoute.length)) {
        const key = person.remainingRoute.map(step => step.edgeId).join("|");
        if (!unique.has(key)) unique.set(key, { steps: person.remainingRoute, gateId: person.targetGateId });
      }
      routes = [...unique.values()];
    }
    for (const route of routes) this.addRouteLine(route.steps, destinationColor(route.gateId));
  }

  private addRouteLine(steps: readonly StadiumRouteStep[], color: string) {
    const T = this.THREE!;
    for (const step of steps) {
      const edge = this.router.edges.get(step.edgeId)!;
      const fromSurface = this.router.nodes.get(step.from)!.surfaceId, toSurface = this.router.nodes.get(step.to)!.surfaceId;
      const points = (step.from === edge.from ? edge.points : [...edge.points].reverse()).map((point, index, all) => {
        const t = all.length === 1 ? 0 : index / (all.length - 1);
        return this.world(point, surfaceElevation(fromSurface) * (1 - t) + surfaceElevation(toSurface) * t + 0.12);
      });
      const line = new T.Line(new T.BufferGeometry().setFromPoints(points), new T.LineBasicMaterial({ color, linewidth: 3 }));
      this.routeGroup!.add(line);
    }
  }

  private updateFollow(frame: StadiumRenderFrame) {
    if (!this.following || this.selectedPersonId === null || !this.camera || !this.controls) return;
    const person = frame.people.find(candidate => candidate.id === this.selectedPersonId);
    if (!person || person.movementState === "evacuated") {
      this.following = false; this.preset("overview"); this.onFollowEnded(); return;
    }
    const point = this.personWorld(person), offset = new this.THREE!.Vector3(4.5, 3.5, 4.5);
    this.controls.target.lerp(point, 0.2); this.camera.position.lerp(point.clone().add(offset), 0.12);
  }

  private pick(event: MouseEvent) {
    if (!this.THREE || !this.camera || !this.renderer || !this.bodies || !this.heads) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new this.THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    const raycaster = new this.THREE.Raycaster(); raycaster.setFromCamera(mouse, this.camera);
    const hit = raycaster.intersectObjects([this.bodies, this.heads], false)[0];
    if (hit?.instanceId !== undefined) this.onSelectPerson(this.personIds[hit.instanceId]);
  }

  private resize() {
    const width = Math.max(1, this.container.clientWidth), height = Math.max(320, this.container.clientHeight);
    if (width === this.lastWidth && height === this.lastHeight) return;
    this.lastWidth = width; this.lastHeight = height;
    this.renderer!.setSize(width, height, false); this.camera!.aspect = width / height; this.camera!.updateProjectionMatrix();
  }

  private recordPerformance(renderMs: number) {
    const now = performance.now();
    if (!this.sampleStarted) this.sampleStarted = now;
    this.sampleFrames++; this.sampleRenderMs += renderMs;
    if (now - this.sampleStarted < 1000) return;
    const seconds = (now - this.sampleStarted) / 1000;
    this.performanceOutput.textContent = `${(this.sampleFrames / seconds).toFixed(0)} render FPS · ${(this.sampleRenderMs / this.sampleFrames).toFixed(1)} ms render`;
    this.performanceOutput.dataset.fps = String(this.sampleFrames / seconds);
    this.performanceOutput.dataset.renderMs = String(this.sampleRenderMs / this.sampleFrames);
    this.sampleStarted = now; this.sampleFrames = 0; this.sampleRenderMs = 0;
  }

  dispose() {
    this.controls?.dispose(); this.renderer?.dispose();
    this.scene?.traverse(object => {
      const mesh = object as import("three").Mesh;
      mesh.geometry?.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      materials.forEach(material => material.dispose());
    });
    this.container.replaceChildren();
  }
}

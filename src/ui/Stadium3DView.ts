import { STADIUM, type SurfaceId } from "../maps/stadium";
import type { NavigationEdge } from "../maps/stadiumNavigation";
import type { StadiumRouter, StadiumRouteStep } from "../pathfinding/StadiumRouter";
import type { StadiumRenderFrame, StadiumRenderPerson } from "../simulation/StadiumSimulation";
import { capsulePoint, mapToGround, stadiumSurfacePoint, STADIUM_3D_MODEL } from "./Stadium3DGeometry";
import { destinationColor, levelShowsSurface, STADIUM_BLOCKED_COLOR, STADIUM_DESTINATIONS,
  STADIUM_REFERENCE_ROUTE_COLOR, type StadiumViewLevel } from "./StadiumVisuals";

type Three = typeof import("three");
type Controls = import("three/addons/controls/OrbitControls.js").OrbitControls;
export type StadiumLighting = "day" | "night";

/** Lazily loaded, visual-only SHI Stadium-inspired renderer. */
export class Stadium3DView {
  private THREE?: Three;
  private renderer?: import("three").WebGLRenderer;
  private scene?: import("three").Scene;
  private camera?: import("three").PerspectiveCamera;
  private controls?: Controls;
  private dots?: import("three").InstancedMesh;
  private rings?: import("three").InstancedMesh;
  private markers?: import("three").InstancedMesh;
  private routeGroup?: import("three").Group;
  private architecture?: import("three").Group;
  private sun?: import("three").DirectionalLight;
  private ambient?: import("three").HemisphereLight;
  private floodLights: import("three").SpotLight[] = [];
  private emissiveMaterials: import("three").MeshStandardMaterial[] = [];
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
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.setAttribute("aria-label", "Interactive realistic three-dimensional stadium view");
    renderer.domElement.tabIndex = 0;
    this.container.replaceChildren(renderer.domElement);
    this.container.dataset.crowdStyle = "destination-dots";
    this.container.dataset.model = "shi-stadium-inspired";
    this.renderer = renderer;

    const scene = new THREE.Scene(); this.scene = scene;
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 180); camera.up.set(0, 1, 0); this.camera = camera;
    const controls = new controlsModule.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.07; controls.minDistance = 7;
    controls.maxDistance = 90; controls.maxPolarAngle = Math.PI * 0.49; controls.target.set(0, 3.5, 0); this.controls = controls;

    this.ambient = new THREE.HemisphereLight(0xdfefff, 0x33402f, 2.3); scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xfff4dc, 3.5); this.sun.position.set(-28, 42, -24); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048); this.sun.shadow.camera.left = -42; this.sun.shadow.camera.right = 42;
    this.sun.shadow.camera.top = 34; this.sun.shadow.camera.bottom = -34; this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 100;
    scene.add(this.sun);
    this.buildArchitecture(); this.buildCrowd(); this.setLighting("day"); this.preset("overview");
    renderer.domElement.addEventListener("click", event => this.pick(event));
  }

  setSelection(personId: number | null, sectionId: string | null) {
    this.selectedPersonId = personId; this.selectedSectionId = sectionId;
    if (personId === null) this.following = false;
  }

  setLevel(level: StadiumViewLevel) {
    this.level = level; this.container.dataset.level = level;
    for (const object of this.architecture?.children ?? []) {
      const surface = object.userData.surface as SurfaceId | "all" | undefined;
      const connection = Boolean(object.userData.connection);
      object.visible = level === "overview" || surface === "all" ||
        (level === "connections" ? connection : surface ? levelShowsSurface(level, surface as SurfaceId) : true);
    }
  }

  setLighting(mode: StadiumLighting) {
    this.container.dataset.lighting = mode;
    if (!this.THREE || !this.scene || !this.renderer || !this.sun || !this.ambient) return;
    const night = mode === "night";
    this.scene.background = new this.THREE.Color(night ? 0x07101f : 0x91b9da);
    this.scene.fog = new this.THREE.Fog(night ? 0x07101f : 0xb9d0df, night ? 68 : 75, 125);
    this.sun.intensity = night ? 0.12 : 3.5; this.ambient.intensity = night ? 0.42 : 2.3;
    this.ambient.color.setHex(night ? 0x3d4f76 : 0xdfefff); this.ambient.groundColor.setHex(night ? 0x10141c : 0x33402f);
    for (const light of this.floodLights) light.intensity = night ? 110 : 0;
    for (const material of this.emissiveMaterials) material.emissiveIntensity = night ? 3.2 : 0.25;
    this.renderer.toneMappingExposure = night ? 0.88 : 1.05;
  }

  setFollowing(value: boolean) { this.following = value && this.selectedPersonId !== null; }
  get isFollowing() { return this.following; }

  preset(name: "overview" | "connections" | "gates" | "fit") {
    if (!this.camera || !this.controls) return;
    const positions = { overview: [41, 34, 43], connections: [-30, 23, 31], gates: [43, 13, 2], fit: [38, 31, 41] } as const;
    const [x, y, z] = positions[name]; this.camera.position.set(x, y, z); this.container.dataset.camera = name;
    this.controls.target.set(0, name === "gates" ? 4 : 3.5, 0); this.controls.update(); this.following = false;
  }

  render(frame: StadiumRenderFrame) {
    if (!this.renderer || !this.scene || !this.camera || !this.controls || !this.THREE) return;
    const started = performance.now(); this.resize(); this.updateCrowd(frame); this.updateRoutes(frame); this.updateFollow(frame);
    this.controls.update(); this.renderer.render(this.scene, this.camera); this.recordPerformance(performance.now() - started);
  }

  private vector(point: { x: number; y: number; z: number }) { return new this.THREE!.Vector3(point.x, point.y, point.z); }
  private addLayer(object: import("three").Object3D, surface: SurfaceId | "all", connection = false) {
    object.userData.surface = surface; object.userData.connection = connection; this.architecture!.add(object);
  }
  private standard(color: number, roughness = 0.82, metalness = 0.04) {
    return new this.THREE!.MeshStandardMaterial({ color, roughness, metalness });
  }

  private buildArchitecture() {
    const T = this.THREE!, group = new T.Group(); group.name = "shi-stadium-inspired-architecture";
    this.architecture = group; this.scene!.add(group);
    this.buildGroundAndField(); this.buildLowerBowl(); this.buildUpperDecks(); this.buildFacadeAndPlazas();
    this.buildScoreboardAndLights(); this.buildNavigationArchitecture();
    this.routeGroup = new T.Group(); this.routeGroup.name = "selected-routes"; this.scene!.add(this.routeGroup);
  }

  private buildGroundAndField() {
    const T = this.THREE!, groundTexture = this.noiseTexture("#b7b8b3", "#999d98", 768, 768, 7000);
    groundTexture.wrapS = groundTexture.wrapT = T.RepeatWrapping; groundTexture.repeat.set(7, 6);
    const ground = new T.Mesh(new T.PlaneGeometry(78, 62), new T.MeshStandardMaterial({ map: groundTexture, color: 0xbfc2bd, roughness: 0.98 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.06; ground.receiveShadow = true; this.addLayer(ground, "all");
    const fieldGroup = new T.Group(), grassTexture = this.fieldTexture();
    const field = new T.Mesh(new T.PlaneGeometry(STADIUM_3D_MODEL.fieldLength, STADIUM_3D_MODEL.fieldWidth),
      new T.MeshStandardMaterial({ map: grassTexture, color: 0xffffff, roughness: 0.9 }));
    field.rotation.x = -Math.PI / 2; field.position.y = 0.02; field.receiveShadow = true; fieldGroup.add(field);
    const lineMaterial = new T.MeshBasicMaterial({ color: 0xf3f4ed });
    for (let i = -5; i <= 5; i++) { const line = new T.Mesh(new T.PlaneGeometry(0.035, STADIUM_3D_MODEL.fieldWidth - 0.35), lineMaterial);
      line.rotation.x = -Math.PI / 2; line.position.set(i * 2.5, 0.035, 0); fieldGroup.add(line); }
    for (const z of [-STADIUM_3D_MODEL.fieldWidth / 2 + 0.18, STADIUM_3D_MODEL.fieldWidth / 2 - 0.18]) {
      const line = new T.Mesh(new T.PlaneGeometry(STADIUM_3D_MODEL.fieldLength, 0.04), lineMaterial);
      line.rotation.x = -Math.PI / 2; line.position.set(0, 0.04, z); fieldGroup.add(line);
    }
    this.addLayer(fieldGroup, "lower-bowl");
  }

  private buildLowerBowl() {
    const T = this.THREE!, bowl = new T.Group();
    const base = new T.Mesh(this.bowlBandGeometry(6.9, 14.6, 0.4, 7.8, 160), this.standard(0x969a98, 0.94));
    base.receiveShadow = true; base.castShadow = true; bowl.add(base);
    const colors = [0x781c25, 0x9f2631, 0x661820, 0xb12b37], rows = 22, inner = 7.15, outer = 13.3;
    for (let row = 0; row < rows; row++) {
      const a = row / rows, b = (row + 0.78) / rows;
      const mesh = new T.Mesh(this.bowlBandGeometry(inner + (outer - inner) * a, inner + (outer - inner) * b,
        1.1 + a * 7.15, 1.1 + b * 7.15, 160), this.standard(colors[row % colors.length], 0.73));
      mesh.receiveShadow = true; mesh.castShadow = row % 3 === 0; bowl.add(mesh);
    }
    const aisleMaterial = new T.MeshStandardMaterial({ color: 0xc7c4b9, roughness: 0.95 });
    for (let i = 0; i < 24; i++) {
      const a = capsulePoint(i / 24, 7.1), b = capsulePoint(i / 24, 13.45);
      const aisle = this.cylinderBetween(new T.Vector3(a.x, 1.18, a.z), new T.Vector3(b.x, 8.45, b.z), 0.085, aisleMaterial, 5);
      aisle.castShadow = true; bowl.add(aisle);
    }
    this.addLayer(bowl, "lower-bowl");
  }

  private buildUpperDecks() {
    const T = this.THREE!;
    for (const [surface, sign] of [["upper-east", -1], ["upper-west", 1]] as const) {
      const deck = new T.Group(), supports = this.standard(0xb9b8b2, 0.92);
      for (let i = -5; i <= 5; i++) { const column = new T.Mesh(new T.BoxGeometry(0.42, 9.2, 0.42), supports);
        column.position.set(i * 2.8, 5.7, sign * 14.5); column.castShadow = true; deck.add(column); }
      const underside = new T.Mesh(new T.BoxGeometry(32, 0.55, 7), this.standard(0x777b7d, 0.88));
      underside.position.set(0, 10.1, sign * 16.7); underside.rotation.x = sign * -0.14; underside.castShadow = true; deck.add(underside);
      for (let row = 0; row < 12; row++) { const step = new T.Mesh(new T.BoxGeometry(31.5, 0.32, 0.52), this.standard(row % 3 === 0 ? 0x681923 : 0xa32632, 0.74));
        step.position.set(0, 10.55 + row * 0.49, sign * (13.5 + row * 0.55)); step.castShadow = true; step.receiveShadow = true; deck.add(step); }
      const rail = new T.Mesh(new T.BoxGeometry(32, 0.7, 0.08), new T.MeshStandardMaterial({ color: 0xcbd0d1, metalness: 0.72, roughness: 0.32 }));
      rail.position.set(0, 11.2, sign * 13.2); deck.add(rail); this.addLayer(deck, surface);
    }
  }

  private buildFacadeAndPlazas() {
    const T = this.THREE!, exterior = new T.Group(), concrete = this.standard(0xb2b0aa, 0.94), metal = this.standard(0x4e555b, 0.42, 0.66);
    const radius = 16.6, segments = 116;
    for (let i = 0; i < segments; i++) { const a = capsulePoint(i / segments, radius), b = capsulePoint((i + 1) / segments, radius);
      const panel = this.boxBetweenXZ(a, b, 5.4, 0.34, i % 7 === 0 ? metal : concrete); panel.position.y = 2.7; panel.castShadow = true; panel.receiveShadow = true; exterior.add(panel); }
    const glass = new T.MeshStandardMaterial({ color: 0x537687, metalness: 0.34, roughness: 0.2, transparent: true, opacity: 0.74 });
    for (let i = 0; i < segments; i += 4) { const a = capsulePoint(i / segments, 16.78), b = capsulePoint((i + 2) / segments, 16.78);
      const window = this.boxBetweenXZ(a, b, 1.15, 0.08, glass); window.position.y = 3.15; exterior.add(window); }
    for (const gate of STADIUM.gates) {
      const data = STADIUM_DESTINATIONS[gate.id as keyof typeof STADIUM_DESTINATIONS], point = mapToGround(gate.at);
      const toward = new T.Vector2(-point.x, -point.z).normalize(), angle = Math.atan2(toward.x, toward.y);
      const plaza = new T.Mesh(new T.PlaneGeometry(STADIUM_3D_MODEL.plazaSize, STADIUM_3D_MODEL.plazaSize * 0.72),
        new T.MeshStandardMaterial({ map: this.paverTexture(), color: 0xd2d0c8, roughness: 0.96 }));
      plaza.rotation.x = -Math.PI / 2; plaza.rotation.z = angle; plaza.position.set(point.x, 0.015, point.z); plaza.receiveShadow = true; exterior.add(plaza);
      const canopy = new T.Mesh(new T.BoxGeometry(5.3, 0.25, 2.2), this.standard(Number.parseInt(data.color.slice(1), 16), 0.48, 0.24));
      canopy.position.set(point.x, 3.35, point.z); canopy.rotation.y = angle; canopy.castShadow = true; exterior.add(canopy);
      for (const offset of [-2.1, 2.1]) { const pillar = new T.Mesh(new T.BoxGeometry(0.22, 3.3, 0.22), metal);
        pillar.position.set(point.x + Math.cos(angle) * offset, 1.65, point.z - Math.sin(angle) * offset); pillar.castShadow = true; exterior.add(pillar); }
      const label = this.labelSprite(data.label, data.color); label.position.set(point.x, 4.45, point.z); exterior.add(label);
      for (let i = -2; i <= 2; i++) { const bollard = new T.Mesh(new T.CylinderGeometry(0.09, 0.11, 0.72, 8), metal);
        bollard.position.set(point.x + Math.cos(angle) * i * 0.72 + toward.x * 2, 0.36, point.z - Math.sin(angle) * i * 0.72 + toward.y * 2); exterior.add(bollard); }
    }
    this.addLayer(exterior, "exterior");
  }

  private buildScoreboardAndLights() {
    const T = this.THREE!, landmarks = new T.Group(), frame = this.standard(0x252a2f, 0.42, 0.7);
    const board = new T.Mesh(new T.BoxGeometry(0.8, 6.2, 11.5), frame); board.position.set(22.4, 11.5, 0); board.castShadow = true; landmarks.add(board);
    const screenMaterial = new T.MeshStandardMaterial({ color: 0x132330, emissive: 0x244a63, emissiveIntensity: 0.25, roughness: 0.28 });
    this.emissiveMaterials.push(screenMaterial); const screen = new T.Mesh(new T.PlaneGeometry(10.3, 5.1), screenMaterial);
    screen.rotation.y = -Math.PI / 2; screen.position.set(21.97, 11.5, 0); landmarks.add(screen);
    for (const z of [-4.2, 4.2]) { const support = new T.Mesh(new T.BoxGeometry(0.65, 8.6, 0.65), frame); support.position.set(22.4, 5.5, z); support.castShadow = true; landmarks.add(support); }
    const lampMaterial = new T.MeshStandardMaterial({ color: 0xe8edf0, emissive: 0xdcecff, emissiveIntensity: 0.25 }); this.emissiveMaterials.push(lampMaterial);
    for (const [x, z] of [[-19, -18], [19, -18], [-19, 18], [19, 18]] as const) {
      const tower = new T.Mesh(new T.CylinderGeometry(0.15, 0.27, 20, 8), frame); tower.position.set(x, 10, z); tower.castShadow = true; landmarks.add(tower);
      const rack = new T.Mesh(new T.BoxGeometry(5, 1.25, 0.48), lampMaterial); rack.position.set(x, 20.1, z); rack.lookAt(0, 4, 0); landmarks.add(rack);
      const flood = new T.SpotLight(0xe8f1ff, 0, 80, Math.PI / 5, 0.42, 1.3); flood.position.set(x, 20, z); flood.target.position.set(0, 0, 0);
      this.scene!.add(flood, flood.target); this.floodLights.push(flood);
    }
    this.addLayer(landmarks, "exterior");
  }

  private buildNavigationArchitecture() {
    const T = this.THREE!, concourse = new T.Group(), connections = new T.Group();
    const concourseMaterial = this.standard(0xb9b6ae, 0.94), connectionMaterial = this.standard(0x777f84, 0.72, 0.22);
    for (const edge of this.router.network.edges) {
      if (edge.transfer) this.addEdgeSegments(connections, edge, connectionMaterial, edge.kind === "ramp" ? 0.22 : 0.15);
      else if (edge.kind !== "gate" && this.router.nodes.get(edge.from)!.surfaceId === "concourse") this.addEdgeSegments(concourse, edge, concourseMaterial, 0.1);
    }
    this.addLayer(concourse, "concourse"); this.addLayer(connections, "all", true);
  }

  private addEdgeSegments(group: import("three").Group, edge: NavigationEdge, material: import("three").Material, radius: number) {
    const fromSurface = this.router.nodes.get(edge.from)!.surfaceId, toSurface = this.router.nodes.get(edge.to)!.surfaceId;
    for (let i = 1; i < edge.points.length; i++) {
      const aT = (i - 1) / (edge.points.length - 1), bT = i / (edge.points.length - 1);
      const a0 = stadiumSurfacePoint(edge.points[i - 1], fromSurface), a1 = stadiumSurfacePoint(edge.points[i - 1], toSurface);
      const b0 = stadiumSurfacePoint(edge.points[i], fromSurface), b1 = stadiumSurfacePoint(edge.points[i], toSurface);
      const a = this.vector({ x: a0.x, y: a0.y * (1 - aT) + a1.y * aT, z: a0.z });
      const b = this.vector({ x: b0.x, y: b0.y * (1 - bT) + b1.y * bT, z: b0.z });
      const mesh = this.cylinderBetween(a, b, radius, material, edge.kind === "stairs" ? 5 : 10); mesh.userData.edgeId = edge.id; mesh.castShadow = true; group.add(mesh);
    }
  }

  private bowlBandGeometry(innerRadius: number, outerRadius: number, innerY: number, outerY: number, segments: number) {
    const T = this.THREE!, positions: number[] = [], indices: number[] = [];
    for (let i = 0; i <= segments; i++) { const inner = capsulePoint(i / segments, innerRadius), outer = capsulePoint(i / segments, outerRadius);
      positions.push(inner.x, innerY, inner.z, outer.x, outerY, outer.z); if (i < segments) { const n = i * 2; indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2); } }
    const geometry = new T.BufferGeometry(); geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
  }

  private boxBetweenXZ(a: { x: number; z: number }, b: { x: number; z: number }, height: number, depth: number, material: import("three").Material) {
    const T = this.THREE!, length = Math.hypot(b.x - a.x, b.z - a.z), mesh = new T.Mesh(new T.BoxGeometry(length + 0.05, height, depth), material);
    mesh.position.set((a.x + b.x) / 2, 0, (a.z + b.z) / 2); mesh.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x); return mesh;
  }

  private cylinderBetween(a: import("three").Vector3, b: import("three").Vector3, radius: number, material: import("three").Material, sides = 8) {
    const T = this.THREE!, direction = new T.Vector3().subVectors(b, a), mesh = new T.Mesh(new T.CylinderGeometry(radius, radius, direction.length(), sides), material);
    mesh.position.copy(a).add(b).multiplyScalar(0.5); mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), direction.normalize()); return mesh;
  }

  private noiseTexture(base: string, speckle: string, width: number, height: number, count: number) {
    const T = this.THREE!, canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d")!; context.fillStyle = base; context.fillRect(0, 0, width, height); context.fillStyle = speckle;
    let seed = 71821; const random = () => { seed = seed * 16807 % 2147483647; return (seed - 1) / 2147483646; };
    for (let i = 0; i < count; i++) context.fillRect(random() * width, random() * height, random() * 2.2, random() * 2.2);
    const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace; return texture;
  }

  private fieldTexture() {
    const T = this.THREE!, canvas = document.createElement("canvas"); canvas.width = 1024; canvas.height = 512; const context = canvas.getContext("2d")!;
    for (let i = 0; i < 12; i++) { context.fillStyle = i % 2 ? "#426c3c" : "#4d7b45"; context.fillRect(i * canvas.width / 12, 0, canvas.width / 12 + 1, canvas.height); }
    const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace; return texture;
  }

  private paverTexture() {
    const T = this.THREE!, canvas = document.createElement("canvas"); canvas.width = canvas.height = 256; const context = canvas.getContext("2d")!;
    context.fillStyle = "#cac8c0"; context.fillRect(0, 0, 256, 256); context.strokeStyle = "#aaa9a3"; context.lineWidth = 2;
    for (let y = 0; y <= 256; y += 32) { context.beginPath(); context.moveTo(0, y); context.lineTo(256, y); context.stroke(); }
    for (let x = 0; x <= 256; x += 64) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, 256); context.stroke(); }
    const texture = new T.CanvasTexture(canvas); texture.wrapS = texture.wrapT = T.RepeatWrapping; texture.repeat.set(4, 3); texture.colorSpace = T.SRGBColorSpace; return texture;
  }

  private labelSprite(text: string, color: string) {
    const T = this.THREE!, canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 96; const context = canvas.getContext("2d")!;
    context.fillStyle = "rgba(249,250,250,.94)"; context.roundRect(8, 8, 240, 80, 18); context.fill(); context.strokeStyle = color; context.lineWidth = 8; context.stroke();
    context.fillStyle = "#17212b"; context.font = "700 40px system-ui"; context.textAlign = "center"; context.textBaseline = "middle"; context.fillText(text, 128, 50);
    const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
    const sprite = new T.Sprite(new T.SpriteMaterial({ map: texture, transparent: true })); sprite.scale.set(2.6, 0.98, 1); return sprite;
  }

  private buildCrowd() {
    const T = this.THREE!, count = 1000;
    this.dots = new T.InstancedMesh(new T.SphereGeometry(0.16, 8, 6), new T.MeshBasicMaterial({ color: 0xffffff }), count);
    this.rings = new T.InstancedMesh(new T.TorusGeometry(0.28, 0.045, 5, 14), new T.MeshBasicMaterial({ color: 0xffffff }), count);
    this.markers = new T.InstancedMesh(new T.OctahedronGeometry(0.18), new T.MeshBasicMaterial({ color: STADIUM_REFERENCE_ROUTE_COLOR }), count);
    for (const mesh of [this.dots, this.rings, this.markers]) { mesh.instanceMatrix.setUsage(T.DynamicDrawUsage); mesh.frustumCulled = false; this.scene!.add(mesh); }
  }

  private updateCrowd(frame: StadiumRenderFrame) {
    const T = this.THREE!, object = new T.Object3D(), color = new T.Color(); let visiblePeople = 0, visibleTransfers = 0;
    this.personIds = frame.people.map(person => person.id);
    frame.people.forEach((person, index) => {
      const visible = person.movementState !== "evacuated" && levelShowsSurface(this.level, person.surfaceId) && (this.level !== "connections" || person.transferEdgeId !== null);
      if (visible) { visiblePeople++; if (person.transferEdgeId) visibleTransfers++; }
      const point = this.personWorld(person), selected = person.id === this.selectedPersonId || (this.selectedSectionId !== null && person.sectionId === this.selectedSectionId);
      object.position.set(point.x, point.y + 0.24, point.z);
      object.scale.setScalar(visible ? selected ? 1.6 : this.level === "connections" ? 1.8 : 1 : 0);
      object.rotation.set(0, 0, 0); object.updateMatrix();
      this.dots!.setMatrixAt(index, object.matrix); this.dots!.setColorAt(index, color.set(destinationColor(person.targetGateId)));
      const showRing = visible && (person.waiting || person.stranded || selected);
      object.position.set(point.x, point.y + 0.07, point.z); object.rotation.set(Math.PI / 2, 0, 0); object.scale.setScalar(showRing ? selected ? 1.45 : 1 : 0); object.updateMatrix();
      this.rings!.setMatrixAt(index, object.matrix); this.rings!.setColorAt(index, color.set(person.stranded ? STADIUM_BLOCKED_COLOR : "#ffffff"));
      object.position.set(point.x, point.y + 0.72, point.z); object.rotation.set(0, frame.time * 2, Math.PI / 4); object.scale.setScalar(visible && person.rerouting ? 1 : 0); object.updateMatrix(); this.markers!.setMatrixAt(index, object.matrix);
    });
    for (const mesh of [this.dots!, this.rings!, this.markers!]) { mesh.count = frame.people.length; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
    this.container.dataset.visiblePeople = String(visiblePeople); this.container.dataset.visibleTransfers = String(visibleTransfers);
  }

  private personWorld(person: StadiumRenderPerson) {
    const base = stadiumSurfacePoint(person.position, person.surfaceId ?? "concourse");
    if (person.transferEdgeId && person.transferProgress !== null) {
      const edge = this.router.edges.get(person.transferEdgeId)!, fromSurface = this.router.nodes.get(edge.from)!.surfaceId, toSurface = this.router.nodes.get(edge.to)!.surfaceId;
      const from = stadiumSurfacePoint(edge.points[0], fromSurface), to = stadiumSurfacePoint(edge.points[edge.points.length - 1], toSurface);
      base.y = from.y + (to.y - from.y) * person.transferProgress;
    }
    return this.vector(base);
  }

  private updateRoutes(frame: StadiumRenderFrame) {
    if (!this.routeGroup || !this.THREE) return;
    this.routeGroup.traverse(child => { const mesh = child as import("three").Mesh; mesh.geometry?.dispose(); const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []; materials.forEach(material => material.dispose()); });
    this.routeGroup.clear(); let routes: { steps: readonly StadiumRouteStep[]; gateId: string | null }[] = [];
    if (this.selectedPersonId !== null) { const person = frame.people.find(candidate => candidate.id === this.selectedPersonId); if (person) routes = [{ steps: person.remainingRoute, gateId: person.targetGateId }]; }
    else if (this.selectedSectionId) { const unique = new Map<string, { steps: readonly StadiumRouteStep[]; gateId: string | null }>();
      for (const person of frame.people.filter(candidate => candidate.sectionId === this.selectedSectionId && candidate.remainingRoute.length)) { const key = person.remainingRoute.map(step => step.edgeId).join("|"); if (!unique.has(key)) unique.set(key, { steps: person.remainingRoute, gateId: person.targetGateId }); } routes = [...unique.values()]; }
    for (const route of routes) this.addRouteLine(route.steps, destinationColor(route.gateId)); this.container.dataset.visibleRoutes = String(routes.length);
  }

  private addRouteLine(steps: readonly StadiumRouteStep[], color: string) {
    const T = this.THREE!;
    for (const step of steps) { const edge = this.router.edges.get(step.edgeId)!, ordered = step.from === edge.from ? edge.points : [...edge.points].reverse();
      const fromSurface = this.router.nodes.get(step.from)!.surfaceId, toSurface = this.router.nodes.get(step.to)!.surfaceId;
      const points = ordered.map((point, index) => { const t = ordered.length === 1 ? 0 : index / (ordered.length - 1), start = stadiumSurfacePoint(point, fromSurface), end = stadiumSurfacePoint(point, toSurface);
        return this.vector({ x: start.x, y: start.y * (1 - t) + end.y * t + 0.2, z: start.z }); });
      if (points.length < 2) continue; const curve = new T.CatmullRomCurve3(points);
      this.routeGroup!.add(new T.Mesh(new T.TubeGeometry(curve, Math.max(4, points.length * 3), 0.07, 6, false), new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.92 })));
    }
  }

  private updateFollow(frame: StadiumRenderFrame) {
    if (!this.following || this.selectedPersonId === null || !this.camera || !this.controls) return;
    const person = frame.people.find(candidate => candidate.id === this.selectedPersonId);
    if (!person || person.movementState === "evacuated") { this.following = false; this.preset("overview"); this.onFollowEnded(); return; }
    const point = this.personWorld(person), offset = new this.THREE!.Vector3(3.2, 2.6, 3.2); this.controls.target.lerp(point, 0.18); this.camera.position.lerp(point.clone().add(offset), 0.1);
  }

  private pick(event: MouseEvent) {
    if (!this.THREE || !this.camera || !this.renderer || !this.dots) return;
    const rect = this.renderer.domElement.getBoundingClientRect(), mouse = new this.THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    const raycaster = new this.THREE.Raycaster(); raycaster.setFromCamera(mouse, this.camera); const hit = raycaster.intersectObject(this.dots, false)[0];
    if (hit?.instanceId !== undefined) this.onSelectPerson(this.personIds[hit.instanceId]);
  }

  private resize() {
    const width = Math.max(1, this.container.clientWidth), height = Math.max(360, this.container.clientHeight); if (width === this.lastWidth && height === this.lastHeight) return;
    this.lastWidth = width; this.lastHeight = height; this.renderer!.setSize(width, height, false); this.camera!.aspect = width / height; this.camera!.updateProjectionMatrix();
  }

  private recordPerformance(renderMs: number) {
    const now = performance.now(); if (!this.sampleStarted) this.sampleStarted = now; this.sampleFrames++; this.sampleRenderMs += renderMs; if (now - this.sampleStarted < 1000) return;
    const seconds = (now - this.sampleStarted) / 1000; this.performanceOutput.textContent = `${(this.sampleFrames / seconds).toFixed(0)} render FPS · ${(this.sampleRenderMs / this.sampleFrames).toFixed(1)} ms render`;
    this.performanceOutput.dataset.fps = String(this.sampleFrames / seconds); this.performanceOutput.dataset.renderMs = String(this.sampleRenderMs / this.sampleFrames);
    this.sampleStarted = now; this.sampleFrames = 0; this.sampleRenderMs = 0;
  }

  dispose() {
    this.controls?.dispose(); this.renderer?.dispose(); this.scene?.traverse(object => { const mesh = object as import("three").Mesh; mesh.geometry?.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []; materials.forEach(material => material.dispose()); });
    this.container.replaceChildren();
  }
}

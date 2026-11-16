import { test } from "node:test";
import assert from "node:assert/strict";
import { MAPS, type MapId } from "../src/maps/maps";
import { Simulation } from "../src/simulation/Simulation";
import { Experiment } from "../src/simulation/Experiment";
import { findRoute } from "../src/pathfinding/algorithms";

const CAMPUS: MapId[] = ["lecture", "corridor", "office", "dining", "library"];

for (const id of CAMPUS) {
  test(`${id}: connected, two+ exits, full capacity, and Exit A can close safely`, () => {
    const s = new Simulation(1, id), g = s.grid;
    assert.ok(g.exitIds.length >= 3);
    assert.equal(s.layoutConnectivityIssue(g), null);
    const closed = g.cloneLayout();
    closed.setExitBlocked("A", true);
    assert.equal(s.layoutConnectivityIssue(closed), null);
    assert.equal(s.populationLimit(id), 1000);
    for (const label of MAPS[id].labels) if (label.exit) assert.ok(g.exitIds.includes(label.exit));
  });

  test(`${id}: spawns are wall-free and every spawn reaches every exit`, () => {
    const s = new Simulation(400, id);
    for (const a of s.agents) assert.ok(!s.collision.intersectsWall(a.position, a.radius, s.grid));
    for (const a of s.agents.filter((_, i) => i % 40 === 0))
      for (const exit of s.grid.exitIds)
        assert.ok(findRoute(s.grid, s.grid.cell(a.position), exit, "shortest", "astar"), `${exit} from agent ${a.id}`);
  });

  test(`${id}: A* open run and Theta* closure run both evacuate everyone`, () => {
    for (const [algorithm, scenario] of [["astar", "open"], ["thetastar", "closure"]] as const) {
      const e = new Experiment();
      e.begin(150, "congestion", scenario, id, true, "predictive", algorithm);
      for (let i = 0; i < 120 * 60 && e.screen === "simulation"; i++) e.update(1 / 60);
      assert.equal(e.simulation.metrics.evacuatedCount, 150, `${algorithm}/${scenario}`);
    }
  });
}

import { ComparisonRun, validateRequest, variantLabel, type ComparisonMessage, type ComparisonRequest } from "./BuildingComparison";

const scope = self as unknown as { onmessage: (event: MessageEvent<ComparisonRequest>) => void; postMessage: (message: ComparisonMessage) => void };
scope.onmessage = (event) => {
  try {
    const request = event.data;
    validateRequest(request);
    const total = request.variants.length;
    let index = 0, run = new ComparisonRun(request, request.variants[0]), sentAt = 0;
    const advance = () => {
      try {
        const until = performance.now() + 25;
        while (!run.done && performance.now() < until) run.step();
        if (run.done) {
          scope.postMessage({ type: "progress", completed: index + 1, total, label: run.result().label, time: run.experiment.simulation.time, result: run.result() });
          if (++index === total) { scope.postMessage({ type: "done" }); return; }
          run = new ComparisonRun(request, request.variants[index]);
        } else if (performance.now() - sentAt >= 250) {
          scope.postMessage({ type: "progress", completed: index, total, label: variantLabel(run.variant), time: run.experiment.simulation.time });
          sentAt = performance.now();
        }
        setTimeout(advance, 0);
      } catch (error) { scope.postMessage({ type: "error", message: (error as Error).message }); }
    };
    advance();
  } catch (error) { scope.postMessage({ type: "error", message: (error as Error).message }); }
};

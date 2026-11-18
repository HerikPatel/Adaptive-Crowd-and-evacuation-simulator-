import { experimentJobs, experimentTimeLimit, StadiumExperimentRun, type ExperimentMessage, type ExperimentRequest } from "./StadiumExperiment";

const scope = self as unknown as { onmessage: (event: MessageEvent<ExperimentRequest>) => void; postMessage: (message: ExperimentMessage) => void };
scope.onmessage = event => {
  try {
    const jobs = experimentJobs(event.data), timeLimit = experimentTimeLimit(event.data);
    let index = 0, run = new StadiumExperimentRun(jobs[0], timeLimit), sentAt = 0;
    const advance = () => {
      try {
        const until = performance.now() + 25;
        while (!run.done && performance.now() < until) run.step();
        if (run.done) {
          scope.postMessage({ type: "progress", completed: index + 1, total: jobs.length, job: jobs[index], time: run.simulation.time, result: run.result() });
          if (++index === jobs.length) { scope.postMessage({ type: "done" }); return; }
          run = new StadiumExperimentRun(jobs[index], timeLimit);
        } else if (performance.now() - sentAt >= 250) {
          scope.postMessage({ type: "progress", completed: index, total: jobs.length, job: jobs[index], time: run.simulation.time }); sentAt = performance.now();
        }
        setTimeout(advance, 0);
      } catch (error) { scope.postMessage({ type: "error", message: (error as Error).message }); }
    };
    advance();
  } catch (error) { scope.postMessage({ type: "error", message: (error as Error).message }); }
};

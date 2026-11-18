ORCA pair constraints and velocity linear programs in src/collision/OrcaSolver.ts
are adapted from the RVO2 Library's src/Agent.cc (Apache-2.0).
Copyright 2008 University of North Carolina at Chapel Hill.
Authors: Jur van den Berg, Stephen J. Guy, Jamie Snape, Ming C. Lin, Dinesh Manocha.
Source: https://github.com/snape/RVO2
Research: https://gamma-web.iacs.umd.edu/ORCA/
License: LICENSE.txt in this directory.

Project modifications: TypeScript implementation; deterministic degenerate-pair
handling; spatial-hash neighbors; conservative grid-wall supporting planes;
optional right-hand preference; diagnostics and integration with the existing
independent contact/sweep stage. RVO2 polygon-obstacle code is not included.

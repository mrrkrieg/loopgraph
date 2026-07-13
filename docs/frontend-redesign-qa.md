# Frontend Redesign QA

## Scope

Loopgraph frontend is now organized around Brain, Management, Loops, and Daily. The Obsidian-style graph is implemented as a custom React/SVG canvas inspired by the behavior of `HEmile/obsidian-neo4j-graph-view`; no GPL source code was copied or imported.

## Checklist

- [ ] Left nav has only Brain, Management, Loops, Daily.
- [ ] `/` opens Brain.
- [ ] `/topology` redirects to Brain.
- [ ] `/dashboard` redirects to Daily.
- [ ] Brain graph has no giant semantic filter sidebar.
- [ ] Brain graph default view is understandable in 5 seconds.
- [ ] Brain graph defaults to company brain, company management loop, department loops, and workflow loops.
- [ ] Default Brain graph does not render every semantic node.
- [ ] Data, Metrics, Reviews, and Improve toggles add internals only when enabled.
- [ ] Graph has no random background lines.
- [ ] Lines attach to node circle boundaries.
- [ ] Zoom and pan keep nodes, labels, and lines aligned in one SVG transform.
- [ ] Dragging a node keeps edges attached without blinking.
- [ ] Hover highlights direct neighbors and fades distant nodes.
- [ ] Double-clicking a loop opens a centered local graph.
- [ ] Local graph depth controls show only the requested neighborhood.
- [ ] Management tab explains company brain and event routing.
- [ ] Loops tab shows list/detail/contract without graph clutter.
- [ ] Daily tab shows operating summary, not topology.
- [ ] Console has no framework overlay, runtime errors, or React warnings.
- [ ] Desktop and mobile layouts remain usable.

## Manual Browser Routes

- `/brain`
- `/brain` with Data, Metrics, Reviews, and Improve enabled
- `/management`
- `/loops`
- `/loops?department=sales`
- `/daily`
- `/topology`
- `/dashboard`

## License Note

`HEmile/obsidian-neo4j-graph-view` is GPL-3.0 and old Neo4j/Python plugin code. This redesign uses it only as a reference for UX behavior: selective styling, expansion/hiding, typed links, local graph navigation, and an Obsidian-like graph feel. The implementation in this repo is original React/SVG/TypeScript code.

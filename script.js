"use strict";

let graphData = {};
let cy = null;
let history = [];
let currentStep = 0;
let isInitialized = false;

const $ = (id) => document.getElementById(id);
const clone = (value) => structuredClone(value);

function normalizeGraph(input) {
  if (!input || Array.isArray(input) || typeof input !== "object") {
    throw new Error("The graph must be a JSON object.");
  }

  const graph = {};
  const nodes = new Set(Object.keys(input));
  for (const [u, neighbors] of Object.entries(input)) {
    if (!neighbors || Array.isArray(neighbors) || typeof neighbors !== "object") {
      throw new Error(`Neighbors of ${u} must be an object.`);
    }
    graph[u] = {};
    for (const [v, rawWeight] of Object.entries(neighbors)) {
      const weight = Number(rawWeight);
      if (!Number.isFinite(weight)) throw new Error(`Weight ${u} -> ${v} must be numeric.`);
      graph[u][v] = weight;
      nodes.add(v);
    }
  }
  for (const node of nodes) if (!graph[node]) graph[node] = {};
  return graph;
}

function snapshot(data) {
  const state = clone(data);
  if (state.distances) {
    for (const key of Object.keys(state.distances)) {
      if (state.distances[key] === Infinity) state.distances[key] = "∞";
    }
  }
  return state;
}

function* dijkstraGenerator(graph, startNode) {
  for (const neighbors of Object.values(graph)) {
    for (const weight of Object.values(neighbors)) {
      if (weight < 0) throw new Error("Dijkstra cannot be used with negative edge weights.");
    }
  }

  const distances = Object.fromEntries(Object.keys(graph).map((n) => [n, Infinity]));
  const predecessors = Object.fromEntries(Object.keys(graph).map((n) => [n, null]));
  distances[startNode] = 0;
  const queue = [[0, startNode]];
  const visited = new Set();
  let step = 0;

  yield snapshot({ algorithm: "Dijkstra", step, action: `Initialize source ${startNode}`, currentNode: startNode, distances, predecessors, visited: [], frontier: [startNode] });

  while (queue.length) {
    queue.sort((a, b) => a[0] - b[0]);
    const [distance, u] = queue.shift();
    if (visited.has(u) || distance !== distances[u]) continue;
    visited.add(u);
    step++;
    yield snapshot({ algorithm: "Dijkstra", step, action: `Finalize ${u} with distance ${distance}`, currentNode: u, distances, predecessors, visited: [...visited], frontier: queue.map((x) => x[1]) });

    for (const [v, weight] of Object.entries(graph[u])) {
      const candidate = distances[u] + weight;
      const previous = distances[v];
      if (candidate < previous) {
        distances[v] = candidate;
        predecessors[v] = u;
        queue.push([candidate, v]);
        step++;
        yield snapshot({ algorithm: "Dijkstra", step, action: `Relax ${u} -> ${v}: min(${formatValue(previous)}, ${formatValue(distance)} + ${weight}) = ${candidate}`, currentNode: v, activeEdge: [u, v], distances, predecessors, visited: [...visited], frontier: [...new Set(queue.map((x) => x[1]))] });
      }
    }
  }
  step++;
  yield snapshot({ algorithm: "Dijkstra", step, action: "Algorithm complete", currentNode: null, distances, predecessors, visited: [...visited], frontier: [] });
}

function* bellmanFordGenerator(graph, startNode) {
  const nodes = Object.keys(graph);
  const edges = nodes.flatMap((u) => Object.entries(graph[u]).map(([v, w]) => [u, v, w]));
  const distances = Object.fromEntries(nodes.map((n) => [n, Infinity]));
  const predecessors = Object.fromEntries(nodes.map((n) => [n, null]));
  distances[startNode] = 0;
  let step = 0;

  yield snapshot({ algorithm: "Bellman-Ford", step, action: `Initialize source ${startNode}`, currentNode: startNode, distances, predecessors, visited: [], frontier: [startNode] });

  for (let pass = 1; pass <= nodes.length - 1; pass++) {
    let updated = false;
    step++;
    yield snapshot({ algorithm: "Bellman-Ford", step, action: `Start pass ${pass} of ${nodes.length - 1}`, currentNode: null, distances, predecessors, visited: [], frontier: [] });
    for (const [u, v, weight] of edges) {
      const du = distances[u];
      if (du !== Infinity && du + weight < distances[v]) {
        const previous = distances[v];
        distances[v] = du + weight;
        predecessors[v] = u;
        updated = true;
        step++;
        yield snapshot({ algorithm: "Bellman-Ford", step, action: `Relax ${u} -> ${v}: min(${formatValue(previous)}, ${formatValue(du)} + ${weight}) = ${distances[v]}`, currentNode: v, activeEdge: [u, v], distances, predecessors, visited: [], frontier: [] });
      }
    }
    if (!updated) break;
  }

  const negativeEdge = edges.find(([u, v, w]) => distances[u] !== Infinity && distances[u] + w < distances[v]);
  step++;
  yield snapshot({ algorithm: "Bellman-Ford", step, action: negativeEdge ? `Negative cycle detected through ${negativeEdge[0]} -> ${negativeEdge[1]}` : "Algorithm complete; no reachable negative cycle", currentNode: null, distances, predecessors, visited: [], frontier: [], negativeCycle: Boolean(negativeEdge) });
}

function* dfsGenerator(graph, startNode) {
  const visited = new Set();
  const predecessors = Object.fromEntries(Object.keys(graph).map((n) => [n, null]));
  const stack = [startNode];
  let step = 0;

  yield snapshot({ algorithm: "DFS", step, action: `Push start node ${startNode}`, currentNode: startNode, visited: [], predecessors, frontier: [...stack] });
  while (stack.length) {
    const u = stack.pop();
    if (visited.has(u)) continue;
    visited.add(u);
    step++;
    yield snapshot({ algorithm: "DFS", step, action: `Visit ${u}`, currentNode: u, visited: [...visited], predecessors, frontier: [...stack] });

    const neighbors = Object.keys(graph[u]).reverse();
    for (const v of neighbors) {
      if (!visited.has(v)) {
        if (predecessors[v] === null && v !== startNode) predecessors[v] = u;
        stack.push(v);
      }
    }
    step++;
    yield snapshot({ algorithm: "DFS", step, action: `Update stack after ${u}`, currentNode: u, visited: [...visited], predecessors, frontier: [...stack] });
  }
  step++;
  yield snapshot({ algorithm: "DFS", step, action: "Traversal complete", currentNode: null, visited: [...visited], predecessors, frontier: [] });
}

function formatValue(value) {
  return value === Infinity || value === "∞" ? "∞" : String(value);
}

function createElements(graph) {
  const nodes = Object.keys(graph).map((id) => ({ data: { id, label: id } }));
  const edges = [];
  for (const [source, neighbors] of Object.entries(graph)) {
    for (const [target, weight] of Object.entries(neighbors)) {
      edges.push({ data: { id: `${source}__${target}`, source, target, weight, label: String(weight) } });
    }
  }
  return [...nodes, ...edges];
}

function initCytoscape() {
  if (cy) cy.destroy();
  cy = cytoscape({
    container: $("cy"),
    elements: createElements(graphData),
    layout: { name: "cose", animate: false, padding: 35 },
    style: [
      { selector: "node", style: { "background-color": "#64748b", label: "data(label)", color: "#fff", "text-valign": "center", "font-weight": 700, width: 44, height: 44 } },
      { selector: "edge", style: { width: 2, "line-color": "#94a3b8", "target-arrow-color": "#94a3b8", "target-arrow-shape": "triangle", "curve-style": "bezier", label: "data(label)", "font-size": 12, "text-background-color": "#fff", "text-background-opacity": 1, "text-background-padding": 2 } },
      { selector: ".visited", style: { "background-color": "#16a34a" } },
      { selector: ".frontier", style: { "background-color": "#f59e0b" } },
      { selector: ".current", style: { "background-color": "#dc2626", "border-width": 4, "border-color": "#fecaca" } },
      { selector: ".active-edge", style: { width: 5, "line-color": "#dc2626", "target-arrow-color": "#dc2626" } }
    ]
  });
}

function updateGraphVisualization(state) {
  if (!cy) return;
  cy.elements().removeClass("visited frontier current active-edge");
  (state.visited || []).forEach((id) => cy.getElementById(id).addClass("visited"));
  (state.frontier || []).forEach((id) => cy.getElementById(id).addClass("frontier"));
  if (state.currentNode) cy.getElementById(state.currentNode).addClass("current");
  if (state.activeEdge) cy.getElementById(`${state.activeEdge[0]}__${state.activeEdge[1]}`).addClass("active-edge");
}

function stateText(state) {
  const parts = [];
  if (state.distances) parts.push(`Distances: ${Object.entries(state.distances).map(([n, d]) => `${n}=${formatValue(d)}`).join(", ")}`);
  if (state.predecessors) parts.push(`Predecessors: ${Object.entries(state.predecessors).map(([n, p]) => `${n}=${p ?? "–"}`).join(", ")}`);
  if (state.visited) parts.push(`Visited: ${state.visited.join(", ") || "–"}`);
  if (state.frontier) parts.push(`Frontier: ${state.frontier.join(", ") || "–"}`);
  return parts.join(" | ");
}

function renderState(state) {
  if (!state) return;
  updateGraphVisualization(state);
  $("step-counter").textContent = `Step ${currentStep + 1} / ${history.length}`;
  $("step-description").textContent = `${state.algorithm}: ${state.action}`;
  $("prev-btn").disabled = currentStep === 0;
  $("next-btn").disabled = currentStep >= history.length - 1;

  const body = $("table-body");
  body.innerHTML = "";
  history.slice(0, currentStep + 1).forEach((item, index) => {
    const row = body.insertRow();
    if (index === currentStep) row.className = "active-row";
    [item.step, item.action, item.currentNode ?? "–", stateText(item)].forEach((text) => {
      const cell = row.insertCell();
      cell.textContent = text;
    });
  });
  body.lastElementChild?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function initializeApp() {
  const error = $("error-message");
  error.textContent = "";
  isInitialized = false;
  try {
    graphData = normalizeGraph(JSON.parse($("graph-input").value.trim()));
    const startNode = $("start-node").value.trim();
    if (!startNode || !(startNode in graphData)) throw new Error(`Start node "${startNode}" does not exist in the graph.`);

    initCytoscape();
    const algorithm = $("algo-select").value;
    const generator = algorithm === "dijkstra" ? dijkstraGenerator(graphData, startNode)
      : algorithm === "bellman_ford" ? bellmanFordGenerator(graphData, startNode)
      : dfsGenerator(graphData, startNode);

    history = [...generator];
    if (!history.length) throw new Error("The algorithm produced no execution steps.");
    currentStep = 0;
    isInitialized = true;
    renderState(history[0]);
  } catch (err) {
    history = [];
    $("table-body").innerHTML = "";
    $("step-counter").textContent = "Step 0 / 0";
    $("step-description").textContent = "Initialization failed.";
    $("prev-btn").disabled = true;
    $("next-btn").disabled = true;
    error.textContent = err instanceof SyntaxError ? `Invalid JSON: ${err.message}` : err.message;
    console.error(err);
  }
}

$("run-btn").addEventListener("click", initializeApp);
$("next-btn").addEventListener("click", () => { if (isInitialized && currentStep < history.length - 1) renderState(history[++currentStep]); });
$("prev-btn").addEventListener("click", () => { if (isInitialized && currentStep > 0) renderState(history[--currentStep]); });
window.addEventListener("DOMContentLoaded", initializeApp);

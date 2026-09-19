// Pure, DOM-free tree builder for the Layers rail v2 (docs/ROUND-3.md "D. Layers rail v2").
// node = { id, label, title, keys, children, kind }. keys = markKey[] of every mark under
// the node (own + descendants). kind: "all" | "namespace" | "layer" | "file" | "whole-file"
// | "method" | "top-level".
import { markKey } from "./selection.js";
import { layersForSolo } from "./solo.js";

function namespaceOf(layerId) {
  return layerId.split(".")[0];
}

// "Invoice#summary/total" -> "total"; "Invoice#summary" -> "summary"
function shortName(symbol) {
  if (!symbol) return symbol;
  const cut = Math.max(symbol.lastIndexOf("#"), symbol.lastIndexOf("."), symbol.lastIndexOf("/")) + 1;
  return symbol.slice(cut);
}

function layerNode(id, layer, marks) {
  return {
    id,
    label: layer.id,
    title: layer.id,
    kind: "layer",
    layerId: layer.id,
    marks,
    keys: marks.map((m) => markKey(layer.id, m)),
    children: [],
  };
}

// Layer nodes for the layers that have >0 marks in `marksOf(layer)`, in doc.layers order.
function layerNodesFor(doc, idPrefix, marksOf) {
  const nodes = [];
  for (const layer of doc.layers) {
    const marks = marksOf(layer);
    if (marks.length === 0) continue;
    nodes.push(layerNode(`${idPrefix}/${layer.id}`, layer, marks));
  }
  return nodes;
}

function buildAllFilesNode(doc) {
  const byNs = new Map();
  for (const layer of doc.layers) {
    const ns = namespaceOf(layer.id);
    if (!byNs.has(ns)) byNs.set(ns, []);
    byNs.get(ns).push(layer);
  }
  const children = [...byNs.keys()].map((ns) => {
    const nsId = `all/${ns}.*`;
    const layerNodes = layerNodesFor(doc, "all", (layer) => (namespaceOf(layer.id) === ns ? layer.marks : []));
    return {
      id: nsId,
      label: `${ns}.*`,
      title: null,
      kind: "namespace",
      keys: layerNodes.flatMap((n) => n.keys),
      children: layerNodes,
    };
  });
  return {
    id: "all",
    label: "ALL FILES",
    title: null,
    kind: "all",
    keys: children.flatMap((c) => c.keys),
    children,
  };
}

// The method's data.effects ({ verdict, direct, via }) off its defs.methods mark, or null
// (top-level/no-verdict symbols, or a doc with no defs.methods layer at all).
function methodEffectsFor(doc, symbol) {
  const defsMethods = doc.layers.find((l) => l.id === "defs.methods");
  const mark = defsMethods?.marks.find((m) => m.symbol === symbol);
  return mark?.data?.effects ?? null;
}

function buildScopeNode(doc, file, symbol, label) {
  const idPrefix = `file/${file}/scope/${symbol}`;
  const layerNodes = layerNodesFor(doc, idPrefix, (layer) => layer.marks.filter((m) => m.file === file && m.data?.scope === symbol));
  return {
    id: idPrefix,
    label,
    title: symbol,
    kind: "method",
    keys: layerNodes.flatMap((n) => n.keys),
    children: layerNodes,
    effects: methodEffectsFor(doc, symbol),
  };
}

function buildTopLevelNode(doc, file) {
  const idPrefix = `file/${file}/scope/top-level`;
  const layerNodes = layerNodesFor(doc, idPrefix, (layer) => layer.marks.filter((m) => m.file === file && (m.data?.scope ?? null) === null));
  const keys = layerNodes.flatMap((n) => n.keys);
  if (keys.length === 0) return null;
  return { id: idPrefix, label: "(top level)", title: null, kind: "top-level", keys, children: layerNodes };
}

function buildFileNode(doc, file) {
  const wholeIdPrefix = `file/${file}/whole`;
  const wholeLayerNodes = layerNodesFor(doc, wholeIdPrefix, (layer) => layer.marks.filter((m) => m.file === file));
  const wholeNode = {
    id: wholeIdPrefix,
    label: "Whole file",
    title: null,
    kind: "whole-file",
    keys: wholeLayerNodes.flatMap((n) => n.keys),
    children: wholeLayerNodes,
  };

  const defsMethods = doc.layers.find((l) => l.id === "defs.methods");
  const methodSymbols = (defsMethods ? defsMethods.marks : [])
    .filter((m) => m.file === file)
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((m) => m.symbol);

  const methodNodes = methodSymbols.map((symbol) => buildScopeNode(doc, file, symbol, shortName(symbol)));
  const topLevelNode = buildTopLevelNode(doc, file);

  return {
    id: `file/${file}`,
    label: file,
    title: file,
    kind: "file",
    keys: wholeNode.keys,
    children: [wholeNode, ...methodNodes, ...(topLevelNode ? [topLevelNode] : [])],
  };
}

// tree = { root, byId }. root.children = [allFilesNode, ...fileNodes]. visibleFiles keeps
// today's single-open-file behaviour but stays an array (split-screen is coming).
export function buildRailTree(doc, visibleFiles) {
  const all = buildAllFilesNode(doc);
  const files = visibleFiles.map((file) => buildFileNode(doc, file));
  const root = { id: "root", label: "root", title: null, kind: "root", keys: all.keys, children: [all, ...files] };
  const byId = new Map();
  (function index(node) {
    byId.set(node.id, node);
    for (const child of node.children) index(child);
  })(root);
  return { root, byId };
}

// Resolves a solo value (a node-path id, OR a legacy plain layer id / "ns.*" group id) to
// { id, label, keys }, or null if it resolves to nothing. Legacy ids are resolved directly
// against doc.layers (independent of visibleFiles) so they keep working even for a layer
// that has no marks in the currently open file.
export function resolveSoloId(tree, doc, allLayerIds, id) {
  if (!id) return null;
  const legacyLayerIds = layersForSolo(allLayerIds, id);
  if (legacyLayerIds.length) {
    const keys = [];
    for (const layer of doc.layers) {
      if (!legacyLayerIds.includes(layer.id)) continue;
      for (const mark of layer.marks) keys.push(markKey(layer.id, mark));
    }
    return { id, label: id, keys };
  }
  const node = tree.byId.get(id);
  if (!node || node.keys.length === 0) return null;
  return { id, label: node.label, keys: node.keys };
}

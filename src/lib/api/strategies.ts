import { invoke } from "@tauri-apps/api/core";
import { notifyChange } from "../changes";
import type { EdgeInput, GraphEdge, GraphNode, NodeInput, Polarity, Strategy } from "../strategies";
import { inTauri } from "./runtime";
import { strategiesStore } from "./strategiesPreview";

export const listStrategies = (): Promise<Strategy[]> => (inTauri ? invoke("list_strategies") : strategiesStore.list());

/** Nach jeder Änderung werden alle Strategie-Ansichten benachrichtigt. */
async function changed<T>(result: Promise<T>): Promise<T> {
  const value = await result;
  notifyChange("strategies");
  return value;
}

export const createStrategy = (title: string): Promise<number> =>
  changed(inTauri ? invoke("create_strategy", { title }) : strategiesStore.create(title));

export const renameStrategy = (id: number, title: string): Promise<void> =>
  changed(inTauri ? invoke("rename_strategy", { id, title }) : strategiesStore.rename(id, title));

export const deleteStrategy = (id: number): Promise<void> =>
  changed(inTauri ? invoke("delete_strategy", { id }) : strategiesStore.remove(id));

export const createNode = (strategyId: number, input: NodeInput): Promise<GraphNode> =>
  changed(inTauri ? invoke("create_strategy_node", { strategyId, input }) : strategiesStore.createNode(strategyId, input));

export const updateNode = (id: number, input: NodeInput): Promise<void> =>
  changed(inTauri ? invoke("update_strategy_node", { id, input }) : strategiesStore.updateNode(id, input));

export const moveNode = (id: number, x: number, y: number): Promise<void> =>
  changed(inTauri ? invoke("move_strategy_node", { id, x, y }) : strategiesStore.moveNode(id, x, y));

export const deleteNode = (id: number): Promise<void> =>
  changed(inTauri ? invoke("delete_strategy_node", { id }) : strategiesStore.removeNode(id));

export const createEdge = (strategyId: number, input: EdgeInput): Promise<GraphEdge> =>
  changed(inTauri ? invoke("create_strategy_edge", { strategyId, input }) : strategiesStore.createEdge(strategyId, input));

export const updateEdge = (id: number, label: string, polarity: Polarity): Promise<void> =>
  changed(inTauri ? invoke("update_strategy_edge", { id, label, polarity }) : strategiesStore.updateEdge(id, label, polarity));

export const deleteEdge = (id: number): Promise<void> =>
  changed(inTauri ? invoke("delete_strategy_edge", { id }) : strategiesStore.removeEdge(id));

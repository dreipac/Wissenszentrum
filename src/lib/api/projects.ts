import { invoke } from "@tauri-apps/api/core";
import { notifyChange } from "../changes";
import type { Project, ProjectInput } from "../projects";
import { inTauri } from "./runtime";

// Browser-Preview ohne Tauri: dieselben Regeln wie im Backend, aber nur im Speicher.
let previewProjects: Project[] = [];
let nextId = 1;

function checkPreview(input: ProjectInput, ownId: number | null): ProjectInput {
  const name = input.name.trim();
  if (!name) throw "Der Name darf nicht leer sein.";
  if (name.length > 80) throw "Der Name darf höchstens 80 Zeichen lang sein.";
  if (previewProjects.some((p) => p.id !== ownId && p.name.toLowerCase() === name.toLowerCase())) throw `Ein Projekt „${name}“ gibt es bereits.`;
  return { name, docId: input.docId, instructions: input.instructions.trim() };
}

const preview = {
  async list(): Promise<Project[]> {
    return previewProjects.map((p) => ({ ...p }));
  },
  async create(input: ProjectInput): Promise<Project> {
    const project = { id: nextId++, ...checkPreview(input, null) };
    previewProjects.push(project);
    return { ...project };
  },
  async update(id: number, input: ProjectInput): Promise<Project> {
    const project = previewProjects.find((p) => p.id === id);
    if (!project) throw "Projekt nicht gefunden.";
    Object.assign(project, checkPreview(input, id));
    return { ...project };
  },
  async remove(id: number): Promise<void> {
    if (!previewProjects.some((p) => p.id === id)) throw "Projekt nicht gefunden.";
    previewProjects = previewProjects.filter((p) => p.id !== id);
  },
};

export const listProjects = (): Promise<Project[]> => (inTauri ? invoke("list_assistant_projects") : preview.list());

/** Nach jeder Änderung laden alle Ansichten mit Projekten neu. */
async function changed<T>(result: Promise<T>): Promise<T> {
  const value = await result;
  notifyChange("projects");
  return value;
}

export const createProject = (input: ProjectInput): Promise<Project> =>
  changed(inTauri ? invoke("create_assistant_project", { input }) : preview.create(input));

export const updateProject = (id: number, input: ProjectInput): Promise<Project> =>
  changed(inTauri ? invoke("update_assistant_project", { id, input }) : preview.update(id, input));

export const deleteProject = (id: number): Promise<void> =>
  changed(inTauri ? invoke("delete_assistant_project", { id }) : preview.remove(id));

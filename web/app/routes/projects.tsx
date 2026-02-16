import { Form, useLoaderData, useActionData, useNavigation } from "react-router";
import { useState } from "react";
import sql from "../lib/db.server";

interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  root_path: string | null;
  created_at: string;
  updated_at: string;
  memory_count: number;
  conversation_count: number;
}

async function safeProjectMemoryCount(projectId: string): Promise<number> {
  try {
    const rows = await sql`
      SELECT count(*)::int AS count
      FROM mem0_memories
      WHERE payload->>'userId' = ${projectId}
    `;
    return (rows[0] as unknown as { count: number })?.count ?? 0;
  } catch {
    return 0;
  }
}

export async function loader() {
  const rows = await sql`
    SELECT
      p.id, p.name, p.slug, p.description, p.root_path,
      p.created_at, p.updated_at,
      (SELECT count(*)::int FROM conversations c WHERE c.project_id = p.id) AS conversation_count
    FROM projects p
    ORDER BY p.name ASC
  `;

  const projects = await Promise.all(
    (rows as unknown as (Omit<Project, "memory_count">)[]).map(async (p) => ({
      ...p,
      memory_count: await safeProjectMemoryCount(p.id),
    }))
  );

  return { projects };
}

export async function action({ request }: { request: Request }) {
  const form = await request.formData();
  const intent = form.get("intent") as string;

  if (intent === "create") {
    const name = (form.get("name") as string)?.trim();
    const slug = (form.get("slug") as string)?.trim();
    const description = (form.get("description") as string)?.trim() || null;
    const rootPath = (form.get("rootPath") as string)?.trim() || null;

    if (!name || !slug) {
      return { error: "Name and slug are required." };
    }

    const existing = await sql`SELECT id FROM projects WHERE slug = ${slug}`;
    if (existing.length > 0) {
      return { error: `A project with slug "${slug}" already exists.` };
    }

    await sql`
      INSERT INTO projects (name, slug, description, root_path)
      VALUES (${name}, ${slug}, ${description}, ${rootPath})
    `;
    return { success: `Project "${name}" created.` };
  }

  if (intent === "update") {
    const projectId = form.get("projectId") as string;
    const name = (form.get("name") as string)?.trim();
    const description = (form.get("description") as string)?.trim() || null;
    const rootPath = (form.get("rootPath") as string)?.trim() || null;

    if (!projectId || !name) {
      return { error: "Project ID and name are required." };
    }

    await sql`
      UPDATE projects
      SET name = ${name}, description = ${description}, root_path = ${rootPath}
      WHERE id = ${projectId}::uuid
    `;
    return { success: `Project "${name}" updated.` };
  }

  if (intent === "delete") {
    const projectId = form.get("projectId") as string;
    if (!projectId) return { error: "Project ID required." };

    await sql`DELETE FROM projects WHERE id = ${projectId}::uuid`;
    return { success: "Project deleted." };
  }

  return { error: "Unknown action." };
}

export default function Projects() {
  const { projects } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Projects</h2>

      {actionData && "error" in actionData && (
        <div className="alert alert-error mb-4">
          <span>{actionData.error}</span>
        </div>
      )}
      {actionData && "success" in actionData && (
        <div className="alert alert-success mb-4">
          <span>{actionData.success}</span>
        </div>
      )}

      {projects.length > 0 && (
        <div className="space-y-3 mb-6">
          {projects.map((project) => (
            <div key={project.id} className="card bg-base-200">
              <div className="card-body p-4">
                {editingId === project.id ? (
                  <Form
                    method="post"
                    onSubmit={() => setEditingId(null)}
                    className="space-y-3"
                  >
                    <input type="hidden" name="intent" value="update" />
                    <input type="hidden" name="projectId" value={project.id} />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="form-control">
                        <label className="label">
                          <span className="label-text text-xs">Name</span>
                        </label>
                        <input
                          type="text"
                          name="name"
                          defaultValue={project.name}
                          className="input input-bordered input-sm"
                          required
                        />
                      </div>
                      <div className="form-control">
                        <label className="label">
                          <span className="label-text text-xs">Root Path</span>
                        </label>
                        <input
                          type="text"
                          name="rootPath"
                          defaultValue={project.root_path ?? ""}
                          className="input input-bordered input-sm"
                          placeholder="/path/to/project"
                        />
                      </div>
                      <div className="form-control md:col-span-2">
                        <label className="label">
                          <span className="label-text text-xs">
                            Description
                          </span>
                        </label>
                        <input
                          type="text"
                          name="description"
                          defaultValue={project.description ?? ""}
                          className="input input-bordered input-sm"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        className="btn btn-primary btn-sm"
                        disabled={isSubmitting}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </Form>
                ) : (
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{project.name}</h3>
                        <span className="badge badge-ghost badge-sm">
                          {project.slug}
                        </span>
                      </div>
                      {project.description && (
                        <p className="text-sm text-base-content/60 mt-1">
                          {project.description}
                        </p>
                      )}
                      {project.root_path && (
                        <p className="text-xs text-base-content/40 mt-1">
                          <code>{project.root_path}</code>
                        </p>
                      )}
                      <div className="flex gap-3 mt-2 text-xs text-base-content/50">
                        <span>{project.memory_count} memories</span>
                        <span>{project.conversation_count} conversations</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        className="btn btn-ghost btn-xs"
                        onClick={() => setEditingId(project.id)}
                      >
                        Edit
                      </button>
                      <Form method="post" className="inline">
                        <input type="hidden" name="intent" value="delete" />
                        <input
                          type="hidden"
                          name="projectId"
                          value={project.id}
                        />
                        <button
                          type="submit"
                          className="btn btn-ghost btn-xs text-error"
                          disabled={isSubmitting}
                          onClick={(e) => {
                            if (
                              !confirm(
                                `Delete project "${project.name}"? This will remove all associated data.`
                              )
                            ) {
                              e.preventDefault();
                            }
                          }}
                        >
                          Delete
                        </button>
                      </Form>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card bg-base-200">
        <div className="card-body">
          <h3 className="card-title text-base">New Project</h3>
          <Form method="post" className="space-y-4">
            <input type="hidden" name="intent" value="create" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="form-control">
                <label className="label">
                  <span className="label-text">Name</span>
                </label>
                <input
                  type="text"
                  name="name"
                  placeholder="My Project"
                  className="input input-bordered input-sm"
                  required
                />
              </div>
              <div className="form-control">
                <label className="label">
                  <span className="label-text">Slug</span>
                </label>
                <input
                  type="text"
                  name="slug"
                  placeholder="my-project"
                  className="input input-bordered input-sm"
                  required
                  pattern="[a-z0-9\-]+"
                  title="Lowercase letters, numbers, and hyphens only"
                />
              </div>
              <div className="form-control">
                <label className="label">
                  <span className="label-text">Root Path</span>
                </label>
                <input
                  type="text"
                  name="rootPath"
                  placeholder="/path/to/project"
                  className="input input-bordered input-sm"
                />
              </div>
              <div className="form-control">
                <label className="label">
                  <span className="label-text">Description</span>
                </label>
                <input
                  type="text"
                  name="description"
                  placeholder="A short description..."
                  className="input input-bordered input-sm"
                />
              </div>
            </div>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={isSubmitting}
            >
              Create Project
            </button>
          </Form>
        </div>
      </div>
    </div>
  );
}

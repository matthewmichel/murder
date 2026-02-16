import { useState } from "react";
import { Form, useLoaderData, useActionData, useNavigation } from "react-router";
import sql from "../lib/db.server";

const CAPABILITIES = ["embeddings", "orchestration"] as const;

interface ModelOption {
  model: string;
  hint: string;
  provider: string;
}

const ORCHESTRATION_MODELS: ModelOption[] = [
  { model: "claude-sonnet-4.5", hint: "Anthropic — fast, strong", provider: "anthropic" },
  { model: "claude-opus-4.6", hint: "Anthropic — smartest", provider: "anthropic" },
  { model: "gpt-5.2", hint: "OpenAI — frontier", provider: "openai" },
];

const EMBEDDING_MODELS: ModelOption[] = [
  { model: "text-embedding-3-small", hint: "OpenAI — 1536 dims, fast", provider: "openai" },
  { model: "text-embedding-3-large", hint: "OpenAI — 3072 dims, best quality", provider: "openai" },
  { model: "voyage-4-lite", hint: "Voyage — 1024 dims, fast", provider: "voyage" },
  { model: "voyage-4", hint: "Voyage — 1024 dims, balanced", provider: "voyage" },
  { model: "voyage-4-large", hint: "Voyage — 1024 dims, best quality", provider: "voyage" },
  { model: "voyage-code-3", hint: "Voyage — 1024 dims, code-optimized", provider: "voyage" },
];

interface ProviderKey {
  key_id: string;
  provider_id: string;
  provider_name: string;
  provider_slug: string;
  provider_type: string;
  key_alias: string;
  supported_capabilities: string[];
  default_models: Record<string, string>;
}

interface AiConfig {
  id: string;
  capability: string;
  model_name: string;
  provider_key_id: string;
  provider_name: string;
  project_id: string | null;
  project_name: string | null;
  is_active: boolean;
}

interface Project {
  id: string;
  name: string;
}

export async function loader() {
  const [providerKeys, configs, projects] = await Promise.all([
    sql`
      SELECT
        apk.id AS key_id, apk.provider_id, ap.name AS provider_name,
        ap.slug AS provider_slug, ap.provider_type,
        apk.key_alias, ap.supported_capabilities, ap.default_models
      FROM ai_provider_keys apk
      JOIN ai_providers ap ON ap.id = apk.provider_id
      WHERE apk.is_active = true
      ORDER BY ap.name
    `,
    sql`
      SELECT
        ac.id, ac.capability, ac.model_name, ac.provider_key_id, ac.is_active,
        ap.name AS provider_name, ac.project_id,
        proj.name AS project_name
      FROM ai_configs ac
      JOIN ai_provider_keys apk ON apk.id = ac.provider_key_id
      JOIN ai_providers ap ON ap.id = apk.provider_id
      LEFT JOIN projects proj ON proj.id = ac.project_id
      ORDER BY ac.capability, proj.name NULLS FIRST
    `,
    sql`SELECT id, name FROM projects ORDER BY name`,
  ]);

  return {
    providerKeys: providerKeys as unknown as ProviderKey[],
    configs: configs as unknown as AiConfig[],
    projects: projects as unknown as Project[],
  };
}

export async function action({ request }: { request: Request }) {
  const form = await request.formData();
  const intent = form.get("intent") as string;

  if (intent === "save-config") {
    const providerKeyId = form.get("providerKeyId") as string;
    const capability = form.get("capability") as string;
    const modelName = form.get("modelName") as string;
    const projectId = (form.get("projectId") as string) || null;

    if (!providerKeyId || !capability || !modelName?.trim()) {
      return { error: "All fields are required." };
    }

    if (projectId) {
      await sql`
        INSERT INTO ai_configs (project_id, provider_key_id, capability, model_name)
        VALUES (${projectId}::uuid, ${providerKeyId}::uuid, ${capability}, ${modelName.trim()})
        ON CONFLICT (project_id, capability) WHERE project_id IS NOT NULL
        DO UPDATE SET
          provider_key_id = EXCLUDED.provider_key_id,
          model_name = EXCLUDED.model_name,
          is_active = true,
          updated_at = NOW()
      `;
    } else {
      await sql`
        INSERT INTO ai_configs (provider_key_id, capability, model_name)
        VALUES (${providerKeyId}::uuid, ${capability}, ${modelName.trim()})
        ON CONFLICT (capability) WHERE project_id IS NULL
        DO UPDATE SET
          provider_key_id = EXCLUDED.provider_key_id,
          model_name = EXCLUDED.model_name,
          is_active = true,
          updated_at = NOW()
      `;
    }

    return { success: `${capability} config saved.` };
  }

  if (intent === "delete-config") {
    const configId = form.get("configId") as string;
    if (!configId) return { error: "Config ID required." };
    await sql`DELETE FROM ai_configs WHERE id = ${configId}::uuid`;
    return { success: "Config removed." };
  }

  return { error: "Unknown action." };
}

export default function Configs() {
  const { providerKeys, configs, projects } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const globalConfigs = configs.filter((c) => !c.project_id);
  const projectConfigs = configs.filter((c) => c.project_id);

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Model Configuration</h2>

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

      {providerKeys.length === 0 ? (
        <div className="alert alert-warning">
          <span>
            No active provider keys found. Add API keys on the{" "}
            <a href="/providers" className="link">
              Providers
            </a>{" "}
            page first.
          </span>
        </div>
      ) : (
        <>
          <div className="card bg-base-200 mb-6">
            <div className="card-body">
              <h3 className="card-title text-base">Global Defaults</h3>
              <p className="text-sm text-base-content/50 mb-4">
                Default model for each capability, used when no project-specific
                override exists.
              </p>

              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Capability</th>
                      <th>Provider</th>
                      <th>Model</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {CAPABILITIES.map((cap) => {
                      const config = globalConfigs.find(
                        (c) => c.capability === cap
                      );
                      return (
                        <tr key={cap}>
                          <td className="font-medium capitalize">{cap}</td>
                          <td>{config?.provider_name ?? "—"}</td>
                          <td>
                            {config ? (
                              <code className="text-xs">
                                {config.model_name}
                              </code>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>
                            {config ? (
                              <span className="badge badge-success badge-sm">
                                active
                              </span>
                            ) : (
                              <span className="badge badge-ghost badge-sm">
                                not set
                              </span>
                            )}
                          </td>
                          <td>
                            {config && (
                              <Form method="post" className="inline">
                                <input
                                  type="hidden"
                                  name="intent"
                                  value="delete-config"
                                />
                                <input
                                  type="hidden"
                                  name="configId"
                                  value={config.id}
                                />
                                <button
                                  type="submit"
                                  className="btn btn-ghost btn-xs text-error"
                                  disabled={isSubmitting}
                                >
                                  Remove
                                </button>
                              </Form>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {projectConfigs.length > 0 && (
            <div className="card bg-base-200 mb-6">
              <div className="card-body">
                <h3 className="card-title text-base">Project Overrides</h3>
                <div className="overflow-x-auto">
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Capability</th>
                        <th>Provider</th>
                        <th>Model</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {projectConfigs.map((config) => (
                        <tr key={config.id}>
                          <td>{config.project_name}</td>
                          <td className="capitalize">{config.capability}</td>
                          <td>{config.provider_name}</td>
                          <td>
                            <code className="text-xs">{config.model_name}</code>
                          </td>
                          <td>
                            <Form method="post" className="inline">
                              <input
                                type="hidden"
                                name="intent"
                                value="delete-config"
                              />
                              <input
                                type="hidden"
                                name="configId"
                                value={config.id}
                              />
                              <button
                                type="submit"
                                className="btn btn-ghost btn-xs text-error"
                                disabled={isSubmitting}
                              >
                                Remove
                              </button>
                            </Form>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          <ConfigForm
            providerKeys={providerKeys}
            projects={projects}
            isSubmitting={isSubmitting}
          />
        </>
      )}
    </div>
  );
}

function getModelsForProvider(
  capability: string,
  providerSlug: string,
  providerType: string
): ModelOption[] {
  const source =
    capability === "orchestration" ? ORCHESTRATION_MODELS : EMBEDDING_MODELS;

  if (providerType === "gateway") return source;
  return source.filter((m) => m.provider === providerSlug);
}

function ConfigForm({
  providerKeys,
  projects,
  isSubmitting,
}: {
  providerKeys: ProviderKey[];
  projects: Project[];
  isSubmitting: boolean;
}) {
  const [capability, setCapability] = useState<string>(CAPABILITIES[0]);
  const [providerKeyId, setProviderKeyId] = useState<string>(
    providerKeys[0]?.key_id ?? ""
  );
  const [modelSelection, setModelSelection] = useState<string>("");
  const [customModel, setCustomModel] = useState<string>("");

  const selectedProvider = providerKeys.find(
    (pk) => pk.key_id === providerKeyId
  );
  const filteredModels = selectedProvider
    ? getModelsForProvider(
        capability,
        selectedProvider.provider_slug,
        selectedProvider.provider_type
      )
    : [];

  const isCustom = modelSelection === "__custom__";
  const modelNameValue = isCustom ? customModel : modelSelection;

  return (
    <div className="card bg-base-200">
      <div className="card-body">
        <h3 className="card-title text-base">Add / Update Config</h3>
        <Form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="save-config" />
          <input type="hidden" name="modelName" value={modelNameValue} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="form-control">
              <label className="label">
                <span className="label-text">Capability</span>
              </label>
              <select
                name="capability"
                className="select select-bordered select-sm"
                required
                value={capability}
                onChange={(e) => {
                  setCapability(e.target.value);
                  setModelSelection("");
                  setCustomModel("");
                }}
              >
                {CAPABILITIES.map((cap) => (
                  <option key={cap} value={cap}>
                    {cap.charAt(0).toUpperCase() + cap.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text">Provider</span>
              </label>
              <select
                name="providerKeyId"
                className="select select-bordered select-sm"
                required
                value={providerKeyId}
                onChange={(e) => {
                  setProviderKeyId(e.target.value);
                  setModelSelection("");
                  setCustomModel("");
                }}
              >
                {providerKeys.map((pk) => (
                  <option key={pk.key_id} value={pk.key_id}>
                    {pk.provider_name} ({pk.key_alias})
                  </option>
                ))}
              </select>
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text">Model</span>
              </label>
              <select
                className="select select-bordered select-sm"
                value={modelSelection}
                onChange={(e) => {
                  setModelSelection(e.target.value);
                  if (e.target.value !== "__custom__") setCustomModel("");
                }}
                required={!isCustom}
              >
                <option value="" disabled>
                  Select a model…
                </option>
                {filteredModels.map((m) => (
                  <option key={m.model} value={m.model}>
                    {m.model} — {m.hint}
                  </option>
                ))}
                <option value="__custom__">Custom…</option>
              </select>
              {isCustom && (
                <input
                  type="text"
                  className="input input-bordered input-sm mt-2"
                  placeholder="Enter model name…"
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  required
                  autoFocus
                />
              )}
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text">
                  Project{" "}
                  <span className="text-base-content/40">(optional)</span>
                </span>
              </label>
              <select
                name="projectId"
                className="select select-bordered select-sm"
              >
                <option value="">Global (default)</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={isSubmitting || (!modelSelection || (isCustom && !customModel.trim()))}
          >
            Save Config
          </button>
        </Form>
      </div>
    </div>
  );
}

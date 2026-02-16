import { Form, useLoaderData, useActionData, useNavigation } from "react-router";
import sql from "../lib/db.server";
import { encrypt, buildKeyAlias } from "../lib/crypto.server";

interface Provider {
  id: string;
  slug: string;
  name: string;
  provider_type: string;
  base_url: string;
  supported_capabilities: string[];
  default_models: Record<string, string>;
  key_id: string | null;
  key_alias: string | null;
  is_active: boolean | null;
  last_verified_at: string | null;
}

export async function loader() {
  const rows = await sql`
    SELECT
      p.id, p.slug, p.name, p.provider_type, p.base_url,
      p.supported_capabilities, p.default_models,
      k.id AS key_id, k.key_alias, k.is_active, k.last_verified_at
    FROM ai_providers p
    LEFT JOIN ai_provider_keys k ON k.provider_id = p.id
    ORDER BY p.name ASC
  `;
  return { providers: rows as unknown as Provider[] };
}

export async function action({ request }: { request: Request }) {
  const form = await request.formData();
  const intent = form.get("intent") as string;

  if (intent === "save-key") {
    const providerId = form.get("providerId") as string;
    const apiKey = form.get("apiKey") as string;

    if (!providerId || !apiKey?.trim()) {
      return { error: "Provider ID and API key are required." };
    }

    const encrypted = encrypt(apiKey.trim());
    const alias = buildKeyAlias(apiKey);

    await sql`
      INSERT INTO ai_provider_keys (provider_id, encrypted_api_key, key_alias, is_active)
      VALUES (${providerId}::uuid, ${encrypted}, ${alias}, true)
      ON CONFLICT (provider_id) DO UPDATE SET
        encrypted_api_key = EXCLUDED.encrypted_api_key,
        key_alias = EXCLUDED.key_alias,
        is_active = true,
        updated_at = NOW()
    `;

    return { success: `API key saved.` };
  }

  if (intent === "delete-key") {
    const keyId = form.get("keyId") as string;
    if (!keyId) return { error: "Key ID is required." };

    await sql`DELETE FROM ai_provider_keys WHERE id = ${keyId}::uuid`;
    return { success: "API key removed." };
  }

  if (intent === "toggle-key") {
    const keyId = form.get("keyId") as string;
    const active = form.get("active") === "true";
    if (!keyId) return { error: "Key ID is required." };

    await sql`
      UPDATE ai_provider_keys SET is_active = ${!active} WHERE id = ${keyId}::uuid
    `;
    return { success: `Key ${active ? "disabled" : "enabled"}.` };
  }

  return { error: "Unknown action." };
}

export default function Providers() {
  const { providers } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">AI Providers</h2>

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

      <div className="space-y-4">
        {providers.map((provider) => (
          <div key={provider.id} className="card bg-base-200">
            <div className="card-body p-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-lg">{provider.name}</h3>
                    <span className="badge badge-ghost badge-sm">
                      {provider.provider_type}
                    </span>
                    {provider.key_id && (
                      <span
                        className={`badge badge-sm ${
                          provider.is_active
                            ? "badge-success"
                            : "badge-warning"
                        }`}
                      >
                        {provider.is_active ? "active" : "disabled"}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-base-content/50 mt-1">
                    {provider.base_url}
                  </p>
                  <div className="flex gap-1.5 mt-2">
                    {provider.supported_capabilities.map((cap) => (
                      <span
                        key={cap}
                        className="badge badge-outline badge-xs capitalize"
                      >
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>

                {provider.key_id && (
                  <div className="flex items-center gap-2">
                    <code className="text-xs text-base-content/50">
                      {provider.key_alias}
                    </code>
                    <Form method="post">
                      <input type="hidden" name="intent" value="toggle-key" />
                      <input type="hidden" name="keyId" value={provider.key_id} />
                      <input
                        type="hidden"
                        name="active"
                        value={String(provider.is_active)}
                      />
                      <button
                        type="submit"
                        className="btn btn-ghost btn-xs"
                        disabled={isSubmitting}
                      >
                        {provider.is_active ? "Disable" : "Enable"}
                      </button>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="intent" value="delete-key" />
                      <input type="hidden" name="keyId" value={provider.key_id} />
                      <button
                        type="submit"
                        className="btn btn-ghost btn-xs text-error"
                        disabled={isSubmitting}
                      >
                        Remove
                      </button>
                    </Form>
                  </div>
                )}
              </div>

              <div className="divider my-2"></div>

              <Form method="post" className="flex items-end gap-3">
                <input type="hidden" name="intent" value="save-key" />
                <input type="hidden" name="providerId" value={provider.id} />
                <div className="form-control flex-1">
                  <label className="label">
                    <span className="label-text text-xs">
                      {provider.key_id ? "Replace API Key" : "Add API Key"}
                    </span>
                  </label>
                  <input
                    type="password"
                    name="apiKey"
                    placeholder={`Enter ${provider.name} API key...`}
                    className="input input-bordered input-sm w-full"
                    required
                    autoComplete="off"
                  />
                </div>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={isSubmitting}
                >
                  {provider.key_id ? "Update" : "Save"}
                </button>
              </Form>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
